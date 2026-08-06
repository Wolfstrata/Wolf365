"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Mail } from "lucide-react";
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
}: {
  ticketId: string;
  defaultTo: string;
  defaultSubject: string;
  /** The address the reply will come from, or null when none is configured. */
  mailbox: string | null;
  firstResponsePending: boolean;
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
