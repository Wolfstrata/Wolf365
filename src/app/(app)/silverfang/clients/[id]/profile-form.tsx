"use client";

import { useActionState } from "react";
import { saveClientProfileAction, type SfActionResult } from "../../actions";

const inputCls =
  "w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

/** Editable SilverFang profile for one client (account manager, defaults, VIP). */
export function ClientProfileForm({
  clientId,
  values,
  boards,
  agreements,
}: {
  clientId: string;
  values: {
    accountManager: string;
    defaultBoardId: string;
    defaultAgreementId: string;
    allowClientEmail: boolean;
    vip: boolean;
    notes: string;
  };
  boards: { id: string; name: string }[];
  agreements: { id: string; name: string }[];
}) {
  const [result, action, pending] = useActionState<SfActionResult | null, FormData>(
    saveClientProfileAction,
    null,
  );

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="clientId" value={clientId} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <label className="block text-sm font-medium">
          Account manager
          <input
            name="accountManager"
            defaultValue={values.accountManager}
            className={`mt-1 ${inputCls}`}
            placeholder="Who owns this account"
          />
        </label>
        <label className="block text-sm font-medium">
          Default board
          <select
            name="defaultBoardId"
            defaultValue={values.defaultBoardId}
            className={`mt-1 ${inputCls}`}
          >
            <option value="">No default</option>
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium">
          Default agreement
          <select
            name="defaultAgreementId"
            defaultValue={values.defaultAgreementId}
            className={`mt-1 ${inputCls}`}
          >
            <option value="">No default</option>
            {agreements.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block text-sm font-medium">
        Notes
        <textarea name="notes" defaultValue={values.notes} rows={3} className={`mt-1 ${inputCls}`} />
      </label>
      <div
        className={`rounded-md border p-3 ${
          values.allowClientEmail
            ? "border-success/40 bg-success/5"
            : "border-warning/40 bg-warning/5"
        }`}
      >
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            name="allowClientEmail"
            defaultChecked={values.allowClientEmail}
            className="h-4 w-4"
          />
          Allow email to client
        </label>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {values.allowClientEmail ? (
            <>
              <span className="font-medium text-success">On.</span> SilverFang may email this
              client&rsquo;s contacts — ticket replies and any active auto-responses.
            </>
          ) : (
            <>
              <span className="font-medium text-warning">Off.</span> No email will reach this
              client&rsquo;s contacts. Replies and auto-responses are refused and say so;
              nothing is queued or sent later.
            </>
          )}{" "}
          Off is the default for every client, always. Inbound email still works either way —
          tickets are created from client mail regardless.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" name="vip" defaultChecked={values.vip} className="h-4 w-4" />
          VIP client
        </label>
        {result && (
          <span className={`text-sm ${result.ok ? "text-success" : "text-danger"}`}>
            {result.message}
          </span>
        )}
        <button
          type="submit"
          disabled={pending}
          className="ml-auto rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save profile"}
        </button>
      </div>
    </form>
  );
}
