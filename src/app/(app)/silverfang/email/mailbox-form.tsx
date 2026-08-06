"use client";

import { useActionState, useState } from "react";
import { Save } from "lucide-react";
import { saveMailboxAction, type SfActionResult } from "../actions";
import { PRIORITY_LABELS } from "@/lib/silverfang/constants";

const inputCls =
  "w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

export interface MailboxValues {
  id?: string;
  address: string;
  name: string;
  boardId: string;
  fallbackClientId: string;
  defaultPriority: string;
  provider: string;
  inbound: boolean;
  outbound: boolean;
  active: boolean;
  signature: string;
}

/**
 * Create/edit one support mailbox. `provider` is stateful because RESEND cannot
 * receive mail — the inbound control is disabled rather than silently ignored.
 */
export function MailboxForm({
  values,
  boards,
  clients,
  submitLabel,
}: {
  values: MailboxValues;
  boards: { id: string; name: string }[];
  clients: { id: string; name: string }[];
  submitLabel: string;
}) {
  const [result, action, pending] = useActionState<SfActionResult | null, FormData>(
    saveMailboxAction,
    null,
  );
  const [provider, setProvider] = useState(values.provider);
  const canReceive = provider === "GRAPH";

  return (
    <form action={action} className="space-y-4">
      {values.id && <input type="hidden" name="id" value={values.id} />}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          Mailbox address
          <input
            name="address"
            defaultValue={values.address}
            required
            placeholder="support@wolfstrata.com"
            className={`mt-1 ${inputCls}`}
          />
        </label>
        <label className="block text-sm font-medium">
          Display name
          <input
            name="name"
            defaultValue={values.name}
            placeholder="Wolfstrata Support"
            className={`mt-1 ${inputCls}`}
          />
        </label>
        <label className="block text-sm font-medium">
          Provider
          <select
            name="provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className={`mt-1 ${inputCls}`}
          >
            <option value="GRAPH">Microsoft 365 (Graph) — send and receive</option>
            <option value="RESEND">Resend — send only</option>
          </select>
          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            {canReceive
              ? "Needs Mail.Send and Mail.ReadWrite application permissions on the Entra app."
              : "Resend cannot read a mailbox, so inbound is unavailable on this provider."}
          </span>
        </label>
        <label className="block text-sm font-medium">
          New tickets land on
          <select name="boardId" defaultValue={values.boardId} className={`mt-1 ${inputCls}`}>
            <option value="">Default board</option>
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium">
          Default priority
          <select
            name="defaultPriority"
            defaultValue={values.defaultPriority}
            className={`mt-1 ${inputCls}`}
          >
            {Object.entries(PRIORITY_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium">
          Unrecognised senders
          <select
            name="fallbackClientId"
            defaultValue={values.fallbackClientId}
            className={`mt-1 ${inputCls}`}
          >
            <option value="">Refuse the message (reported, not filed)</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                File against {c.name}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            Used when the sender matches no contact and no client domain.
          </span>
        </label>
      </div>

      <label className="block text-sm font-medium">
        Signature
        <textarea
          name="signature"
          defaultValue={values.signature}
          rows={3}
          placeholder="Wolfstrata Support · 204-555-0100"
          className={`mt-1 ${inputCls}`}
        />
      </label>

      <div className="flex flex-wrap items-center gap-5">
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="inbound"
            defaultChecked={values.inbound && canReceive}
            disabled={!canReceive}
            className="h-4 w-4"
          />
          Receive mail
        </label>
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" name="outbound" defaultChecked={values.outbound} className="h-4 w-4" />
          Send mail
        </label>
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={values.active} className="h-4 w-4" />
          Active
        </label>
        {result && (
          <span className={`text-sm ${result.ok ? "text-success" : "text-danger"}`}>
            {result.message}
          </span>
        )}
        <button
          type="submit"
          disabled={pending}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          <Save className="h-4 w-4" />
          {pending ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
