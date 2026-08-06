"use client";

import { useActionState } from "react";
import { Check } from "lucide-react";
import { markDepositInvoicedAction } from "../../project-actions";
import type { SfActionResult } from "../../actions";
import { formatCurrency } from "@/lib/utils";

/**
 * The up-front deposit. Marking it invoiced is a human action that only records
 * what happened — nothing here pushes an invoice, in keeping with the rule that
 * invoices are never sent automatically.
 */
export function DepositCard({
  projectId,
  percent,
  expected,
  invoiced,
  invoicedAt,
  drifted,
  remainder,
  canManage,
}: {
  projectId: string;
  percent: number;
  expected: number | null;
  invoiced: number | null;
  invoicedAt: string | null;
  drifted: boolean;
  remainder: number | null;
  canManage: boolean;
}) {
  const [result, action, pending] = useActionState<SfActionResult | null, FormData>(
    markDepositInvoicedAction,
    null,
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="font-medium">{percent}% deposit</span>
        <span className="tabular-nums">
          {expected != null ? formatCurrency(expected) : "no total to take it from yet"}
        </span>
        {invoicedAt ? (
          <span className="text-success">Invoiced {invoicedAt}</span>
        ) : (
          <span className="text-warning">Not invoiced</span>
        )}
        {remainder != null && (
          <span className="text-muted-foreground">
            {formatCurrency(remainder)} to bill after the deposit
          </span>
        )}
        {canManage && !invoicedAt && expected != null && (
          <form action={action} className="ml-auto">
            <input type="hidden" name="projectId" value={projectId} />
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition hover:bg-accent disabled:opacity-60"
            >
              <Check className="h-3.5 w-3.5" />
              {pending ? "Recording…" : "Mark deposit invoiced"}
            </button>
          </form>
        )}
      </div>

      {drifted && invoiced != null && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
          The deposit was invoiced at {formatCurrency(invoiced)}, which no longer matches{" "}
          {percent}% of the project&rsquo;s current total. The invoiced figure is kept as-is —
          raise an adjustment if the difference should be billed.
        </p>
      )}

      {result && (
        <p className={`text-sm ${result.ok ? "text-success" : "text-danger"}`}>{result.message}</p>
      )}
    </div>
  );
}
