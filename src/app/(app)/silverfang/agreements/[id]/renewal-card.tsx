"use client";

import { useActionState } from "react";
import { RefreshCw } from "lucide-react";
import { applyAgreementRenewalAction } from "../../agreement-actions";
import type { SfActionResult } from "../../actions";
import { formatCurrency } from "@/lib/utils";

/**
 * The auto-renew uplift, and what applying it would do.
 *
 * Renewals apply themselves once the term ends — the cron does it. This button is
 * for the two cases the schedule cannot cover: renewing early, and catching one up
 * after its dates were edited. Both run the same code as the sweep.
 *
 * Only the recurring fee moves — hourly rates are repriced on their own schedule.
 */
export function RenewalCard({
  agreementId,
  percent,
  renewsOn,
  newEndDate,
  termMonths,
  daysUntil,
  due,
  alreadyRenewed,
  changes,
  annualDelta,
  canManage,
}: {
  agreementId: string;
  percent: number;
  renewsOn: string | null;
  newEndDate: string | null;
  termMonths: number;
  daysUntil: number | null;
  due: boolean;
  alreadyRenewed: boolean;
  changes: { field: string; label: string; from: number; to: number }[];
  annualDelta: number | null;
  canManage: boolean;
}) {
  const [result, action, pending] = useActionState<SfActionResult | null, FormData>(
    applyAgreementRenewalAction,
    null,
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="font-medium">Auto-renews at +{percent}%</span>
        {renewsOn ? (
          <span className={due ? "text-warning" : "text-muted-foreground"}>
            {due
              ? `Term ended ${renewsOn} — renewing automatically`
              : `Renews ${renewsOn}${daysUntil != null ? ` (in ${daysUntil} day${daysUntil === 1 ? "" : "s"})` : ""}`}
          </span>
        ) : (
          <span className="text-muted-foreground">
            No end date, so there is no term to renew — set one to schedule the uplift.
          </span>
        )}
        <span className="text-xs text-muted-foreground">{termMonths}-month term</span>
        <span className="text-xs text-muted-foreground">
          Applies automatically at the end of the term
        </span>
        {alreadyRenewed && (
          <span className="text-xs text-success">Already renewed for this term</span>
        )}
      </div>

      {changes.length > 0 ? (
        <div>
          <p className="mb-1 text-xs text-muted-foreground">
            On renewal{newEndDate ? `, through ${newEndDate}` : ""} — the recurring fee only:
          </p>
          <ul className="divide-y rounded-md border text-sm">
            {changes.map((c) => (
              <li key={c.field} className="flex items-center gap-3 px-3 py-1.5">
                <span>{c.label}</span>
                <span className="ml-auto tabular-nums text-muted-foreground">
                  {formatCurrency(c.from)}
                </span>
                <span className="text-muted-foreground">→</span>
                <span className="tabular-nums font-medium">{formatCurrency(c.to)}</span>
              </li>
            ))}
          </ul>
          {annualDelta != null && annualDelta !== 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              Worth {formatCurrency(annualDelta)} a year in additional recurring revenue.
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {percent === 0
            ? "The increase is set to 0%, so renewing would only move the term."
            : "This agreement has no recurring fee, so renewing only moves the term. The uplift " +
              "applies to the recurring amount; hourly rates are not changed by a renewal."}
        </p>
      )}

      {canManage && renewsOn && !alreadyRenewed && (
        <form action={action}>
          <input type="hidden" name="id" value={agreementId} />
          <button
            type="submit"
            disabled={pending}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition disabled:opacity-60 ${
              due
                ? "bg-primary text-primary-foreground hover:opacity-90"
                : "border hover:bg-accent"
            }`}
          >
            <RefreshCw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
            {pending ? "Applying…" : `Apply renewal (+${percent}%)`}
          </button>
          <span className="ml-3 text-xs text-muted-foreground">
            {due
              ? "Due now — the scheduled sweep will apply this within 15 minutes. Use the button only to do it immediately."
              : "The term has not ended yet. It will renew on its own then; this applies the uplift early."}
          </span>
        </form>
      )}

      {result && (
        <p className={`text-sm ${result.ok ? "text-success" : "text-danger"}`}>{result.message}</p>
      )}
    </div>
  );
}
