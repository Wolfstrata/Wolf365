import "server-only";
import { prisma } from "@/lib/db";
import {
  computeCashFlowReport,
  type CashFlowInvoice,
  type CashFlowPayment,
  type CashFlowReport,
} from "@/lib/reports/dso";

/**
 * Load synced QuickBooks invoices + received payments and compute the Cash-Flow /
 * DSO report. Returns null if the QBO invoice/payment tables aren't present yet
 * (migration not deployed) so the page can show a setup state instead of 500ing.
 */
export async function getCashFlowReport(): Promise<CashFlowReport | null> {
  try {
    const [invoices, payments] = await Promise.all([
      prisma.qboInvoice.findMany({
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
