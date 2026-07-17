import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  computeCashFlowReport,
  type CashFlowInvoice,
  type CashFlowPayment,
  type CashFlowReport,
} from "@/lib/reports/dso";
import { isExcludedBill } from "@/lib/reports/bill-filter";
import type { DateWindow } from "@/lib/reports/cash-flow";

/**
 * Suppliers & Expenses / DPO report — the AP mirror of the Cash-Flow / DSO
 * report. Built from synced QuickBooks vendor bills + bill payments, it measures
 * how long we take to PAY suppliers and expenses (days payable outstanding).
 *
 * Payroll, taxes, loans, credit cards and credit lines are excluded
 * (`isExcludedBill`) — only supplier bills and ordinary expenses count.
 *
 * The math is identical to the AR side, so bills are mapped onto
 * `CashFlowInvoice` (vendor → "customer") and bill payments onto
 * `CashFlowPayment` (billId → invoiceId) and fed through `computeCashFlowReport`.
 * There, "invoice→cash" days become "bill→payment" days (DPO) and "days late vs
 * terms" become "days past the bill due date we paid".
 *
 * Returns null if the QboBill/QboBillPayment tables aren't present yet (migration
 * not deployed) so the page can show a setup state instead of 500ing.
 */
export async function getSuppliersReport(
  window?: DateWindow,
  limit = 10,
): Promise<CashFlowReport | null> {
  try {
    const billWhere: Prisma.QboBillWhereInput = {};
    if (window?.start || window?.end) {
      billWhere.txnDate = {
        ...(window.start ? { gte: window.start } : {}),
        ...(window.end ? { lte: window.end } : {}),
      };
    }
    const [bills, billPayments] = await Promise.all([
      prisma.qboBill.findMany({
        where: billWhere,
        select: {
          qboId: true,
          vendorRef: true,
          vendorName: true,
          category: true,
          memo: true,
          txnDate: true,
          dueDate: true,
          totalAmount: true,
        },
      }),
      prisma.qboBillPayment.findMany({ select: { txnDate: true, lines: true } }),
    ]);

    // Exclude payroll/tax/loan/credit bills; keep the set of kept bill ids so
    // excluded bills' payment allocations don't leak into the math either.
    const kept = bills.filter(
      (b) => !isExcludedBill(b.vendorName, b.category, b.memo),
    );
    const keptIds = new Set(kept.map((b) => b.qboId));

    const inv: CashFlowInvoice[] = kept.map((b) => ({
      qboId: b.qboId,
      customerId: b.vendorRef ?? b.vendorName ?? b.qboId,
      customerName: b.vendorName ?? b.vendorRef ?? "Unknown supplier",
      txnDate: b.txnDate,
      dueDate: b.dueDate ?? null,
      total: Number(b.totalAmount),
    }));

    const pay: CashFlowPayment[] = billPayments.map((p) => {
      const raw = Array.isArray(p.lines) ? (p.lines as unknown[]) : [];
      const lines = raw
        .map((l) => {
          const o = (l ?? {}) as { billId?: unknown; amount?: unknown };
          return { invoiceId: String(o.billId ?? ""), amount: Number(o.amount ?? 0) };
        })
        .filter((l) => l.invoiceId && keptIds.has(l.invoiceId));
      return { txnDate: p.txnDate, lines };
    });

    return computeCashFlowReport(inv, pay, limit);
  } catch {
    // Tables not present yet (migration pending) — treat as "not set up".
    return null;
  }
}
