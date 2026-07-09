"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  createBillingRunAction,
  createBulkBillingRunsAction,
  type BillingActionResult,
  type BulkRunResult,
} from "../actions";

interface Client {
  id: string;
  name: string;
  /** Count of linked TD SYNNEX subscriptions (0 = nothing to bill). */
  subs: number;
}

interface Props {
  clients: Client[];
  defaultClientId?: string;
}

type Scope = "single" | "multiple";

export function NewRunForm({ clients, defaultClientId }: Props) {
  const [scope, setScope] = useState<Scope>("single");

  return (
    <div className="max-w-2xl space-y-5">
      <div className="flex gap-2">
        {(
          [
            ["single", "Single client"],
            ["multiple", "Multiple clients"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setScope(value)}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm transition",
              scope === value ? "border-primary bg-accent" : "hover:bg-accent/60",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {scope === "single" ? (
        <SingleForm clients={clients} defaultClientId={defaultClientId} />
      ) : (
        <MultipleForm clients={clients} />
      )}
    </div>
  );
}

/** Period picker shared by both forms; self-contained (owns its mode state). */
function PeriodFields() {
  const [mode, setMode] = useState<"monthly" | "custom">("monthly");
  return (
    <>
      <div>
        <label className="mb-1 block text-sm font-medium">Billing period</label>
        <div className="mb-3 flex gap-2">
          {(["monthly", "custom"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                "rounded-md border px-3 py-1.5 text-sm capitalize transition",
                mode === m ? "border-primary bg-accent" : "hover:bg-accent/60",
              )}
            >
              {m}
            </button>
          ))}
        </div>
        <input type="hidden" name="mode" value={mode} />

        {mode === "monthly" ? (
          <input
            type="month"
            name="month"
            required
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Start</label>
              <input type="date" name="start" required className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">End (exclusive)</label>
              <input type="date" name="end" required className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
            </div>
          </div>
        )}
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">Invoice date (optional)</label>
        <input type="date" name="invoiceDate" className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
        <p className="mt-1 text-xs text-muted-foreground">Defaults to the period start date.</p>
      </div>
    </>
  );
}

function SingleForm({ clients, defaultClientId }: Props) {
  const [state, action, pending] = useActionState<BillingActionResult | null, FormData>(
    createBillingRunAction,
    null,
  );

  return (
    <form action={action} className="space-y-5 rounded-lg border bg-card p-6">
      <div>
        <label className="mb-1 block text-sm font-medium">Client</label>
        <select
          name="clientId"
          defaultValue={defaultClientId ?? ""}
          required
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="">Select a client…</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.subs === 0 ? " — no M365 subscriptions" : ""}
            </option>
          ))}
        </select>
      </div>

      <PeriodFields />

      {state && !state.ok && (
        <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{state.message}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Generating…" : "Generate draft billing run"}
      </button>
    </form>
  );
}

function MultipleForm({ clients }: { clients: Client[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [state, action, pending] = useActionState<BulkRunResult | null, FormData>(
    createBulkBillingRunsAction,
    null,
  );

  const withSubs = useMemo(() => clients.filter((c) => c.subs > 0), [clients]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <form action={action} className="space-y-5 rounded-lg border bg-card p-6">
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <label className="block text-sm font-medium">
            Clients{" "}
            <span className="text-muted-foreground">({selected.size} selected)</span>
          </label>
          <div className="flex gap-2 text-xs">
            <button
              type="button"
              onClick={() => setSelected(new Set(withSubs.map((c) => c.id)))}
              className="rounded-md border px-2.5 py-1 font-medium transition hover:bg-accent"
            >
              Select all with subscriptions
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set(clients.map((c) => c.id)))}
              className="rounded-md border px-2.5 py-1 font-medium transition hover:bg-accent"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="rounded-md border px-2.5 py-1 font-medium transition hover:bg-accent"
            >
              Clear
            </button>
          </div>
        </div>
        <div className="max-h-72 overflow-y-auto rounded-md border">
          {clients.map((c) => (
            <label
              key={c.id}
              className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm last:border-b-0 hover:bg-accent/40"
            >
              <input
                type="checkbox"
                name="clientIds"
                value={c.id}
                checked={selected.has(c.id)}
                onChange={() => toggle(c.id)}
                className="h-4 w-4"
              />
              <span className="flex-1">{c.name}</span>
              <span
                className={cn(
                  "text-xs",
                  c.subs > 0 ? "text-muted-foreground" : "text-warning",
                )}
              >
                {c.subs > 0
                  ? `${c.subs} subscription${c.subs === 1 ? "" : "s"}`
                  : "no M365"}
              </span>
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          A separate draft run is generated for each selected client. Clients with no
          subscriptions produce an empty run you can cancel.
        </p>
      </div>

      <PeriodFields />

      {state && (
        <div
          className={cn(
            "rounded-md px-3 py-2 text-sm",
            state.ok ? "bg-success/10 text-success" : "bg-danger/10 text-danger",
          )}
        >
          {state.message}
        </div>
      )}

      {state?.results && state.results.length > 0 && (
        <ul className="divide-y rounded-md border text-sm">
          {state.results.map((r, i) => (
            <li key={i} className="flex items-center justify-between px-3 py-2">
              <span className="flex-1">{r.clientName}</span>
              {r.ok ? (
                <span className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    {r.lines} line{r.lines === 1 ? "" : "s"}
                  </span>
                  {r.runId && (
                    <Link
                      href={`/billing/${r.runId}`}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      Open run →
                    </Link>
                  )}
                </span>
              ) : (
                <span className="text-xs text-danger">{r.error}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <button
        type="submit"
        disabled={pending || selected.size === 0}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
      >
        {pending
          ? "Generating…"
          : `Generate ${selected.size || ""} draft run${selected.size === 1 ? "" : "s"}`.trim()}
      </button>
    </form>
  );
}
