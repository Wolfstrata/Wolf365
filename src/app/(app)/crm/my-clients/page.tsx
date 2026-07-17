import { Contact } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card, EmptyState } from "@/components/ui/primitives";
import { computeMyClients, type MyClientOppInput } from "@/lib/crm/my-clients";
import { getLastTouchpoints } from "@/lib/crm/touchpoints";
import { domainOf } from "@/lib/crm/graph";
import { SpendMoverTable } from "../../cash-flow/tables";
import { MyClientsTable, type MyClientTableRow } from "./clients-table";
import { RepPicker } from "./rep-picker";

export const maxDuration = 120;

const DAY = 86_400_000;

/**
 * My Clients — a per-rep view of their own accounts. Shows year-over-year spend
 * movement (expanding vs contracting, reused from the Suppliers / DSO report) so
 * reps can see what their customers are doing, plus a roster of every client with
 * current-FY gross revenue/margin, average margin, lifetime spend, days since the
 * last purchase (from close dates) and days since the last touchpoint (email or
 * calendar meeting via Microsoft 365). Scoped to the signed-in user's owned
 * opportunities; administrators can "View as" any account manager.
 */
export default async function MyClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ rep?: string }>;
}) {
  const user = await requirePermission("crm:read");
  const isAdmin = user.role === "ADMINISTRATOR";

  // Account managers = users who own opportunities. Admins may view any of them.
  const reps = isAdmin
    ? await (async () => {
        const owners = await prisma.crmOpportunity.groupBy({ by: ["ownerId"] });
        const users = await prisma.user.findMany({
          where: { id: { in: owners.map((o) => o.ownerId) } },
          select: { id: true, name: true, email: true },
        });
        return users
          .map((u) => ({ id: u.id, email: u.email, label: u.name ?? u.email }))
          .sort((a, b) => a.label.localeCompare(b.label));
      })()
    : [];

  const sp = await searchParams;
  // Resolve whose clients to show: admins may pick a rep; everyone else is scoped
  // to themselves. Fall back to self when the picked rep isn't valid.
  const picked = isAdmin && sp.rep ? reps.find((r) => r.id === sp.rep) : undefined;
  const viewingId = picked?.id ?? user.id;
  const viewingEmail = picked?.email ?? user.email ?? "";
  const viewingName = picked?.label ?? null;

  const opps = await prisma.crmOpportunity.findMany({
    where: { ownerId: viewingId, stage: "CLOSED_WON" },
    select: {
      accountName: true,
      contactEmail: true,
      line: true,
      stage: true,
      amount: true,
      marginAmount: true,
      closeDate: true,
    },
  });

  const inputs: MyClientOppInput[] = opps.map((o) => ({
    accountName: o.accountName,
    line: o.line,
    stage: o.stage,
    amount: o.amount != null ? Number(o.amount) : 0,
    marginAmount: o.marginAmount != null ? Number(o.marginAmount) : null,
    closeDate: o.closeDate,
  }));

  const now = new Date();
  const report = computeMyClients(inputs, now);

  // Resolve each account to its email domain(s) from the Salesforce customer
  // contact email on the account's opportunities, so Microsoft 365 touchpoints
  // can be attributed. (Contact email — who we talk to — not the QBO billing
  // email, which is just where invoices go.)
  const domainsByAccount = new Map<string, Set<string>>();
  for (const o of opps) {
    const dom = domainOf(o.contactEmail);
    if (!dom) continue;
    const account = o.accountName?.trim() || "Unknown account";
    (domainsByAccount.get(account) ?? domainsByAccount.set(account, new Set()).get(account)!).add(dom);
  }
  const accountDomains = new Map<string, string[]>();
  for (const r of report.rows) {
    const doms = domainsByAccount.get(r.account);
    if (doms && doms.size) accountDomains.set(r.account, [...doms]);
  }

  // Last-touchpoint recency per account (Microsoft Graph — the viewed rep's mailbox).
  const { live: touchpointsLive, touchpoints } = await getLastTouchpoints(
    viewingEmail,
    accountDomains,
  );
  const tableRows: MyClientTableRow[] = report.rows.map((r) => {
    const tp = touchpoints.get(r.account) ?? null;
    return {
      account: r.account,
      grossRevenue: r.grossRevenue,
      grossMargin: r.grossMargin,
      avgMarginPct: r.avgMarginPct,
      totalSpend: r.totalSpend,
      daysSinceLastPurchase: r.daysSinceLastPurchase,
      daysSinceLastTouchpoint: tp ? Math.floor((now.getTime() - tp.getTime()) / DAY) : null,
    };
  });

  const whose = viewingName ? `${viewingName}'s accounts` : "Your accounts";
  const description = `${whose} — ${report.fyLabel} gross figures, lifetime spend and purchase/touchpoint recency.`;
  const picker = isAdmin && reps.length > 0 && (
    <RepPicker reps={reps} selected={viewingId} />
  );

  if (!report.hasData) {
    return (
      <div>
        <PageHeader title="My Clients" description={description} />
        <div className="space-y-6 p-4 sm:p-8">
          {picker}
          <EmptyState
            icon={<Contact className="h-8 w-8" />}
            title="No clients yet"
            description={
              viewingName
                ? `${viewingName} has no Closed Won opportunities yet.`
                : "Once you have Closed Won opportunities, your clients — and how their spend is trending year over year — will show up here."
            }
          />
        </div>
      </div>
    );
  }

  const hasMovers = report.spendMovers.up.length > 0 || report.spendMovers.down.length > 0;

  return (
    <div>
      <PageHeader title="My Clients" description={description} />
      <div className="space-y-6 p-4 sm:p-8">
        {picker}
        <section>
          <h2 className="mb-1 text-sm font-semibold">
            Year-over-year spend movers: {report.compareYear} vs {report.priorYear}
          </h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Won revenue by account, current fiscal year vs prior. Shows which of your
            clients are expanding and which are contracting.
          </p>
          {hasMovers ? (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <SpendMoverTable rows={report.spendMovers.up} priorYear={report.priorYear} compareYear={report.compareYear} kind="up" showTotals />
              <SpendMoverTable rows={report.spendMovers.down} priorYear={report.priorYear} compareYear={report.compareYear} kind="down" showTotals />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Not enough year-over-year history yet to show expanding/contracting clients.
            </p>
          )}
        </section>

        <section>
          <h2 className="mb-1 text-sm font-semibold">Client roster</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Gross revenue and margin are for {report.fyLabel}; total spend is lifetime.
            Days since last purchase uses each account&apos;s most recent close date.
            Days since last touchpoint is the most recent email or meeting with the
            client in your Microsoft 365 mailbox.
          </p>
          <MyClientsTable rows={tableRows} touchpointsLive={touchpointsLive} />
        </section>

        {!touchpointsLive && (
          <Card>
            <p className="text-sm font-medium">Touchpoints not available</p>
            <p className="mt-1 text-sm text-muted-foreground">
              &ldquo;Days since last touchpoint&rdquo; reads the most recent email or calendar
              meeting with each client from your Microsoft 365 mailbox via Microsoft Graph.
              It shows &ldquo;—&rdquo; until an admin grants the Graph application permissions
              (Mail.Read, Calendars.Read) with admin consent on the Entra app, and each
              client is matched to an email domain (via its Salesforce customer contact
              email — set the contact-email field on the Salesforce connector).
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}
