"use client";

import { useActionState } from "react";
import { cn } from "@/lib/utils";
import {
  runProbeAction,
  showEgressIpAction,
  type ProbeResult,
  type EgressIpResult,
} from "./actions";

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
  const [egress, egressAction, egressPending] = useActionState<
    EgressIpResult | null,
    FormData
  >(async () => showEgressIpAction(), null);

  return (
    <div className="space-y-4">
      {/* Egress IP — what to put in a vendor IP allowlist (e.g. QBO production) */}
      <form action={egressAction} className="rounded-lg border bg-card p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold">Outbound (egress) IP</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              The IP connector API calls originate from. Use this for vendor IP
              allowlists (e.g. QuickBooks production).
            </p>
          </div>
          <button
            type="submit"
            disabled={egressPending}
            className="shrink-0 rounded-md border px-4 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-60"
          >
            {egressPending ? "Checking…" : "Show egress IP"}
          </button>
        </div>
        {egress && (
          <div className="mt-3">
            {egress.ok ? (
              <p className="font-mono text-lg">
                {egress.ip}{" "}
                <span
                  className={cn(
                    "ml-2 align-middle text-xs",
                    egress.proxied ? "text-success" : "text-warning",
                  )}
                >
                  {egress.proxied ? "via static proxy" : "no proxy — rotating IP"}
                </span>
              </p>
            ) : (
              <p className="text-sm text-danger">{egress.message}</p>
            )}
            {egress.ok && !egress.proxied && (
              <p className="mt-1 text-xs text-warning">
                Set QUOTAGUARDSTATIC_URL (or OUTBOUND_PROXY_URL) in Vercel and
                redeploy — this rotating IP is not safe to allowlist.
              </p>
            )}
          </div>
        )}
      </form>
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
