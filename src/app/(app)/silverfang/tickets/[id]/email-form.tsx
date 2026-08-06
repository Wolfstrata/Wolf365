"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Mail, MailX } from "lucide-react";
import { sendTicketEmailAction, type SfActionResult } from "../../actions";

const inputCls =
  "w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

/**
 * Email a reply to the client from the ticket. Collapsed by default so the
 * primary action on a ticket stays "add a note" — sending mail is deliberate.
 */
export function EmailForm({
  ticketId,
  defaultTo,
  defaultSubject,
  mailbox,
  firstResponsePending,
  clientName,
  clientEmailAllowed,
  clientHref,
  masterEnabled,
}: {
  ticketId: string;
  defaultTo: string;
  defaultSubject: string;
  /** The address the reply will come from, or null when none is configured. */
  mailbox: string | null;
  firstResponsePending: boolean;
  clientName: string;
  /** The per-client gate. False means no composer at all. */
  clientEmailAllowed: boolean;
  clientHref: string;
  /** The SilverFang-wide master switch. */
  masterEnabled: boolean;
}) {
  const [result, action, pending] = useActionState<SfActionResult | null, FormData>(
    sendTicketEmailAction,
    null,
  );
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (result?.ok) formRef.current?.reset();
  }, [result]);

  // The gates come first, master switch before the per-client one, so a disabled
  // system doesn't look like a client misconfiguration. No composer is offered at
  // all in either case — the server refuses regardless; this is so nobody writes
  // a reply that was never going to be sent.
  if (!masterEnabled) {
    return (
      <div className="rounded-md border border-danger/40 bg-danger/5 p-3">
        <p className="inline-flex items-center gap-1.5 text-sm font-medium text-danger">
          <MailX className="h-4 w-4" /> Outbound email is off for all of SilverFang
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Nothing can be emailed to anyone while the master switch is off. A SilverFang
          administrator can turn it on under SilverFang → Email. Internal notes still work, and
          inbound email still opens and updates tickets.
        </p>
      </div>
    );
  }

  if (!clientEmailAllowed) {
    return (
      <div className="rounded-md border border-warning/40 bg-warning/5 p-3">
        <p className="inline-flex items-center gap-1.5 text-sm font-medium text-warning">
          <MailX className="h-4 w-4" /> Email to {clientName} is off
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Nothing can be emailed to this client. Every client starts this way, on purpose. Turn
          on{" "}
          <Link href={clientHref} className="text-primary hover:underline">
            Allow email to client
          </Link>{" "}
          on their SilverFang profile to enable replies. Internal notes and inbound email are
          unaffected.
        </p>
      </div>
    );
  }

  if (!mailbox) {
    return (
      <p className="text-xs text-muted-foreground">
        No outbound mailbox is configured, so this ticket cannot be emailed yet. A SilverFang
        administrator can add one under SilverFang → Email.
      </p>
    );
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition hover:bg-accent"
        >
          <Mail className="h-4 w-4" /> Email the client
        </button>
        <span className="text-xs text-muted-foreground">Sends from {mailbox}.</span>
        {result && (
          <span className={`text-sm ${result.ok ? "text-success" : "text-danger"}`}>
            {result.message}
          </span>
        )}
      </div>
    );
  }

  return (
    <form ref={formRef} action={action} className="space-y-3">
      <input type="hidden" name="ticketId" value={ticketId} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          To
          <input
            name="to"
            defaultValue={defaultTo}
            required
            placeholder="name@client.com, another@client.com"
            className={`mt-1 ${inputCls}`}
          />
        </label>
        <label className="block text-sm font-medium">
          Cc
          <input name="cc" placeholder="Optional" className={`mt-1 ${inputCls}`} />
        </label>
      </div>
      <label className="block text-sm font-medium">
        Subject
        <input name="subject" defaultValue={defaultSubject} className={`mt-1 ${inputCls}`} />
        <span className="mt-1 block text-xs font-normal text-muted-foreground">
          The ticket tag is added automatically so replies come back to this ticket.
        </span>
      </label>
      <textarea
        name="body"
        rows={6}
        required
        placeholder="Your reply to the client…"
        className={inputCls}
      />
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-muted-foreground">
          Sends from {mailbox}
          {firstResponsePending ? " · records the SLA first response" : ""}.
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="ml-auto rounded-md border px-3 py-1.5 text-sm font-medium transition hover:bg-accent"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          <Mail className="h-4 w-4" />
          {pending ? "Sending…" : "Send email"}
        </button>
      </div>
      {result && (
        <p className={`text-sm ${result.ok ? "text-success" : "text-danger"}`}>{result.message}</p>
      )}
    </form>
  );
}
