"use client";

import { useActionState } from "react";
import { cn } from "@/lib/utils";
import {
  sendTestDigestAction,
  captureCostBaselineAction,
  type TestDigestResult,
  type SnapshotResult,
} from "./actions";

export function SendDigestForm() {
  const [state, action, pending] = useActionState<TestDigestResult | null, FormData>(
    sendTestDigestAction,
    null,
  );
  const [snapState, snapAction, snapPending] = useActionState<SnapshotResult | null, FormData>(
    captureCostBaselineAction,
    null,
  );

  return (
    <div className="max-w-2xl space-y-4">
      <form action={snapAction} className="rounded-lg border bg-card p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold">Capture cost baseline now</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Snapshots current M365 costs and seeds a last-month baseline so
              cost-change highlighting is active immediately. It flags nothing until a
              cost actually changes from today&apos;s values (no false positives), and
              can&apos;t recover changes from before today. Safe to run once.
            </p>
          </div>
          <button
            type="submit"
            disabled={snapPending}
            className="shrink-0 rounded-md border px-4 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-60"
          >
            {snapPending ? "Capturing…" : "Capture baseline"}
          </button>
        </div>
        {snapState && (
          <div className={cn("mt-4 rounded-md px-3 py-2 text-sm", snapState.ok ? "bg-success/10 text-success" : "bg-danger/10 text-danger")}>
            {snapState.message}
          </div>
        )}
      </form>

      <form action={action} className="rounded-lg border bg-card p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold">Send the alert digest now</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Runs the same digest the cron sends every Monday — renewals due in
              90/60/30 days plus cost changes vs. last month — and emails it via
              Resend right now. Use this to confirm delivery.
            </p>
          </div>
          <button
            type="submit"
            disabled={pending}
            className="shrink-0 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
          >
            {pending ? "Sending…" : "Send test digest"}
          </button>
        </div>

        {state && (
          <div
            className={cn(
              "mt-4 rounded-md px-3 py-2 text-sm",
              state.ok ? "bg-success/10 text-success" : "bg-danger/10 text-danger",
            )}
          >
            {state.message}
          </div>
        )}
      </form>

      <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
        <p className="mb-2 font-medium text-foreground">How alerts work</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>The cron sends this digest automatically every <strong>Monday</strong>.</li>
          <li>It only emails when there is something to report.</li>
          <li>
            Renewal alerts work now; <strong>cost-change</strong> alerts appear once the
            cost-snapshot table exists (after the P3005 baseline) and there is a prior
            month to compare against.
          </li>
          <li>
            Sender/recipients come from <code>ALERT_EMAIL_FROM</code> /{" "}
            <code>ALERT_EMAIL_TO</code> (default <code>wolf365@wolfstrata.com</code>); the
            sender domain must be verified in Resend.
          </li>
        </ul>
      </div>
    </div>
  );
}
