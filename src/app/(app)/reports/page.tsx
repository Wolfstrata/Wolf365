import Link from "next/link";
import { BarChart3, ChevronRight } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card } from "@/components/ui/primitives";

/**
 * Reports index. Each report is computed from real synced + billing data and
 * will render honest empty results until that data exists.
 */
const REPORTS = [
  {
    href: "/reports/renewals",
    title: "Upcoming renewals",
    description: "M365 licensing renewing within 90 days, by client.",
  },
  {
    href: "/reports/margin-exceptions",
    title: "Margin exceptions",
    description: "Synced M365 lines sold under cost (suggested price below cost).",
  },
  {
    href: "/reports/expired",
    title: "Expired licenses",
    description: "M365 licensing whose term has lapsed (past end date or expired).",
  },
  {
    href: "/reports/leakage",
    title: "Revenue leakage",
    description: "Licenses present in TD SYNNEX but not billed in QuickBooks.",
  },
  {
    href: "/reports/overbilling",
    title: "Overbilling risk",
    description: "QBO billing items that no longer exist in TD SYNNEX.",
  },
  {
    href: "/reports/margin",
    title: "Margin report",
    description: "Estimated TD SYNNEX cost vs. invoiced revenue by client/SKU.",
  },
  {
    href: "/exceptions",
    title: "Exception queue",
    description: "Unmapped clients/SKUs, missing prices, and discrepancies.",
  },
];

export default async function ReportsPage() {
  await requirePermission("reports:read");
  return (
    <div>
      <PageHeader
        title="Reports"
        description="Reconciliation and revenue-integrity reports with CSV/Excel export."
      />
      <div className="grid grid-cols-1 gap-4 p-4 sm:p-8 sm:grid-cols-2">
        {REPORTS.map((r) => (
          <Link key={r.href} href={r.href}>
            <Card className="flex items-center justify-between transition hover:border-primary/40">
              <div>
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-muted-foreground" />
                  <h2 className="font-medium">{r.title}</h2>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{r.description}</p>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
