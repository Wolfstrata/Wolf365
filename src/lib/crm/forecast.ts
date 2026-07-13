import type { CrmLine, CrmStage } from "@prisma/client";
import {
  isOpenStage,
  COMMIT_THRESHOLD,
  BEST_CASE_THRESHOLD,
  CRM_LINE_ORDER,
} from "./constants";

/**
 * Pure sales-forecast math. Dependency-free and unit-tested. Callers map Prisma
 * rows (Decimal money, Date) into plain numbers / ISO month keys before calling.
 */
export interface ForecastOpportunityInput {
  line: CrmLine;
  stage: CrmStage;
  amount: number;
  marginAmount: number;
  /** 0–100. */
  probability: number;
  /** Close month key "YYYY-MM" (caller derives, so this stays pure). */
  closeMonth: string;
}

export interface Bucket {
  count: number;
  amount: number;
  /** amount × probability/100, summed (open deals only). */
  weighted: number;
}

export interface ForecastSummary {
  /** Open (not closed) deals. */
  openCount: number;
  openAmount: number;
  weightedPipeline: number;
  /** Closed Won. */
  wonCount: number;
  wonAmount: number;
  wonMargin: number;
  /** Closed Lost. */
  lostCount: number;
  lostAmount: number;
  /** Won / (Won + Lost) by count, 0 when none closed. */
  winRatePct: number;
  byStage: Record<CrmStage, Bucket>;
  byLine: Record<CrmLine, Bucket>;
  /** Open pipeline by close month, ascending by key. */
  byMonth: Array<{ month: string } & Bucket>;
}

function emptyBucket(): Bucket {
  return { count: 0, amount: 0, weighted: 0 };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function add(b: Bucket, amount: number, weighted: number): void {
  b.count += 1;
  b.amount += amount;
  b.weighted += weighted;
}

function tidy(b: Bucket): Bucket {
  return { count: b.count, amount: round2(b.amount), weighted: round2(b.weighted) };
}

export function computeForecast(
  opps: ForecastOpportunityInput[],
): ForecastSummary {
  const byStage: Record<string, Bucket> = {};
  const byLine: Record<string, Bucket> = {};
  const byMonth: Record<string, Bucket> = {};

  let openCount = 0,
    openAmount = 0,
    weightedPipeline = 0,
    wonCount = 0,
    wonAmount = 0,
    wonMargin = 0,
    lostCount = 0,
    lostAmount = 0;

  for (const o of opps) {
    const amount = o.amount || 0;
    const open = isOpenStage(o.stage);
    const weighted = open ? amount * (o.probability / 100) : 0;

    add((byStage[o.stage] ??= emptyBucket()), amount, weighted);
    add((byLine[o.line] ??= emptyBucket()), amount, weighted);

    if (open) {
      openCount += 1;
      openAmount += amount;
      weightedPipeline += weighted;
      add((byMonth[o.closeMonth] ??= emptyBucket()), amount, weighted);
    } else if (o.stage === "CLOSED_WON") {
      wonCount += 1;
      wonAmount += amount;
      wonMargin += o.marginAmount || 0;
    } else if (o.stage === "CLOSED_LOST") {
      lostCount += 1;
      lostAmount += amount;
    }
  }

  const closed = wonCount + lostCount;
  const STAGES: CrmStage[] = [
    "PROSPECTING",
    "QUALIFICATION",
    "PROPOSAL",
    "NEGOTIATION",
    "CLOSED_WON",
    "CLOSED_LOST",
  ];
  const LINES: CrmLine[] = CRM_LINE_ORDER;

  return {
    openCount,
    openAmount: round2(openAmount),
    weightedPipeline: round2(weightedPipeline),
    wonCount,
    wonAmount: round2(wonAmount),
    wonMargin: round2(wonMargin),
    lostCount,
    lostAmount: round2(lostAmount),
    winRatePct: closed > 0 ? Math.round((wonCount / closed) * 1000) / 10 : 0,
    byStage: Object.fromEntries(
      STAGES.map((s) => [s, tidy(byStage[s] ?? emptyBucket())]),
    ) as Record<CrmStage, Bucket>,
    byLine: Object.fromEntries(
      LINES.map((l) => [l, tidy(byLine[l] ?? emptyBucket())]),
    ) as Record<CrmLine, Bucket>,
    byMonth: Object.keys(byMonth)
      .sort()
      .map((month) => ({ month, ...tidy(byMonth[month] ?? emptyBucket()) })),
  };
}

/**
 * Forecast grid mirroring the classic sales sheet: one row per close month with
 * cumulative roll-up columns, plus a totals row.
 *
 *   Closed Only        = won (PO received)
 *   Commit Forecast    = Closed + Commit (99%, verbal commitment)
 *   Best Case Forecast = Closed + Commit + Best Case (75%+)
 *   Open Pipeline      = the rest of the open funnel (0–74%)
 *
 * Closed Lost / Omitted are excluded. Months between the earliest and latest
 * are filled (up to a cap) so it reads like a schedule.
 */
export interface ForecastGridRow {
  month: string;
  closedOnly: number;
  commit: number;
  bestCase: number;
  openPipeline: number;
}

const MAX_GRID_MONTHS = 24;

function nextMonth(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y!, (m! - 1) + 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function forecastGrid(opps: ForecastOpportunityInput[]): {
  rows: ForecastGridRow[];
  total: ForecastGridRow;
} {
  // Raw per-month category buckets (non-cumulative).
  const raw: Record<
    string,
    { closed: number; commit: number; best: number; pipeline: number }
  > = {};

  for (const o of opps) {
    if (o.stage === "CLOSED_LOST") continue;
    const amount = o.amount || 0;
    const bucket = (raw[o.closeMonth] ??= {
      closed: 0,
      commit: 0,
      best: 0,
      pipeline: 0,
    });
    if (o.stage === "CLOSED_WON") bucket.closed += amount;
    else if (o.probability >= COMMIT_THRESHOLD) bucket.commit += amount;
    else if (o.probability >= BEST_CASE_THRESHOLD) bucket.best += amount;
    else bucket.pipeline += amount;
  }

  const present = Object.keys(raw).sort();
  let months = present;
  // Fill contiguous months between first and last (capped) for a schedule feel.
  if (present.length > 1) {
    const filled: string[] = [];
    let cur = present[0]!;
    const last = present[present.length - 1]!;
    while (cur <= last && filled.length < MAX_GRID_MONTHS) {
      filled.push(cur);
      cur = nextMonth(cur);
    }
    months = filled.includes(last) ? filled : present;
  }

  const rows: ForecastGridRow[] = months.map((month) => {
    const b = raw[month] ?? { closed: 0, commit: 0, best: 0, pipeline: 0 };
    return {
      month,
      closedOnly: round2(b.closed),
      commit: round2(b.closed + b.commit),
      bestCase: round2(b.closed + b.commit + b.best),
      openPipeline: round2(b.pipeline),
    };
  });

  const total = rows.reduce<ForecastGridRow>(
    (t, r) => ({
      month: "",
      closedOnly: t.closedOnly + r.closedOnly,
      commit: t.commit + r.commit,
      bestCase: t.bestCase + r.bestCase,
      openPipeline: t.openPipeline + r.openPipeline,
    }),
    { month: "", closedOnly: 0, commit: 0, bestCase: 0, openPipeline: 0 },
  );
  total.closedOnly = round2(total.closedOnly);
  total.commit = round2(total.commit);
  total.bestCase = round2(total.bestCase);
  total.openPipeline = round2(total.openPipeline);

  return { rows, total };
}

/** Margin % = marginAmount / amount × 100. 0 when amount is 0/absent. */
export function computeMarginPercentage(
  amount: number | null | undefined,
  marginAmount: number | null | undefined,
): number {
  const a = amount ?? 0;
  const m = marginAmount ?? 0;
  if (a === 0) return 0;
  return Math.round((m / a) * 10000) / 100;
}
