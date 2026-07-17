import type { CrmLine, CrmStage } from "@prisma/client";
import { effectiveMarginAmount, fiscalYearFor } from "./constants";
import type { SpendMover } from "@/lib/reports/dso";

/**
 * "My Clients" analytics — pure and unit-tested. Aggregates a sales rep's won
 * opportunities by account so a rep can see what each of their clients is doing:
 * current fiscal-year gross revenue/margin, lifetime spend, recency of the last
 * purchase, and year-over-year spend movement (expanding vs contracting).
 *
 * Callers map Prisma rows (Decimal money, Date) into plain numbers before calling
 * so this stays dependency-free. Margin is normalized here via
 * `effectiveMarginAmount` (100% on Managed Services), matching the rest of CRM.
 */
export interface MyClientOppInput {
  accountName: string;
  line: CrmLine;
  stage: CrmStage;
  /** TCV revenue (already derived on the opportunity). */
  amount: number;
  /** Stored margin amount; null when unknown. */
  marginAmount: number | null;
  closeDate: Date;
}

export interface MyClientRow {
  account: string;
  /** Current-FY won revenue. */
  grossRevenue: number;
  /** Current-FY won gross margin (effective). */
  grossMargin: number;
  /** Revenue-weighted gross-margin %; null when no current-FY revenue. */
  avgMarginPct: number | null;
  /** Lifetime (all-time) won revenue. */
  totalSpend: number;
  /** Most recent won close date across all time; null when none. */
  lastPurchase: Date | null;
  /** Whole days from the last purchase to `now`; null when never purchased. */
  daysSinceLastPurchase: number | null;
}

export interface MyClientsReport {
  hasData: boolean;
  fyLabel: string;
  /** Ending calendar year of the current fiscal year (column header). */
  compareYear: number;
  /** Ending calendar year of the prior fiscal year (column header). */
  priorYear: number;
  rows: MyClientRow[];
  spendMovers: { up: SpendMover[]; down: SpendMover[] };
}

const DAY = 86_400_000;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

interface Accum {
  currentRevenue: number;
  currentMargin: number;
  priorRevenue: number;
  totalSpend: number;
  lastPurchase: Date | null;
}

/**
 * Build the My Clients report from a rep's won opportunities. `now` is injected
 * so the fiscal-year math stays pure and testable.
 */
export function computeMyClients(
  opps: MyClientOppInput[],
  now: Date,
): MyClientsReport {
  const fy = fiscalYearFor(now);
  const fyPrior = fiscalYearFor(new Date(fy.start.getTime() - 1));
  const compareYear = fy.end.getUTCFullYear();
  const priorYear = fyPrior.end.getUTCFullYear();

  const inWindow = (d: Date, w: { start: Date; end: Date }) =>
    d.getTime() >= w.start.getTime() && d.getTime() <= w.end.getTime();

  const byAccount = new Map<string, Accum>();
  for (const o of opps) {
    if (o.stage !== "CLOSED_WON") continue;
    const account = o.accountName?.trim() || "Unknown account";
    const amount = o.amount || 0;
    const margin = effectiveMarginAmount(o.line, amount, o.marginAmount);
    const a =
      byAccount.get(account) ??
      { currentRevenue: 0, currentMargin: 0, priorRevenue: 0, totalSpend: 0, lastPurchase: null };
    a.totalSpend += amount;
    if (!a.lastPurchase || o.closeDate.getTime() > a.lastPurchase.getTime()) {
      a.lastPurchase = o.closeDate;
    }
    if (inWindow(o.closeDate, fy)) {
      a.currentRevenue += amount;
      a.currentMargin += margin;
    } else if (inWindow(o.closeDate, fyPrior)) {
      a.priorRevenue += amount;
    }
    byAccount.set(account, a);
  }

  const rows: MyClientRow[] = [...byAccount.entries()]
    .map(([account, a]) => ({
      account,
      grossRevenue: round2(a.currentRevenue),
      grossMargin: round2(a.currentMargin),
      avgMarginPct:
        a.currentRevenue > 0
          ? Math.round((a.currentMargin / a.currentRevenue) * 1000) / 10
          : null,
      totalSpend: round2(a.totalSpend),
      lastPurchase: a.lastPurchase,
      daysSinceLastPurchase: a.lastPurchase
        ? Math.floor((now.getTime() - a.lastPurchase.getTime()) / DAY)
        : null,
    }))
    .sort((x, y) => y.grossRevenue - x.grossRevenue || y.totalSpend - x.totalSpend);

  // Year-over-year spend movers (current FY vs prior FY), by won revenue.
  const movers: SpendMover[] = [...byAccount.entries()]
    .filter(([, a]) => a.currentRevenue > 0 || a.priorRevenue > 0)
    .map(([account, a]) => {
      const change = round2(a.currentRevenue - a.priorRevenue);
      return {
        customer: account,
        spendPrior: round2(a.priorRevenue),
        spendCurrent: round2(a.currentRevenue),
        change,
        pctChange:
          a.priorRevenue > 0
            ? Math.round((change / a.priorRevenue) * 1000) / 10
            : null,
      };
    })
    .filter((m) => m.change !== 0);

  const up = movers
    .filter((m) => m.change > 0)
    .sort((x, y) => y.change - x.change);
  const down = movers
    .filter((m) => m.change < 0)
    .sort((x, y) => x.change - y.change);

  return {
    hasData: byAccount.size > 0,
    fyLabel: fy.label,
    compareYear,
    priorYear,
    rows,
    spendMovers: { up, down },
  };
}
