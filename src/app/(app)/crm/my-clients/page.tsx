import { Contact } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card, EmptyState } from "@/components/ui/primitives";
import { computeMyClients, type MyClientOppInput } from "@/lib/crm/my-clients";
import { getLastTouchpoints } from "@/lib/crm/touchpoints";
import { domainOf } from "@/lib/crm/graph";
import { SpendMoverTable } from "../../cash-flow/tables";
import { MyClientsTable, type MyClientTableRow } from "./clients-table";

export const maxDuration = 120;

const DAY = 86_400_000;

/**
 * My Clients — a per-rep view of their own accounts. Shows year-over-year spend
 * movement (expanding vs contracting, reused from the Suppliers / DSO report) so
 * reps can see what their customers are doing, plus a roster of every client with
 * current-FY gross revenue/margin, average margin, lifetime spend, days since the
 * last purchase (from close dates) and days since the last touchpoint (email,
 * Teams message or calendar meeting — via Microsoft 365, pending integration).
 * Scoped to the signed-in user's owned opportunities.
 */
export default async function MyClientsPage() {
  const user = await requirePermission("crm:read");

  const opps = await prisma.crmOpportunity.findMany({
    where: { ownerId: user.id, stage: "CLOSED_WON" },
    select: { accountName: true, line: true, stage: true, amount: true, marginAmount: true, closeDate: true },
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

  // Resolve each account to its email domain(s) via the matching QuickBooks
  // customer's billing email, so Microsoft 365 touchpoints can be attributed.
  const qboCustomers = await prisma.qboCustomer.findMany({
    where: { billingEmail: { not: null } },
    select: { displayName: true, companyName: true, billingEmail: true },
  });
  const domainByName = new Map<string, Set<string>>();
  for (const c of qboCustomers) {
    const dom = domainOf(c.billingEmail);
    if (!dom) continue;
    for (const nm of [c.displayName, c.companyName]) {
      const key = nm?.trim().toLowerCase();
      if (!key) continue;
      (domainByName.get(key) ?? domainByName.set(key, new Set()).get(key)!).add(dom);
    }
  }
  const accountDomains = new Map<string, string[]>();
  for (const r of report.rows) {
    const doms = domainByName.get(r.account.trim().toLowerCase());
    if (doms && doms.size) accountDomains.set(r.account, [...doms]);
  }

  // Last-touchpoint recency per account (Microsoft Graph — the rep's mailbox).
  const { live: touchpointsLive, touchpoints } = await getLastTouchpoints(
    user.email ?? "",
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

  const description = `Your accounts — ${report.fyLabel} gross figures, lifetime spend and purchase/touchpoint recency.`;

  if (!report.hasData) {
    return (
      <div>
        <PageHeader title="My Clients" description={description} />
        <div className="space-y-6 p-4 sm:p-8">
          <EmptyState
            icon={<Contact className="h-8 w-8" />}
            title="No clients yet"
            description="Once you have Closed Won opportunities, your clients — and how their spend is trending year over year — will show up here."
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
              <SpendMoverTable rows={report.spendMovers.up} priorYear={report.priorYear} compareYear={report.compareYear} kind="up" />
              <SpendMoverTable rows={report.spendMovers.down} priorYear={report.priorYear} compareYear={report.compareYear} kind="down" />
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
              client is matched to an email domain (via its QuickBooks billing email).
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}
