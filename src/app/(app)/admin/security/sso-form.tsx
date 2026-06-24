"use client";

import { useActionState } from "react";
import { cn } from "@/lib/utils";
import {
  saveSsoSettingsAction,
  type SsoActionResult,
} from "./actions";

interface Props {
  initial: {
    tenantId: string;
    clientId: string;
    allowedDomains: string;
    groupMappings: string;
    secretSet: boolean;
  } | null;
}

export function SsoForm({ initial }: Props) {
  const [state, action, pending] = useActionState<
    SsoActionResult | null,
    FormData
  >(saveSsoSettingsAction, null);

  return (
    <form action={action} className="space-y-5 rounded-lg border bg-card p-6">
      <Field label="Directory (Tenant) ID" required>
        <input
          name="tenantId"
          defaultValue={initial?.tenantId ?? ""}
          required
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        />
      </Field>
      <Field label="Application (Client) ID" required>
        <input
          name="clientId"
          defaultValue={initial?.clientId ?? ""}
          required
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        />
      </Field>
      <Field
        label="Client Secret"
        required={!initial?.secretSet}
        help="Stored encrypted. Leave blank to keep the existing secret."
      >
        <input
          name="clientSecret"
          type="password"
          autoComplete="new-password"
          placeholder={initial?.secretSet ? "•••••••• (stored)" : "Not set"}
          className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
        />
      </Field>
      <Field
        label="Allowed domains"
        help="Comma or newline separated, e.g. wolfstrata.com. Leave empty to allow any verified domain."
      >
        <textarea
          name="allowedDomains"
          defaultValue={initial?.allowedDomains ?? ""}
          rows={2}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        />
      </Field>
      <Field
        label="Group → role mappings"
        help="One per line as groupObjectId:ROLE (ADMINISTRATOR, POWER_USER, REVIEWER)."
      >
        <textarea
          name="groupMappings"
          defaultValue={initial?.groupMappings ?? ""}
          rows={4}
          placeholder="00000000-0000-0000-0000-000000000000:ADMINISTRATOR"
          className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
        />
      </Field>

      {state && (
        <p
          className={cn(
            "rounded-md px-3 py-2 text-sm",
            state.ok ? "bg-success/10 text-success" : "bg-danger/10 text-danger",
          )}
        >
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save SSO settings"}
      </button>
    </form>
  );
}

function Field({
  label,
  required,
  help,
  children,
}: {
  label: string;
  required?: boolean;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium">
        {label}
        {required && <span className="ml-1 text-danger">*</span>}
      </label>
      {children}
      {help && <p className="mt-1 text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}
