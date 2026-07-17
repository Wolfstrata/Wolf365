import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/primitives";
import { getCashFlowReport, resolveDateWindow } from "@/lib/reports/cash-flow";
import {
  CustomerTable,
  FollowUpTable,
  TierTable,
  MoverTable,
  SpendMoverTable,
} from "../tables";

export const maxDuration = 120;

const TITLES: Record<string, string> = {
  tiers: "Customer payment tiers",
  "follow-up": "Late-payment follow-up priority — all customers",
  revenue: "Revenue concentration — all customers by cash received",
  drag: "Cash-flow drag — all late customers ($-days)",
  "worst-late": "Repeat late payers — all",
  "best-reliable": "Reliable revenue accounts — all",
  "payment-movers": "Year-over-year payment movers — all",
  "spend-movers": "Year-over-year spend movers — all",
};

/** Full-list view for a single Cash-Flow / DSO table (no top-N truncation). */
export default async function CashFlowTablePage({
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
  const report = await getCashFlowReport(window, 100_000);

  const qs = new URLSearchParams();
  if (sp.range) qs.set("range", sp.range);
  if (sp.from) qs.set("from", sp.from);
  if (sp.to) qs.set("to", sp.to);
  const backHref = `/cash-flow${qs.toString() ? `?${qs}` : ""}`;

  return (
    <div>
      <PageHeader title={title} description={`${window.label}. Source: QuickBooks invoices and received payments.`} />
      <div className="space-y-6 p-4 sm:p-8">
        <Link href={backHref} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to Cash-Flow / DSO
        </Link>

        {!report || !report.hasData ? (
          <p className="text-sm text-muted-foreground">No data in the selected range.</p>
        ) : table === "tiers" ? (
          <TierTable tiers={report.tiers} />
        ) : table === "follow-up" ? (
          <FollowUpTable rows={report.followUp} />
        ) : table === "revenue" ? (
          <CustomerTable rows={report.topRevenue} variant="revenue" />
        ) : table === "drag" ? (
          <CustomerTable rows={report.topDrag} variant="drag" />
        ) : table === "worst-late" ? (
          <CustomerTable rows={report.worstLate} variant="worst" />
        ) : table === "best-reliable" ? (
          <CustomerTable rows={report.bestReliable} variant="best" />
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
