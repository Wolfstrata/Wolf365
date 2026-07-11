import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { PageHeader, Card, EmptyState } from "@/components/ui/primitives";
import {
  getMarginReport,
  getRevenueLeakage,
  getOverbillingRisk,
  getUpcomingRenewals,
  getMarginExceptions,
  getExpiredLicenses,
} from "@/lib/reports/queries";
import {
  MarginTableView,
  LeakageTableView,
  OverbillingTableView,
  RenewalsTableView,
  MarginExceptionsTableView,
  ExpiredTableView,
} from "./report-tables";

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
      <div className="space-y-4 p-4 sm:p-8">
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
  return <MarginTableView rows={rows} />;
}

async function LeakageTable() {
  const rows = await getRevenueLeakage();
  if (rows.length === 0) return <Empty />;
  return <LeakageTableView rows={rows} />;
}

async function OverbillingTable() {
  const rows = await getOverbillingRisk();
  if (rows.length === 0) return <Empty />;
  return <OverbillingTableView rows={rows} />;
}

async function RenewalsTable() {
  const rows = await getUpcomingRenewals();
  if (rows.length === 0) return <Empty />;
  return <RenewalsTableView rows={rows} />;
}

async function MarginExceptionsTable() {
  const rows = await getMarginExceptions();
  if (rows.length === 0) return <Empty />;
  return <MarginExceptionsTableView rows={rows} />;
}

async function ExpiredTable({ canArchive }: { canArchive: boolean }) {
  const rows = await getExpiredLicenses();
  if (rows.length === 0) return <Empty />;
  return <ExpiredTableView rows={rows} canArchive={canArchive} />;
}

function Empty() {
  return (
    <EmptyState
      title="Nothing to report yet"
      description="This report is computed from synced and billed data. It will populate once you sync connectors and create billing runs."
    />
  );
}
