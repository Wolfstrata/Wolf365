import type { ReactNode } from "react";
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

const OPEN_TICKET = /open|new|progress|pending|assign|hold|await/i;

/**
 * Rich per-client SuperOps detail. Every entity (tickets, worklogs, contracts,
 * sites, contacts, assets, invoices) is an expandable row: the summary shows the
 * key columns and expanding reveals a full field grid plus the raw synced payload
 * — so the entire record can be inspected here without logging in to SuperOps.
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
        assets: { orderBy: { name: "asc" }, take: 500 },
        contracts: { orderBy: { startDate: "desc" } },
        tickets: { orderBy: { updatedTime: "desc" }, take: 200 },
        _count: { select: { tickets: true, worklogs: true, assets: true } },
      },
    }),
    prisma.superOpsWorklog.aggregate({ where: { superOpsClientId }, _sum: { minutes: true } }),
    prisma.superOpsWorklog.aggregate({
      where: { superOpsClientId, billable: true },
      _sum: { minutes: true },
    }),
    prisma.superOpsWorklog.findMany({
      where: { superOpsClientId },
      orderBy: { entryTime: "desc" },
      take: 100,
    }),
    clientId
      ? prisma.superOpsInvoice.findMany({
          where: { clientId },
          orderBy: { invoiceDate: "desc" },
          take: 50,
          include: { lines: true },
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

      {/* Timesheets / worklogs */}
      <Card>
        <h2 className="mb-3 text-sm font-semibold">Timesheets / Worklogs</h2>
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatItem label="Total logged" value={hoursMinutes(totalMinutes)} />
          <StatItem label="Billable" value={hoursMinutes(billableMinutes)} />
          <StatItem label="Non-billable" value={hoursMinutes(totalMinutes - billableMinutes)} />
          <StatItem label="Entries" value={c._count.worklogs} />
        </div>
        <ExpandableRows
          empty="No worklogs synced. Run 'Sync tickets & worklogs'."
          rows={recentWorklogs}
          summary={(w) => (
            <SummaryLine
              primary={w.technician ?? "Worklog"}
              meta={[
                ["Date", formatDate(w.entryTime)],
                ["Time", hoursMinutes(w.minutes)],
                ["Billable", w.billable == null ? "—" : w.billable ? "Yes" : "No"],
                ["Notes", w.notes ?? "—"],
              ]}
            />
          )}
          raw={(w) => w.raw}
        />
        {recentWorklogs.length < c._count.worklogs && (
          <p className="mt-2 text-xs text-muted-foreground">
            Showing {recentWorklogs.length} most recent of {c._count.worklogs}.
          </p>
        )}
      </Card>

      {/* Tickets */}
      <Section
        title={`Tickets (${c._count.tickets}${c.tickets.length < c._count.tickets ? `, showing ${c.tickets.length} most recent` : ""})`}
      >
        <ExpandableRows
          empty="No tickets synced. Run 'Sync tickets & worklogs'."
          rows={c.tickets}
          summary={(t) => (
            <SummaryLine
              primary={`${t.displayId ? `${t.displayId} · ` : ""}${t.subject ?? t.superOpsId}`}
              meta={[
                ["Status", t.status ?? "—"],
                ["Priority", t.priority ?? "—"],
                ["Technician", t.technician ?? "—"],
                ["Updated", formatDate(t.updatedTime)],
              ]}
            />
          )}
          raw={(t) => t.raw}
        />
      </Section>

      {/* Contracts / agreements */}
      <Section title={`Contracts / Agreements (${c.contracts.length})`}>
        <ExpandableRows
          empty="No contracts synced."
          rows={c.contracts}
          summary={(k) => (
            <SummaryLine
              primary={k.name ?? k.superOpsId}
              meta={[
                ["Status", k.status ?? "—"],
                ["Start", formatDate(k.startDate)],
                ["End", formatDate(k.endDate)],
              ]}
            />
          )}
          raw={(k) => k.raw}
        />
      </Section>

      {/* Sites */}
      <Section title={`Sites (${c.sites.length})`}>
        <ExpandableRows
          empty="No sites synced."
          rows={c.sites}
          summary={(s) => (
            <SummaryLine
              primary={s.name ?? s.superOpsId}
              meta={[["Timezone", s.timezone ?? "—"], ["Address", addrLine(s.address)]]}
            />
          )}
          raw={(s) => s.raw}
        />
      </Section>

      {/* Contacts */}
      <Section title={`Contacts (${c.contacts.length})`}>
        <ExpandableRows
          empty="No contacts synced."
          rows={c.contacts}
          summary={(ct) => (
            <SummaryLine
              primary={ct.name ?? ct.email ?? ct.superOpsId}
              meta={[
                ["Email", ct.email ?? "—"],
                ["Phone", ct.phone ?? "—"],
                ["Role", ct.role ?? "—"],
              ]}
            />
          )}
          raw={(ct) => ct.raw}
        />
      </Section>

      {/* Assets */}
      <Section
        title={`Assets (${c._count.assets}${c.assets.length < c._count.assets ? `, showing ${c.assets.length}` : ""})`}
      >
        <ExpandableRows
          empty="No assets synced."
          rows={c.assets}
          summary={(a) => (
            <SummaryLine
              primary={a.name ?? a.superOpsId}
              meta={[
                ["Serial", a.serialNumber ?? "—"],
                ["Platform", a.platform ?? "—"],
                ["Status", a.status ?? "—"],
                ["Last seen", a.lastCommunicatedTime ? formatDateTime(a.lastCommunicatedTime, timezone) : "—"],
              ]}
            />
          )}
          raw={(a) => a.raw}
        />
      </Section>

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
        ) : (
          <>
            <ExpandableRows
              empty="No invoices synced for this client."
              rows={invoices}
              summary={(i) => (
                <SummaryLine
                  primary={i.invoiceNumber ?? i.superOpsId}
                  meta={[
                    ["Date", formatDate(i.invoiceDate)],
                    ["Status", i.status ?? "—"],
                    ["Review", i.reviewStatus],
                    ["Total", i.total != null ? formatCurrency(Number(i.total), i.currency ?? "CAD") : "—"],
                    ["Lines", i.lines.length],
                  ]}
                />
              )}
              raw={(i) => i.raw}
            />
            {invoices.length > 0 && (
              <p className="mt-2 text-right text-xs text-muted-foreground">
                Total: {formatCurrency(invoiceTotal, invoices[0]?.currency ?? "CAD")}
              </p>
            )}
          </>
        )}
      </Card>
    </>
  );
}

/** One-line address from either a nested object or flat fields. */
function addrLine(a: unknown): string {
  if (!a || typeof a !== "object") return "—";
  const o = a as Record<string, unknown>;
  const parts = [o.line1, o.city, o.state ?? o.stateCode, o.postalCode, o.country ?? o.countryCode]
    .filter(Boolean)
    .map(String);
  return parts.length ? parts.join(", ") : "—";
}

/** A titled card wrapper for a section. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </Card>
  );
}

/** A compact summary line: a bold primary label + labeled metadata chips. */
function SummaryLine({
  primary,
  meta,
}: {
  primary: ReactNode;
  meta: [string, ReactNode][];
}) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-4 gap-y-1 align-middle">
      <span className="font-medium">{primary}</span>
      {meta.map(([label, value]) => (
        <span key={label} className="text-xs text-muted-foreground">
          {label}: <span className="text-foreground">{value}</span>
        </span>
      ))}
    </span>
  );
}

/**
 * A list of expandable rows: each shows a summary line and, when opened, a full
 * field grid + the raw synced payload. Native <details> — no client JS.
 */
function ExpandableRows<T extends { id: string }>({
  rows,
  empty,
  summary,
  raw,
}: {
  rows: T[];
  empty: string;
  summary: (row: T) => ReactNode;
  raw: (row: T) => unknown;
}) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="space-y-1.5">
      {rows.map((row) => (
        <details key={row.id} className="rounded-md border px-3 py-2">
          <summary className="cursor-pointer list-none text-sm marker:content-['']">
            {summary(row)}
          </summary>
          <RawDetail raw={raw(row)} />
        </details>
      ))}
    </div>
  );
}

/** Full detail for one record: a scalar field grid + the complete raw JSON. */
function RawDetail({ raw }: { raw: unknown }) {
  const isPlain = !!raw && typeof raw === "object" && !Array.isArray(raw);
  const entries = isPlain ? Object.entries(raw as Record<string, unknown>) : [];
  const scalars = entries.filter(([, v]) => v == null || typeof v !== "object");
  return (
    <div className="mt-2 space-y-2 border-t pt-2">
      {scalars.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
          {scalars.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="break-words font-medium">{v == null ? "—" : String(v)}</dd>
            </div>
          ))}
        </dl>
      )}
      <details>
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
          Full raw JSON
        </summary>
        <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">
          {JSON.stringify(raw, null, 2)}
        </pre>
      </details>
    </div>
  );
}
