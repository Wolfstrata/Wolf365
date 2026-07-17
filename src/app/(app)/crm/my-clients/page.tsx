import Link from "next/link";
import { Contact, ArrowRight } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card, EmptyState } from "@/components/ui/primitives";
import { loadMyClientsView } from "./data";
import { MoversTable } from "./movers-table";
import { MyClientsTable } from "./clients-table";
import { RepPicker } from "./rep-picker";

export const maxDuration = 120;

/**
 * My Clients — a per-rep view of their own accounts. Year-over-year spend movement
 * (expanding vs contracting) plus a roster of every client with current-FY gross
 * revenue/margin, average margin, lifetime spend, days since last purchase and
 * days since last touchpoint. Each table sorts by its headers and has a full-list
 * "View all" screen. Administrators/Power Users can "View as" any account manager.
 */
export default async function MyClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ rep?: string }>;
}) {
  await requirePermission("crm:read");
  const sp = await searchParams;
  const v = await loadMyClientsView(sp.rep);

  const whose = v.viewingName ? `${v.viewingName}'s accounts` : "Your accounts";
  const description = `${whose} — ${v.report.fyLabel} gross figures, lifetime spend and purchase/touchpoint recency.`;
  const picker = v.canViewAsRep && v.reps.length > 0 && (
    <RepPicker reps={v.reps} selected={v.viewingId} />
  );

  // Preserve the viewed rep when linking to a full-table screen.
  const suffix = sp.rep ? `?rep=${encodeURIComponent(sp.rep)}` : "";
  const viewAll = (table: string) => `/crm/my-clients/${table}${suffix}`;

  function SectionHead({ title, table }: { title: string; table: string }) {
    return (
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <Link
          href={viewAll(table)}
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          View all <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    );
  }

  if (!v.report.hasData) {
    return (
      <div>
        <PageHeader title="My Clients" description={description} />
        <div className="space-y-6 p-4 sm:p-8">
          {picker}
          <EmptyState
            icon={<Contact className="h-8 w-8" />}
            title="No clients yet"
            description={
              v.viewingName
                ? `${v.viewingName} has no Closed Won opportunities yet.`
                : "Once you have Closed Won opportunities, your clients — and how their spend is trending year over year — will show up here."
            }
          />
        </div>
      </div>
    );
  }

  const { report } = v;
  const hasMovers = report.spendMovers.up.length > 0 || report.spendMovers.down.length > 0;

  return (
    <div>
      <PageHeader title="My Clients" description={description} />
      <div className="space-y-6 p-4 sm:p-8">
        {picker}
        <section>
          <SectionHead
            title={`Year-over-year spend movers: ${report.compareYear} vs ${report.priorYear}`}
            table="movers"
          />
          <p className="mb-3 text-xs text-muted-foreground">
            Won revenue by account, current fiscal year vs prior. Shows which of your
            clients are expanding and which are contracting.
          </p>
          {hasMovers ? (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <MoversTable rows={report.spendMovers.up} priorYear={report.priorYear} compareYear={report.compareYear} kind="up" />
              <MoversTable rows={report.spendMovers.down} priorYear={report.priorYear} compareYear={report.compareYear} kind="down" />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Not enough year-over-year history yet to show expanding/contracting clients.
            </p>
          )}
        </section>

        <section>
          <SectionHead title="Client roster" table="roster" />
          <p className="mb-3 text-xs text-muted-foreground">
            Gross revenue and margin are for {report.fyLabel}; total spend is lifetime.
            Days since last purchase uses each account&apos;s most recent close date.
            Days since last touchpoint is the most recent email or meeting with the
            client in your Microsoft 365 mailbox. Click any header to sort.
          </p>
          <MyClientsTable rows={v.tableRows} touchpointsLive={v.touchpointsLive} />
        </section>

        {!v.touchpointsLive && (
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
