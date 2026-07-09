import "server-only";
import { prisma } from "@/lib/db";
import type { CostFigures } from "@/lib/licensing/cost-change";

/**
 * Server-only access to the monthly M365 cost snapshots.
 *
 * The snapshot table may not exist yet in an environment whose Prisma migrations
 * haven't been applied (see the P3005 baseline note in DEPLOYMENT.md). Every read
 * and write therefore degrades gracefully: a missing-table error (Prisma P2021)
 * is treated as "feature not available yet", never a crash.
 */

/** First day of the month (UTC) for a date. */
export function monthStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function isMissingTable(err: unknown): boolean {
  return (err as { code?: string })?.code === "P2021";
}

/**
 * Write/refresh the current month's snapshot for every synced subscription.
 * Returns the number written, or null when the snapshot table isn't there yet.
 */
export async function snapshotCurrentMonth(now: Date): Promise<number | null> {
  const periodMonth = monthStart(now);
  try {
    const subs = await prisma.tdSynnexSubscription.findMany({
      select: {
        stellrSubscriptionId: true,
        customerId: true,
        productSku: true,
        productName: true,
        quantity: true,
        unitCost: true,
        customerPrice: true,
        currency: true,
      },
    });
    let written = 0;
    for (const s of subs) {
      await prisma.m365CostSnapshot.upsert({
        where: {
          periodMonth_stellrSubscriptionId: {
            periodMonth,
            stellrSubscriptionId: s.stellrSubscriptionId,
          },
        },
        create: { periodMonth, ...s },
        update: {
          customerId: s.customerId,
          productSku: s.productSku,
          productName: s.productName,
          quantity: s.quantity,
          unitCost: s.unitCost,
          customerPrice: s.customerPrice,
          currency: s.currency,
        },
      });
      written += 1;
    }
    return written;
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

/**
 * Most-recent prior-month cost figures for the given subscriptions, keyed by
 * `stellrSubscriptionId`. Empty when the table is absent or has no prior data.
 */
export async function previousMonthCosts(
  stellrSubscriptionIds: string[],
  now: Date,
): Promise<Map<string, CostFigures>> {
  const out = new Map<string, CostFigures>();
  if (stellrSubscriptionIds.length === 0) return out;
  const periodMonth = monthStart(now);
  try {
    const rows = await prisma.m365CostSnapshot.findMany({
      where: {
        stellrSubscriptionId: { in: stellrSubscriptionIds },
        periodMonth: { lt: periodMonth },
      },
      orderBy: { periodMonth: "desc" },
      select: { stellrSubscriptionId: true, unitCost: true, customerPrice: true },
    });
    for (const r of rows) {
      // rows are newest-first, so the first seen per subscription is the most
      // recent prior month.
      if (out.has(r.stellrSubscriptionId)) continue;
      out.set(r.stellrSubscriptionId, {
        unitCost: r.unitCost != null ? Number(r.unitCost) : null,
        customerPrice: r.customerPrice != null ? Number(r.customerPrice) : null,
      });
    }
    return out;
  } catch (err) {
    if (isMissingTable(err)) return out;
    throw err;
  }
}
