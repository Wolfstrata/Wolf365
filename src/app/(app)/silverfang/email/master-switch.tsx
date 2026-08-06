"use client";

import { useActionState, useState } from "react";
import { MailX, Power, ShieldAlert } from "lucide-react";
import { setEmailMasterSwitchAction, type SfActionResult } from "../actions";
import { ENABLE_CONFIRMATION } from "@/lib/silverfang/email-policy";

/**
 * The master kill switch. Off is the default and the safe state, so turning it
 * ON is the only path with friction: you have to type the confirmation word.
 * Turning it off is always one click.
 */
export function EmailMasterSwitch({
  enabled,
  updatedByEmail,
  emailableClients,
}: {
  enabled: boolean;
  updatedByEmail: string | null;
  emailableClients: number;
}) {
  const [result, action, pending] = useActionState<SfActionResult | null, FormData>(
    setEmailMasterSwitchAction,
    null,
  );
  const [confirm, setConfirm] = useState("");

  return (
    <div
      className={`rounded-md border p-4 ${
        enabled ? "border-success/50 bg-success/5" : "border-danger/50 bg-danger/5"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="inline-flex items-center gap-2 text-sm font-semibold">
            {enabled ? (
              <>
                <Power className="h-4 w-4 text-success" /> Outbound email is ON
              </>
            ) : (
              <>
                <MailX className="h-4 w-4 text-danger" /> Outbound email is OFF
              </>
            )}
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            {enabled ? (
              <>
                SilverFang can send email. Clients are still individually gated —{" "}
                <span className="font-medium text-foreground">
                  {emailableClients} client{emailableClients === 1 ? "" : "s"}
                </span>{" "}
                currently have &ldquo;Allow email to client&rdquo; on, and only those can
                receive anything.
              </>
            ) : (
              <>
                Nothing is sent to anyone — not clients, not technicians, not
                auto-responses. Sends are refused outright and say why; nothing is queued to
                go out later. Inbound email is unaffected and still opens tickets.
              </>
            )}
          </p>
          {updatedByEmail && (
            <p className="mt-1 text-xs text-muted-foreground">Last changed by {updatedByEmail}.</p>
          )}
        </div>

        {enabled ? (
          <form action={action} className="shrink-0">
            <input type="hidden" name="enable" value="false" />
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-md bg-danger px-3 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
            >
              <MailX className="h-4 w-4" />
              {pending ? "Turning off…" : "Turn all email OFF"}
            </button>
          </form>
        ) : (
          <form action={action} className="flex shrink-0 flex-wrap items-center gap-2">
            <input type="hidden" name="enable" value="true" />
            <input
              name="confirm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={`Type ${ENABLE_CONFIRMATION}`}
              className="w-36 rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="submit"
              disabled={pending || confirm.trim() !== ENABLE_CONFIRMATION}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-50"
            >
              <ShieldAlert className="h-4 w-4" />
              {pending ? "Turning on…" : "Turn email on"}
            </button>
          </form>
        )}
      </div>

      {result && (
        <p className={`mt-3 text-sm ${result.ok ? "text-success" : "text-danger"}`}>
          {result.message}
        </p>
      )}
    </div>
  );
}
