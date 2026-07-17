import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { fiscalYearFor } from "@/lib/crm/constants";
import {
  computeCashFlowReport,
  type CashFlowInvoice,
  type CashFlowPayment,
  type CashFlowReport,
} from "@/lib/reports/dso";

export interface DateWindow {
  start?: Date | null;
  end?: Date | null;
}

export type RangeKey =
  | "fiscal"
  | "calendar"
  | "all"
  | "last-month"
  | "this-quarter"
  | "last-quarter"
  | "custom";

/**
 * Resolve a range key (+ optional custom from/to as YYYY-MM-DD) into a UTC
 * [start, end] window (end inclusive) plus a display label. Pure given `now`.
 */
export function resolveDateWindow(
  range: string,
  from: string | undefined,
  to: string | undefined,
  now: Date,
): { start: Date | null; end: Date | null; label: string } {
  const y = now.getUTCFullYear();
  const startOf = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 1));
  const endBefore = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 1) - 1);

  switch (range) {
    case "all":
      return { start: null, end: null, label: "All-time" };
    case "calendar":
      return { start: startOf(y, 0), end: endBefore(y + 1, 0), label: `Calendar ${y}` };
    case "last-month": {
      const m = now.getUTCMonth();
      const lmY = m === 0 ? y - 1 : y;
      const lmM = m === 0 ? 11 : m - 1;
      return {
        start: startOf(lmY, lmM),
        end: endBefore(lmY, lmM + 1),
        label: `${startOf(lmY, lmM).toISOString().slice(0, 7)} (last month)`,
      };
    }
    case "this-quarter": {
      const qsm = Math.floor(now.getUTCMonth() / 3) * 3;
      return {
        start: startOf(y, qsm),
        end: endBefore(y, qsm + 3),
        label: `Q${qsm / 3 + 1} ${y}`,
      };
    }
    case "last-quarter": {
      let sm = Math.floor(now.getUTCMonth() / 3) * 3 - 3;
      let sy = y;
      if (sm < 0) {
        sm += 12;
        sy -= 1;
      }
      return {
        start: startOf(sy, sm),
        end: endBefore(sy, sm + 3),
        label: `Q${sm / 3 + 1} ${sy}`,
      };
    }
    case "custom": {
      const start = from ? new Date(`${from}T00:00:00.000Z`) : null;
      const end = to ? new Date(`${to}T23:59:59.999Z`) : null;
      const startOk = start && !Number.isNaN(start.getTime());
      const endOk = end && !Number.isNaN(end.getTime());
      if (startOk || endOk) {
        return {
          start: startOk ? start : null,
          end: endOk ? end : null,
          label: `${startOk ? from : "…"} – ${endOk ? to : "…"}`,
        };
      }
      // Fall through to fiscal when custom is selected but no dates given.
      break;
    }
  }
  const fy = fiscalYearFor(now);
  return { start: fy.start, end: fy.end, label: `${fy.label} (fiscal year)` };
}

/**
 * Load synced QuickBooks invoices + received payments and compute the Cash-Flow /
 * DSO report. An optional date window filters invoices by invoice date (their
 * payment allocations are always included, so cohort DSO/days-late stays whole).
 * Returns null if the QBO invoice/payment tables aren't present yet (migration
 * not deployed) so the page can show a setup state instead of 500ing.
 */
export async function getCashFlowReport(
  window?: DateWindow,
): Promise<CashFlowReport | null> {
  try {
    const invoiceWhere: Prisma.QboInvoiceWhereInput = {};
    if (window?.start || window?.end) {
      invoiceWhere.txnDate = {
        ...(window.start ? { gte: window.start } : {}),
        ...(window.end ? { lte: window.end } : {}),
      };
    }
    const [invoices, payments] = await Promise.all([
      prisma.qboInvoice.findMany({
        where: invoiceWhere,
        select: {
          qboId: true,
          customerRef: true,
          customerName: true,
          txnDate: true,
          dueDate: true,
          totalAmount: true,
        },
      }),
      prisma.qboPayment.findMany({ select: { txnDate: true, lines: true } }),
    ]);

    const inv: CashFlowInvoice[] = invoices.map((i) => ({
      qboId: i.qboId,
      customerId: i.customerRef ?? i.customerName ?? i.qboId,
      customerName: i.customerName ?? i.customerRef ?? "Unknown",
      txnDate: i.txnDate,
      dueDate: i.dueDate ?? null,
      total: Number(i.totalAmount),
    }));

    const pay: CashFlowPayment[] = payments.map((p) => {
      const raw = Array.isArray(p.lines) ? (p.lines as unknown[]) : [];
      const lines = raw
        .map((l) => {
          const o = (l ?? {}) as { invoiceId?: unknown; amount?: unknown };
          return { invoiceId: String(o.invoiceId ?? ""), amount: Number(o.amount ?? 0) };
        })
        .filter((l) => l.invoiceId);
      return { txnDate: p.txnDate, lines };
    });

    return computeCashFlowReport(inv, pay);
  } catch {
    // Tables not present yet (migration pending) — treat as "not set up".
    return null;
  }
}
