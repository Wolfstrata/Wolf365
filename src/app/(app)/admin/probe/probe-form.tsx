"use client";

import { useActionState } from "react";
import { cn } from "@/lib/utils";
import { runProbeAction, type ProbeResult } from "./actions";

const SUGGESTIONS = [
  "/api/v1/cloud/customers",
  "/api/v1/customers",
  "/api/v1/accounts/{accountId}/customers",
  "/api/v1/resellers/{accountId}/customers",
  "/api/v1/customers?pageNo=1&pageSize=10",
];

export function ProbeForm() {
  const [state, action, pending] = useActionState<ProbeResult | null, FormData>(
    runProbeAction,
    null,
  );

  return (
    <div className="space-y-4">
      <form action={action} className="space-y-4 rounded-lg border bg-card p-6">
        <div>
          <label className="mb-1 block text-sm font-medium">Connector</label>
          <select
            name="type"
            defaultValue="TD_SYNNEX_STELLR"
            className="w-full max-w-xs rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="TD_SYNNEX_STELLR">TD SYNNEX StreamOne Stellr</option>
            <option value="QUICKBOOKS_ONLINE">QuickBooks Online</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">
            Path (appended to the connector&apos;s base URL)
          </label>
          <input
            name="path"
            placeholder="/api/v1/cloud/customers"
            className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Uses the saved credentials for the active environment. <code>{"{accountId}"}</code>{" "}
            is substituted for TD SYNNEX. Try: {SUGGESTIONS.join("  ·  ")}
          </p>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Probing…" : "Run probe"}
        </button>
      </form>

      {state && (
        <div className="space-y-2 rounded-lg border bg-card p-6">
          <p
            className={cn(
              "text-sm font-medium",
              state.ok ? "text-success" : "text-danger",
            )}
          >
            {state.message}
          </p>
          {state.url && (
            <p className="break-all font-mono text-xs text-muted-foreground">
              {state.url}
            </p>
          )}
          {state.preview && (
            <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-3 text-xs">
              {state.preview}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
