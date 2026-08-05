import Link from "next/link";
import { prisma } from "@/lib/db";
import { Card, StatItem } from "@/components/ui/primitives";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils";

/** Format a minutes total as "Xh Ym". */
function hoursMinutes(mins: number | null | undefined): string {
  if (!mins || mins <= 0) return "0h";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function addr(a: unknown): string {
  if (!a || typeof a !== "object") return "—";
  const o = a as Record<string, unknown>;
  const parts = [o.line1, o.city, o.state, o.postalCode, o.countryCode]
    .filter(Boolean)
    .map(String);
  return parts.length ? parts.join(", ") : "—";
}

const OPEN_TICKET = /open|new|progress|pending|assign|hold|await/i;

/**
 * Rich per-client SuperOps detail: sites, contacts, assets, contracts, recent
 * tickets, a timesheet summary, and linked invoices. Read-only. Loads its own
 * data (children + aggregates) so the shared synced-detail page stays thin.
 */
export async function SuperOpsDetail({
  superOpsClientId,
  clientId,
  timezone,
}: {
  superOpsClientId: string;
  clientId: string | null;
  timezone: string | null | undefined;
}) {
  const [c, worklogAgg, billableAgg, recentWorklogs, invoices] = await Promise.all([
    prisma.superOpsClient.findUnique({
      where: { id: superOpsClientId },
      include: {
        sites: { orderBy: { name: "asc" } },
        contacts: { orderBy: { name: "asc" } },
        assets: { orderBy: { name: "asc" }, take: 200 },
        contracts: { orderBy: { startDate: "desc" } },
        tickets: { orderBy: { updatedTime: "desc" }, take: 100 },
        _count: { select: { tickets: true, worklogs: true, assets: true } },
      },
    }),
    prisma.superOpsWorklog.aggregate({
      where: { superOpsClientId },
      _sum: { minutes: true },
    }),
    prisma.superOpsWorklog.aggregate({
      where: { superOpsClientId, billable: true },
      _sum: { minutes: true },
    }),
    prisma.superOpsWorklog.findMany({
      where: { superOpsClientId },
      orderBy: { entryTime: "desc" },
      take: 25,
    }),
    clientId
      ? prisma.superOpsInvoice.findMany({
          where: { clientId },
          orderBy: { invoiceDate: "desc" },
          take: 25,
        })
      : Promise.resolve([]),
  ]);

  if (!c) return null;

  const openTickets = c.tickets.filter((t) => t.status && OPEN_TICKET.test(t.status)).length;
  const totalMinutes = worklogAgg._sum.minutes ?? 0;
  const billableMinutes = billableAgg._sum.minutes ?? 0;
  const invoiceTotal = invoices.reduce((a, i) => a + (i.total != null ? Number(i.total) : 0), 0);

  return (
    <>
      {/* Account summary */}
      <Card>
        <h2 className="mb-3 text-sm font-semibold">Account</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatItem label="Stage" value={c.stage ?? "—"} />
          <StatItem label="Status" value={c.status ?? "—"} />
          <StatItem label="Account manager" value={c.accountManager ?? "—"} />
          <StatItem label="Email domains" value={c.emailDomains.length ? c.emailDomains.join(", ") : "—"} />
          <StatItem label="Sites" value={c.sites.length} />
          <StatItem label="Contacts" value={c.contacts.length} />
          <StatItem label="Assets" value={c._count.assets} />
          <StatItem label="Tickets" value={`${c._count.tickets} (${openTickets} open)`} />
        </div>
      </Card>

      {/* Timesheet summary */}
      <Card>
        <h2 className="mb-3 text-sm font-semibold">Timesheets / Worklogs</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatItem label="Total logged" value={hoursMinutes(totalMinutes)} />
          <StatItem label="Billable" value={hoursMinutes(billableMinutes)} />
          <StatItem label="Non-billable" value={hoursMinutes(totalMinutes - billableMinutes)} />
          <StatItem label="Entries" value={c._count.worklogs} />
        </div>
        {recentWorklogs.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-1 pr-4 font-medium">Date</th>
                  <th className="py-1 pr-4 font-medium">Technician</th>
                  <th className="py-1 pr-4 font-medium">Time</th>
                  <th className="py-1 pr-4 font-medium">Billable</th>
                  <th className="py-1 pr-4 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {recentWorklogs.map((w) => (
                  <tr key={w.id} className="border-t align-top">
                    <td className="py-1.5 pr-4 whitespace-nowrap">{formatDate(w.entryTime)}</td>
                    <td className="py-1.5 pr-4">{w.technician ?? "—"}</td>
                    <td className="py-1.5 pr-4 tabular-nums">{hoursMinutes(w.minutes)}</td>
                    <td className="py-1.5 pr-4">{w.billable == null ? "—" : w.billable ? "Yes" : "No"}</td>
                    <td className="py-1.5 pr-4 text-muted-foreground">{w.notes ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Tickets */}
      <SectionTable
        title={`Tickets (${c._count.tickets}${c.tickets.length < c._count.tickets ? `, showing ${c.tickets.length} most recent` : ""})`}
        empty="No tickets synced. Run 'Sync tickets & worklogs'."
        rows={c.tickets}
        headers={["Ticket", "Subject", "Status", "Priority", "Technician", "Updated"]}
        render={(t) => [
          t.displayId ?? t.superOpsId,
          t.subject ?? "—",
          t.status ?? "—",
          t.priority ?? "—",
          t.technician ?? "—",
          formatDate(t.updatedTime),
        ]}
      />

      {/* Contracts / agreements */}
      <SectionTable
        title={`Contracts / Agreements (${c.contracts.length})`}
        empty="No contracts synced."
        rows={c.contracts}
        headers={["Name", "Status", "Start", "End"]}
        render={(k) => [k.name ?? "—", k.status ?? "—", formatDate(k.startDate), formatDate(k.endDate)]}
      />

      {/* Sites */}
      <SectionTable
        title={`Sites (${c.sites.length})`}
        empty="No sites synced."
        rows={c.sites}
        headers={["Name", "Timezone", "Address"]}
        render={(s) => [s.name ?? "—", s.timezone ?? "—", addr(s.address)]}
      />

      {/* Contacts */}
      <SectionTable
        title={`Contacts (${c.contacts.length})`}
        empty="No contacts synced."
        rows={c.contacts}
        headers={["Name", "Email", "Phone", "Role"]}
        render={(ct) => [ct.name ?? "—", ct.email ?? "—", ct.phone ?? "—", ct.role ?? "—"]}
      />

      {/* Assets */}
      <SectionTable
        title={`Assets (${c._count.assets}${c.assets.length < c._count.assets ? `, showing ${c.assets.length}` : ""})`}
        empty="No assets synced."
        rows={c.assets}
        headers={["Name", "Serial", "Platform", "Status", "Last seen"]}
        render={(a) => [
          a.name ?? "—",
          a.serialNumber ?? "—",
          a.platform ?? "—",
          a.status ?? "—",
          a.lastCommunicatedTime ? formatDateTime(a.lastCommunicatedTime, timezone) : "—",
        ]}
      />

      {/* Invoices */}
      <Card>
        <h2 className="mb-1 text-sm font-semibold">Invoices ({invoices.length})</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          SuperOps invoices for the linked Wolf365 client. Review and push them to QuickBooks from{" "}
          <Link href="/superops-billing" className="text-primary hover:underline">
            SuperOps Billing
          </Link>
          .
        </p>
        {!clientId ? (
          <p className="text-sm text-muted-foreground">
            This SuperOps client isn&apos;t linked to a Wolf365 client yet — run Materialize in
            Mappings, then invoices will appear here.
          </p>
        ) : invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground">No invoices synced for this client.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-4 font-medium">Invoice</th>
                    <th className="py-1 pr-4 font-medium">Date</th>
                    <th className="py-1 pr-4 font-medium">Status</th>
                    <th className="py-1 pr-4 font-medium">Review</th>
                    <th className="py-1 pr-4 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((i) => (
                    <tr key={i.id} className="border-t align-top">
                      <td className="py-1.5 pr-4">{i.invoiceNumber ?? i.superOpsId}</td>
                      <td className="py-1.5 pr-4 whitespace-nowrap">{formatDate(i.invoiceDate)}</td>
                      <td className="py-1.5 pr-4">{i.status ?? "—"}</td>
                      <td className="py-1.5 pr-4">{i.reviewStatus}</td>
                      <td className="py-1.5 pr-4 text-right tabular-nums">
                        {i.total != null ? formatCurrency(Number(i.total), i.currency ?? "CAD") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-right text-xs text-muted-foreground">
              Total: {formatCurrency(invoiceTotal, invoices[0]?.currency ?? "CAD")}
            </p>
          </>
        )}
      </Card>
    </>
  );
}

/** Generic titled section rendering a compact table (or an empty note). */
function SectionTable<T extends { id: string }>({
  title,
  empty,
  rows,
  headers,
  render,
}: {
  title: string;
  empty: string;
  rows: T[];
  headers: string[];
  render: (row: T) => (string | number)[];
}) {
  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                {headers.map((h) => (
                  <th key={h} className="py-1 pr-4 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t align-top">
                  {render(row).map((cell, i) => (
                    <td key={i} className="py-1.5 pr-4">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
