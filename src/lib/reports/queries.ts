import "server-only";
import { prisma } from "@/lib/db";
import { renewalWindow, type RenewalBucket } from "@/lib/licensing/renewal";

/**
 * Report computations. Each returns plain row objects (column-keyed) so the
 * same data drives both the on-screen table and the CSV export. All figures are
 * derived from real synced + billing data — empty inputs yield empty reports.
 */

// Runs whose lines represent committed/billed revenue.
const BILLED_STATUSES = ["APPROVED", "PUSHED", "PARTIALLY_FAILED"] as const;

export interface MarginRow {
  client: string;
  description: string;
  revenue: number;
  estimatedCost: number;
  margin: number;
  marginPct: number;
}

export async function getMarginReport(): Promise<MarginRow[]> {
  const lines = await prisma.billingLine.findMany({
    where: { billingRun: { status: { in: [...BILLED_STATUSES] } } },
    include: { billingRun: { include: { client: true } } },
  });

  const map = new Map<string, MarginRow>();
  for (const l of lines) {
    const client = l.billingRun.client?.name ?? "Unknown";
    const key = `${client}::${l.description}`;
    const row =
      map.get(key) ??
      { client, description: l.description, revenue: 0, estimatedCost: 0, margin: 0, marginPct: 0 };
    row.revenue += Number(l.total);
    row.estimatedCost += l.estimatedCost != null ? Number(l.estimatedCost) : 0;
    map.set(key, row);
  }
  return Array.from(map.values())
    .map((r) => {
      const margin = round2(r.revenue - r.estimatedCost);
      return {
        ...r,
        revenue: round2(r.revenue),
        estimatedCost: round2(r.estimatedCost),
        margin,
        marginPct: r.revenue > 0 ? Math.round((margin / r.revenue) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.margin - a.margin);
}

export interface LeakageRow {
  client: string;
  sku: string;
  product: string;
  quantity: number;
  estimatedMonthlyCost: number;
}

/** Active TD SYNNEX subscriptions not represented in any non-cancelled run. */
export async function getRevenueLeakage(): Promise<LeakageRow[]> {
  const subs = await prisma.tdSynnexSubscription.findMany({
    where: { customer: { clientId: { not: null } } },
    include: { customer: { include: { client: true } } },
  });

  const billed = await prisma.billingLine.findMany({
    where: {
      tdSynnexSubscriptionId: { not: null },
      billingRun: { status: { not: "CANCELLED" } },
    },
    select: { tdSynnexSubscriptionId: true },
  });
  const billedIds = new Set(billed.map((b) => b.tdSynnexSubscriptionId));

  return subs
    .filter((s) => !billedIds.has(s.id))
    .map((s) => ({
      client: s.customer.client?.name ?? s.customer.name,
      sku: s.productSku ?? "—",
      product: s.productName ?? "—",
      quantity: s.quantity,
      estimatedMonthlyCost:
        s.unitCost != null ? round2(Number(s.unitCost) * s.quantity) : 0,
    }))
    .sort((a, b) => b.estimatedMonthlyCost - a.estimatedMonthlyCost);
}

export interface OverbillingRow {
  client: string;
  description: string;
  total: number;
  reason: string;
}

/** Pushed billing lines whose TD SYNNEX subscription is gone or inactive. */
export async function getOverbillingRisk(): Promise<OverbillingRow[]> {
  const lines = await prisma.billingLine.findMany({
    where: { billingRun: { status: { in: ["PUSHED", "PARTIALLY_FAILED"] } } },
    include: { billingRun: { include: { client: true } } },
  });

  const subIds = lines
    .map((l) => l.tdSynnexSubscriptionId)
    .filter((s): s is string => !!s);
  const subs = await prisma.tdSynnexSubscription.findMany({
    where: { id: { in: subIds } },
  });
  const subById = new Map(subs.map((s) => [s.id, s]));

  const rows: OverbillingRow[] = [];
  for (const l of lines) {
    const sub = l.tdSynnexSubscriptionId
      ? subById.get(l.tdSynnexSubscriptionId)
      : undefined;
    let reason: string | null = null;
    if (!l.tdSynnexSubscriptionId) reason = "No linked TD SYNNEX subscription";
    else if (!sub) reason = "TD SYNNEX subscription no longer exists";
    else if (sub.status && /cancel|inactive|suspend/i.test(sub.status))
      reason = `TD SYNNEX subscription is ${sub.status}`;
    if (reason) {
      rows.push({
        client: l.billingRun.client?.name ?? "Unknown",
        description: l.description,
        total: Number(l.total),
        reason,
      });
    }
  }
  return rows.sort((a, b) => b.total - a.total);
}

export interface ChangeRow {
  description: string;
  previous: number;
  current: number;
  delta: number;
  explanation: string;
}

/** Plain-English diff between a client's two most recent non-cancelled runs. */
export async function getChangeExplanation(
  clientId: string,
): Promise<{ runs: number; rows: ChangeRow[] }> {
  const runs = await prisma.billingRun.findMany({
    where: { clientId, status: { not: "CANCELLED" } },
    orderBy: { createdAt: "desc" },
    take: 2,
    include: { lines: true },
  });
  if (runs.length < 2) return { runs: runs.length, rows: [] };

  const [current, previous] = runs;
  const prevByDesc = new Map(previous!.lines.map((l) => [l.description, Number(l.total)]));
  const curByDesc = new Map(current!.lines.map((l) => [l.description, Number(l.total)]));
  const all = new Set([...prevByDesc.keys(), ...curByDesc.keys()]);

  const rows: ChangeRow[] = [];
  for (const desc of all) {
    const prev = prevByDesc.get(desc) ?? 0;
    const cur = curByDesc.get(desc) ?? 0;
    if (round2(prev) === round2(cur)) continue;
    const delta = round2(cur - prev);
    let explanation: string;
    if (prev === 0) explanation = "New line item this period.";
    else if (cur === 0) explanation = "Item removed since last period.";
    else explanation = `${delta > 0 ? "Increased" : "Decreased"} by ${Math.abs(delta).toFixed(2)} (quantity, proration, or price change).`;
    rows.push({ description: desc, previous: round2(prev), current: round2(cur), delta, explanation });
  }
  return { runs: runs.length, rows: rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)) };
}

export interface RenewalReportRow {
  client: string;
  clientId: string | null;
  sku: string;
  product: string;
  quantity: number;
  renewalDate: string; // YYYY-MM-DD
  daysUntil: number;
  bucket: RenewalBucket;
}

/** TD SYNNEX subscriptions renewing within the next `withinDays` days. */
export async function getUpcomingRenewals(withinDays = 90): Promise<RenewalReportRow[]> {
  const now = new Date();
  const horizon = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000);
  const subs = await prisma.tdSynnexSubscription.findMany({
    where: { renewalDate: { gte: now, lte: horizon } },
    include: { customer: { include: { client: true } } },
    orderBy: { renewalDate: "asc" },
  });
  const rows: RenewalReportRow[] = [];
  for (const s of subs) {
    const win = renewalWindow(s.renewalDate, now);
    if (!win) continue;
    rows.push({
      client: s.customer.client?.name ?? s.customer.name,
      clientId: s.customer.clientId,
      sku: s.productSku ?? "—",
      product: s.productName ?? "—",
      quantity: s.quantity,
      renewalDate: s.renewalDate ? s.renewalDate.toISOString().slice(0, 10) : "—",
      daysUntil: win.daysUntil,
      bucket: win.bucket,
    });
  }
  return rows;
}

export interface MarginExceptionRow {
  client: string;
  clientId: string | null;
  sku: string;
  product: string;
  quantity: number;
  unitCost: number;
  customerPrice: number;
  marginPerUnit: number;
}

/** Synced M365 lines sold under cost (suggested customer price < our cost). */
export async function getMarginExceptions(): Promise<MarginExceptionRow[]> {
  const subs = await prisma.tdSynnexSubscription.findMany({
    include: { customer: { include: { client: true } } },
  });
  const rows: MarginExceptionRow[] = [];
  for (const s of subs) {
    if (s.unitCost == null || s.customerPrice == null) continue;
    const unitCost = Number(s.unitCost);
    const customerPrice = Number(s.customerPrice);
    if (customerPrice >= unitCost) continue; // only under-cost lines
    rows.push({
      client: s.customer.client?.name ?? s.customer.name,
      clientId: s.customer.clientId,
      sku: s.productSku ?? "—",
      product: s.productName ?? "—",
      quantity: s.quantity,
      unitCost: round2(unitCost),
      customerPrice: round2(customerPrice),
      marginPerUnit: round2(customerPrice - unitCost),
    });
  }
  return rows.sort((a, b) => a.marginPerUnit - b.marginPerUnit);
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
