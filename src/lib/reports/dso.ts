/**
 * Cash-Flow / DSO analytics — pure and dependency-free so it's unit-testable and
 * reusable. Built from QuickBooks invoices + received payments (each payment
 * carries per-invoice allocations). Terms are taken from each invoice's due date
 * (falling back to the invoice date when QBO didn't set one).
 *
 * Key definitions:
 * - Real collection DSO  = cash-weighted days from invoice date to cash receipt.
 * - Days late vs terms   = payment date − due date (negative = early).
 * - Cash-flow drag        = amount × days late, in dollar-days (only late dollars).
 * - Payment tier         = a customer's cash-weighted average days late bucketed.
 */

export interface CashFlowInvoice {
  qboId: string;
  customerId: string;
  customerName: string;
  txnDate: Date;
  dueDate: Date | null;
  total: number;
}

export interface CashFlowPayment {
  txnDate: Date;
  lines: { invoiceId: string; amount: number }[];
}

const DAY = 86_400_000;
const dayDiff = (a: Date, b: Date): number => Math.round((a.getTime() - b.getTime()) / DAY);
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

export type Tier =
  | "Early / on-time"
  | "1-30 days late"
  | "31-90 days late"
  | "91+ days late"
  | "No matched cash";

function tierFor(avgDaysLate: number | null): Tier {
  if (avgDaysLate === null) return "No matched cash";
  if (avgDaysLate <= 0) return "Early / on-time";
  if (avgDaysLate <= 30) return "1-30 days late";
  if (avgDaysLate <= 90) return "31-90 days late";
  return "91+ days late";
}

export interface CustomerRow {
  customerId: string;
  customer: string;
  invoiced: number; // total invoiced (all time)
  cashReceived: number;
  dso: number | null; // cash-weighted invoice→cash days
  avgDaysLate: number | null; // cash-weighted days late vs terms
  onTimeCashPct: number | null;
  drag: number; // dollar-days of lateness
  tier: Tier;
}

export interface TierSummary {
  tier: Tier;
  customers: number;
  pctCustomers: number;
  cashReceived: number;
  drag: number;
}

export interface Mover {
  customer: string;
  prior: number;
  current: number;
  change: number;
  cash: number;
}

export interface SpendMover {
  customer: string;
  spendPrior: number;
  spendCurrent: number;
  change: number;
  pctChange: number | null;
}

export interface CashFlowReport {
  hasData: boolean;
  kpis: {
    realDso: number;
    onTimeCashPct: number;
    avgDaysLate: number;
    totalCashMatched: number;
    totalDrag: number; // dollar-days
    customers: number;
    customersEarlyOnTime: number;
    pctCustomersEarlyOnTime: number;
  };
  tiers: TierSummary[];
  customers: CustomerRow[]; // all, sorted by cash received desc
  topRevenue: CustomerRow[];
  topDrag: CustomerRow[];
  worstLate: CustomerRow[];
  bestReliable: CustomerRow[];
  compareYear: number | null;
  priorYear: number | null;
  paymentMovers: { improved: Mover[]; worsened: Mover[] };
  spendMovers: { up: SpendMover[]; down: SpendMover[] };
}

const TIER_ORDER: Tier[] = [
  "Early / on-time",
  "1-30 days late",
  "31-90 days late",
  "91+ days late",
  "No matched cash",
];

export function computeCashFlowReport(
  invoices: CashFlowInvoice[],
  payments: CashFlowPayment[],
  topN = 10,
): CashFlowReport {
  const invById = new Map(invoices.map((i) => [i.qboId, i]));

  // Per-customer accumulators.
  interface Acc {
    customer: string;
    invoiced: number;
    cash: number;
    wDaysToCash: number; // Σ amount × daysToCash
    wDaysLate: number; // Σ amount × daysLate
    onTimeCash: number; // Σ amount where daysLate ≤ 0
    drag: number; // Σ amount × max(0, daysLate)
    // Per calendar year of the invoice cohort: cash + Σ amount×daysLate.
    byYear: Map<number, { cash: number; wLate: number }>;
  }
  const acc = new Map<string, Acc>();
  const ensure = (id: string, name: string): Acc => {
    let a = acc.get(id);
    if (!a) {
      a = { customer: name, invoiced: 0, cash: 0, wDaysToCash: 0, wDaysLate: 0, onTimeCash: 0, drag: 0, byYear: new Map() };
      acc.set(id, a);
    }
    if (name && a.customer === id) a.customer = name;
    return a;
  };

  // Invoiced revenue (all time) + per-year invoiced spend.
  const spendByYear = new Map<string, Map<number, number>>();
  for (const inv of invoices) {
    const a = ensure(inv.customerId, inv.customerName || inv.customerId);
    a.invoiced += inv.total;
    const y = inv.txnDate.getUTCFullYear();
    const m = spendByYear.get(inv.customerId) ?? new Map<number, number>();
    m.set(y, (m.get(y) ?? 0) + inv.total);
    spendByYear.set(inv.customerId, m);
  }

  // Cash allocations against invoices.
  let totalCash = 0;
  let gWDaysToCash = 0;
  let gWDaysLate = 0;
  let gOnTime = 0;
  let totalDrag = 0;
  for (const p of payments) {
    for (const ln of p.lines) {
      const inv = invById.get(ln.invoiceId);
      if (!inv || ln.amount <= 0) continue;
      const due = inv.dueDate ?? inv.txnDate;
      const daysToCash = dayDiff(p.txnDate, inv.txnDate);
      const daysLate = dayDiff(p.txnDate, due);
      const a = ensure(inv.customerId, inv.customerName || inv.customerId);
      a.cash += ln.amount;
      a.wDaysToCash += ln.amount * daysToCash;
      a.wDaysLate += ln.amount * daysLate;
      if (daysLate <= 0) a.onTimeCash += ln.amount;
      const lateDrag = ln.amount * Math.max(0, daysLate);
      a.drag += lateDrag;
      const y = inv.txnDate.getUTCFullYear();
      const yr = a.byYear.get(y) ?? { cash: 0, wLate: 0 };
      yr.cash += ln.amount;
      yr.wLate += ln.amount * daysLate;
      a.byYear.set(y, yr);
      totalCash += ln.amount;
      gWDaysToCash += ln.amount * daysToCash;
      gWDaysLate += ln.amount * daysLate;
      if (daysLate <= 0) gOnTime += ln.amount;
      totalDrag += lateDrag;
    }
  }

  const rows: CustomerRow[] = [...acc.entries()].map(([id, a]) => {
    const avgLate = a.cash > 0 ? a.wDaysLate / a.cash : null;
    return {
      customerId: id,
      customer: a.customer,
      invoiced: round2(a.invoiced),
      cashReceived: round2(a.cash),
      dso: a.cash > 0 ? round1(a.wDaysToCash / a.cash) : null,
      avgDaysLate: avgLate === null ? null : round1(avgLate),
      onTimeCashPct: a.cash > 0 ? round1((a.onTimeCash / a.cash) * 100) : null,
      drag: Math.round(a.drag),
      tier: tierFor(avgLate),
    };
  });
  rows.sort((x, y) => y.cashReceived - x.cashReceived);

  const customerCount = rows.length;
  const tiers: TierSummary[] = TIER_ORDER.map((tier) => {
    const inTier = rows.filter((r) => r.tier === tier);
    return {
      tier,
      customers: inTier.length,
      pctCustomers: customerCount > 0 ? round1((inTier.length / customerCount) * 100) : 0,
      cashReceived: round2(inTier.reduce((s, r) => s + r.cashReceived, 0)),
      drag: inTier.reduce((s, r) => s + r.drag, 0),
    };
  });

  const earlyOnTime = rows.filter((r) => r.tier === "Early / on-time").length;

  // YoY cohorts: the two most recent invoice years present in the data.
  const years = [...new Set(invoices.map((i) => i.txnDate.getUTCFullYear()))].sort((a, b) => b - a);
  const compareYear = years[0] ?? null;
  const priorYear = compareYear !== null ? compareYear - 1 : null;

  const paymentMovers: { improved: Mover[]; worsened: Mover[] } = { improved: [], worsened: [] };
  const spendMovers: { up: SpendMover[]; down: SpendMover[] } = { up: [], down: [] };
  if (compareYear !== null && priorYear !== null) {
    // Payment behaviour: cash-weighted avg days late by invoice-year cohort.
    const movers: Mover[] = [];
    for (const [, a] of acc) {
      const cur = a.byYear.get(compareYear);
      const pri = a.byYear.get(priorYear);
      if (!cur || !pri || cur.cash <= 0 || pri.cash <= 0) continue;
      const current = round1(cur.wLate / cur.cash);
      const prior = round1(pri.wLate / pri.cash);
      movers.push({ customer: a.customer, prior, current, change: round1(current - prior), cash: round2(cur.cash) });
    }
    paymentMovers.improved = movers.filter((m) => m.change < 0).sort((x, y) => x.change - y.change).slice(0, topN);
    paymentMovers.worsened = movers.filter((m) => m.change > 0).sort((x, y) => y.change - x.change).slice(0, topN);

    // Spend movers: invoiced revenue by calendar year.
    const sm: SpendMover[] = [];
    for (const [id, m] of spendByYear) {
      const spendCurrent = round2(m.get(compareYear) ?? 0);
      const spendPrior = round2(m.get(priorYear) ?? 0);
      if (spendCurrent === 0 && spendPrior === 0) continue;
      const change = round2(spendCurrent - spendPrior);
      if (change === 0) continue;
      sm.push({
        customer: acc.get(id)?.customer ?? id,
        spendPrior,
        spendCurrent,
        change,
        pctChange: spendPrior > 0 ? round1((change / spendPrior) * 100) : null,
      });
    }
    spendMovers.up = sm.filter((s) => s.change > 0).sort((x, y) => y.change - x.change).slice(0, topN);
    spendMovers.down = sm.filter((s) => s.change < 0).sort((x, y) => x.change - y.change).slice(0, topN);
  }

  const withCash = rows.filter((r) => r.cashReceived > 0);

  return {
    hasData: invoices.length > 0,
    kpis: {
      realDso: totalCash > 0 ? round1(gWDaysToCash / totalCash) : 0,
      onTimeCashPct: totalCash > 0 ? round1((gOnTime / totalCash) * 100) : 0,
      avgDaysLate: totalCash > 0 ? round1(gWDaysLate / totalCash) : 0,
      totalCashMatched: round2(totalCash),
      totalDrag: Math.round(totalDrag),
      customers: customerCount,
      customersEarlyOnTime: earlyOnTime,
      pctCustomersEarlyOnTime: customerCount > 0 ? round1((earlyOnTime / customerCount) * 100) : 0,
    },
    tiers,
    customers: rows,
    topRevenue: [...rows].slice(0, topN),
    topDrag: [...rows].sort((x, y) => y.drag - x.drag).filter((r) => r.drag > 0).slice(0, topN),
    worstLate: withCash
      .filter((r) => (r.avgDaysLate ?? 0) > 0)
      .sort((x, y) => (y.avgDaysLate ?? 0) - (x.avgDaysLate ?? 0))
      .slice(0, topN),
    bestReliable: withCash
      .filter((r) => (r.avgDaysLate ?? 0) <= 0)
      .sort((x, y) => y.cashReceived - x.cashReceived)
      .slice(0, topN),
    compareYear,
    priorYear,
    paymentMovers,
    spendMovers,
  };
}
