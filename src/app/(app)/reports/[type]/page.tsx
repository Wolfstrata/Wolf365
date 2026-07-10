import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { PageHeader, Card, EmptyState } from "@/components/ui/primitives";
import { formatCurrency } from "@/lib/utils";
import { ArchiveToggle } from "@/components/licensing/archive-toggle";
import {
  getMarginReport,
  getRevenueLeakage,
  getOverbillingRisk,
  getUpcomingRenewals,
  getMarginExceptions,
  getExpiredLicenses,
} from "@/lib/reports/queries";

const META: Record<string, { title: string; description: string }> = {
  margin: {
    title: "Margin report",
    description: "Estimated TD SYNNEX cost vs. invoiced revenue by client and SKU.",
  },
  leakage: {
    title: "Revenue leakage",
    description: "Active TD SYNNEX licenses not represented in any billing run.",
  },
  overbilling: {
    title: "Overbilling risk",
    description: "Pushed invoice lines whose TD SYNNEX subscription is gone or inactive.",
  },
  renewals: {
    title: "Upcoming renewals",
    description: "TD SYNNEX (M365) licensing renewing within the next 90 days.",
  },
  "margin-exceptions": {
    title: "Margin exceptions",
    description: "Synced M365 lines sold under cost — suggested price below our cost.",
  },
  expired: {
    title: "Expired licenses",
    description: "TD SYNNEX (M365) licensing whose term has lapsed — past end date or expired status.",
  },
};

/** Report types with a CSV export handler in /api/export. */
const EXPORTABLE = new Set(["margin", "leakage", "overbilling"]);

const RENEWAL_BADGE: Record<number, string> = {
  30: "bg-danger/15 text-danger",
  60: "bg-warning/15 text-warning",
  90: "bg-accent text-accent-foreground",
};

export default async function ReportPage({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const user = await requirePermission("reports:read");
  const { type } = await params;
  const meta = META[type];
  if (!meta) notFound();
  const canExport = can(user.role, "reports:export");
  const canArchive = can(user.role, "billing:edit");

  return (
    <div>
      <PageHeader
        title={meta.title}
        description={meta.description}
        actions={
          canExport && EXPORTABLE.has(type) ? (
            <a
              href={`/api/export?type=${type}`}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition hover:bg-accent"
            >
              <Download className="h-4 w-4" /> Export CSV
            </a>
          ) : null
        }
      />
      <div className="space-y-4 p-8">
        <Link href="/reports" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> All reports
        </Link>
        <Card>
          {type === "margin" && <MarginTable />}
          {type === "leakage" && <LeakageTable />}
          {type === "overbilling" && <OverbillingTable />}
          {type === "renewals" && <RenewalsTable />}
          {type === "margin-exceptions" && <MarginExceptionsTable />}
          {type === "expired" && <ExpiredTable canArchive={canArchive} />}
        </Card>
      </div>
    </div>
  );
}

async function MarginTable() {
  const rows = await getMarginReport();
  if (rows.length === 0) return <Empty />;
  return (
    <Table headers={["Client", "Description", "Revenue", "Est. cost", "Margin", "Margin %"]}>
      {rows.map((r, i) => (
        <tr key={i} className="border-t">
          <Td>{r.client}</Td>
          <Td>{r.description}</Td>
          <Td num>{formatCurrency(r.revenue)}</Td>
          <Td num>{formatCurrency(r.estimatedCost)}</Td>
          <Td num>{formatCurrency(r.margin)}</Td>
          <Td num>{r.marginPct}%</Td>
        </tr>
      ))}
    </Table>
  );
}

async function LeakageTable() {
  const rows = await getRevenueLeakage();
  if (rows.length === 0) return <Empty />;
  return (
    <Table headers={["Client", "SKU", "Product", "Qty", "Est. monthly cost"]}>
      {rows.map((r, i) => (
        <tr key={i} className="border-t">
          <Td>{r.client}</Td>
          <Td>{r.sku}</Td>
          <Td>{r.product}</Td>
          <Td num>{r.quantity}</Td>
          <Td num>{formatCurrency(r.estimatedMonthlyCost)}</Td>
        </tr>
      ))}
    </Table>
  );
}

async function OverbillingTable() {
  const rows = await getOverbillingRisk();
  if (rows.length === 0) return <Empty />;
  return (
    <Table headers={["Client", "Description", "Total", "Reason"]}>
      {rows.map((r, i) => (
        <tr key={i} className="border-t">
          <Td>{r.client}</Td>
          <Td>{r.description}</Td>
          <Td num>{formatCurrency(r.total)}</Td>
          <Td>{r.reason}</Td>
        </tr>
      ))}
    </Table>
  );
}

async function RenewalsTable() {
  const rows = await getUpcomingRenewals();
  if (rows.length === 0) return <Empty />;
  return (
    <Table headers={["Client", "SKU", "Product", "Qty", "Renews", "In"]}>
      {rows.map((r, i) => (
        <tr key={i} className="border-t">
          <Td>
            {r.clientId ? (
              <Link href={`/clients/${r.clientId}`} className="text-primary hover:underline">
                {r.client}
              </Link>
            ) : (
              r.client
            )}
          </Td>
          <Td>{r.sku}</Td>
          <Td>{r.product}</Td>
          <Td num>{r.quantity}</Td>
          <Td>{r.renewalDate}</Td>
          <Td>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${RENEWAL_BADGE[r.bucket]}`}>
              {r.daysUntil}d
            </span>
          </Td>
        </tr>
      ))}
    </Table>
  );
}

async function MarginExceptionsTable() {
  const rows = await getMarginExceptions();
  if (rows.length === 0) return <Empty />;
  return (
    <Table headers={["Client", "SKU", "Product", "Qty", "Unit cost", "Cust. price / MSRP", "Margin"]}>
      {rows.map((r, i) => (
        <tr key={i} className="border-t">
          <Td>
            {r.clientId ? (
              <Link href={`/clients/${r.clientId}`} className="text-primary hover:underline">
                {r.client}
              </Link>
            ) : (
              r.client
            )}
          </Td>
          <Td>{r.sku}</Td>
          <Td>{r.product}</Td>
          <Td num>{r.quantity}</Td>
          <Td num>{formatCurrency(r.unitCost)}</Td>
          <Td num>{formatCurrency(r.customerPrice)}</Td>
          <Td num>
            <span className="font-medium text-danger">{formatCurrency(r.marginPerUnit)}</span>
          </Td>
        </tr>
      ))}
    </Table>
  );
}

async function ExpiredTable({ canArchive }: { canArchive: boolean }) {
  const rows = await getExpiredLicenses();
  if (rows.length === 0) return <Empty />;
  return (
    <Table headers={["Client", "SKU", "Product", "Qty", "Expired", "Status", "Archive"]}>
      {rows.map((r) => (
        <tr key={r.subscriptionId} className="border-t">
          <Td>
            {r.clientId ? (
              <Link href={`/clients/${r.clientId}`} className="text-primary hover:underline">
                {r.client}
              </Link>
            ) : (
              r.client
            )}
          </Td>
          <Td>{r.sku}</Td>
          <Td>{r.product}</Td>
          <Td num>{r.quantity}</Td>
          <Td>
            <span className="font-medium text-orange-600 dark:text-orange-400">
              {r.expiryDate}
              {r.daysAgo != null && (
                <span className="ml-1 text-xs text-muted-foreground">
                  ({r.daysAgo}d ago)
                </span>
              )}
            </span>
          </Td>
          <Td>{r.status}</Td>
          <Td>
            <ArchiveToggle
              subscriptionId={r.subscriptionId}
              archived={false}
              canArchive={canArchive}
            />
          </Td>
        </tr>
      ))}
    </Table>
  );
}

function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-muted-foreground">
          <tr>
            {headers.map((h) => (
              <th key={h} className="py-2 pr-4 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Td({ children, num }: { children: React.ReactNode; num?: boolean }) {
  return <td className={`py-2 pr-4 ${num ? "tabular-nums" : ""}`}>{children}</td>;
}

function Empty() {
  return (
    <EmptyState
      title="Nothing to report yet"
      description="This report is computed from synced and billed data. It will populate once you sync connectors and create billing runs."
    />
  );
}
