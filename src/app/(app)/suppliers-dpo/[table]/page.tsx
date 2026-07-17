import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/primitives";
import { resolveDateWindow } from "@/lib/reports/cash-flow";
import { getSuppliersReport } from "@/lib/reports/suppliers";
import {
  CustomerTable,
  FollowUpTable,
  TierTable,
  MoverTable,
  SpendMoverTable,
  SUPPLIER_LABELS,
} from "../../cash-flow/tables";

export const maxDuration = 120;

const TITLES: Record<string, string> = {
  tiers: "Supplier payment tiers",
  "follow-up": "Overdue suppliers to prioritise paying — all",
  revenue: "Spend concentration — all suppliers by amount paid",
  drag: "Overdue payables — all suppliers ($-days)",
  "worst-late": "Suppliers we pay latest — all",
  "best-reliable": "Suppliers we pay most reliably — all",
  "payment-movers": "Year-over-year payment movers — all",
  "spend-movers": "Year-over-year spend movers — all",
};

/** Full-list view for a single Suppliers & Expenses / DPO table (no top-N cap). */
export default async function SuppliersDpoTablePage({
  params,
  searchParams,
}: {
  params: Promise<{ table: string }>;
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  await requirePermission("billing:read");
  const { table } = await params;
  const title = TITLES[table];
  if (!title) notFound();

  const sp = await searchParams;
  const range = sp.range ?? "fiscal";
  const window = resolveDateWindow(range, sp.from, sp.to, new Date());
  // Large limit → effectively all rows.
  const report = await getSuppliersReport(window, 100_000);

  const qs = new URLSearchParams();
  if (sp.range) qs.set("range", sp.range);
  if (sp.from) qs.set("from", sp.from);
  if (sp.to) qs.set("to", sp.to);
  const backHref = `/suppliers-dpo${qs.toString() ? `?${qs}` : ""}`;

  return (
    <div>
      <PageHeader title={title} description={`${window.label}. Source: QuickBooks bills and bill payments.`} />
      <div className="space-y-6 p-4 sm:p-8">
        <Link href={backHref} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to Suppliers &amp; Expenses / DPO
        </Link>

        {!report || !report.hasData ? (
          <p className="text-sm text-muted-foreground">No data in the selected range.</p>
        ) : table === "tiers" ? (
          <TierTable tiers={report.tiers} labels={SUPPLIER_LABELS} />
        ) : table === "follow-up" ? (
          <FollowUpTable rows={report.followUp} labels={SUPPLIER_LABELS} />
        ) : table === "revenue" ? (
          <CustomerTable rows={report.topRevenue} variant="revenue" labels={SUPPLIER_LABELS} />
        ) : table === "drag" ? (
          <CustomerTable rows={report.topDrag} variant="drag" labels={SUPPLIER_LABELS} />
        ) : table === "worst-late" ? (
          <CustomerTable rows={report.worstLate} variant="worst" labels={SUPPLIER_LABELS} />
        ) : table === "best-reliable" ? (
          <CustomerTable rows={report.bestReliable} variant="best" labels={SUPPLIER_LABELS} />
        ) : table === "payment-movers" ? (
          report.compareYear && report.priorYear ? (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <MoverTable rows={report.paymentMovers.improved} priorYear={report.priorYear} compareYear={report.compareYear} kind="improved" />
              <MoverTable rows={report.paymentMovers.worsened} priorYear={report.priorYear} compareYear={report.compareYear} kind="worsened" />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Not enough history for a year-over-year comparison.</p>
          )
        ) : report.compareYear && report.priorYear ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <SpendMoverTable rows={report.spendMovers.up} priorYear={report.priorYear} compareYear={report.compareYear} kind="up" />
            <SpendMoverTable rows={report.spendMovers.down} priorYear={report.priorYear} compareYear={report.compareYear} kind="down" />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Not enough history for a year-over-year comparison.</p>
        )}
      </div>
    </div>
  );
}
