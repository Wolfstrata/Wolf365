"use client";

import { useActionState, useState } from "react";
import { Stethoscope } from "lucide-react";
import { diagnoseMailAction, type SfActionResult } from "../actions";

/**
 * Mail self-diagnostic. Reports which app registration the Graph token actually
 * belongs to and which application roles it carries, then tests reading and
 * sending separately — an app-only 403 looks identical whether the access policy
 * excludes the mailbox, the wrong app is in use, or the permission was consented
 * as Delegated, and these three checks tell those apart.
 */
export function DiagnoseMail() {
  const [result, action, pending] = useActionState<SfActionResult | null, FormData>(
    diagnoseMailAction,
    null,
  );
  const [sendTo, setSendTo] = useState("");

  return (
    <div className="rounded-md border p-4">
      <h2 className="inline-flex items-center gap-2 text-sm font-semibold">
        <Stethoscope className="h-4 w-4" /> Diagnose mail access
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Checks the Graph token itself — which app and tenant issued it, and which application
        roles it carries — then reads the mailbox and, optionally, sends one test message. Use
        this when a poll or send fails with a 403: the three results together identify whether
        it is the app registration, the consent type, or the Exchange access policy.
      </p>

      <form action={action} className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-xs font-medium">
          Send a test message to (optional)
          <input
            name="sendTo"
            value={sendTo}
            onChange={(e) => setSendTo(e.target.value)}
            placeholder="you@wolfstrata.com"
            className="mt-1 block w-64 rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border px-3 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-60"
        >
          {pending ? "Checking…" : "Run diagnostic"}
        </button>
        <span className="text-xs text-muted-foreground">
          A test message goes to the address you type, not to any client — it bypasses no gate
          because no client is involved.
        </span>
      </form>

      {result && (
        <pre
          className={`mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-md border p-3 text-xs ${
            result.ok ? "border-success/40 bg-success/5" : "border-danger/40 bg-danger/5"
          }`}
        >
          {result.message}
        </pre>
      )}
    </div>
  );
}
