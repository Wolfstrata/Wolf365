"use client";

import { useActionState, useState } from "react";
import { UserPlus, Users } from "lucide-react";
import { LocalTime } from "@/components/ui/local-time";
import { describeTier, type SuggestionTier } from "@/lib/silverfang/sender-match";
import { Combobox } from "@/components/ui/combobox";
import {
  adoptAllSuggestedSendersAction,
  adoptSenderAction,
  type SfActionResult,
} from "../actions";

export interface UnknownSenderRow {
  address: string;
  domain: string;
  count: number;
  lastAt: string; // ISO
  lastSubject: string | null;
  mailbox: string | null;
  suggestedClientId: string | null;
  suggestedTier: SuggestionTier | null;
  nameable: boolean;
}

/**
 * Unrecognised senders, one row per person, each with a one-click fix.
 *
 * Grouped rather than listed per message: the raw log repeats a sender once per
 * message, because a person who emails and gets no reply emails again. The
 * decision is per *person*, so the count goes in the row.
 *
 * The client select is pre-set to the suggestion where there is one, so the common
 * case is pressing one button. Where the match is only a guess it says so, and
 * where there is no match the select starts empty and the operator chooses.
 *
 * No permission prop: the only page this lives on already requires
 * `silverfang:configure`, and both actions re-check server-side anyway.
 */
export function UnknownSenders({
  rows,
  clients,
}: {
  rows: UnknownSenderRow[];
  clients: { id: string; name: string }[];
}) {
  const [allResult, allAction, allPending] = useActionState<SfActionResult | null, FormData>(
    adoptAllSuggestedSendersAction,
    null,
  );

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No unrecognised senders outstanding. Mail from someone nobody has on file shows up here
        with a one-click way to file them against a client.
      </p>
    );
  }

  const confident = rows.filter(
    (r) => r.suggestedClientId && r.suggestedTier !== "partial" && r.nameable,
  ).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm">
          <span className="font-medium">{rows.length}</span> sender
          {rows.length === 1 ? "" : "s"} nobody has on file
        </span>
        {confident > 0 && (
          <form action={allAction}>
            <button
              type="submit"
              disabled={allPending}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition hover:bg-accent disabled:opacity-60"
            >
              <Users className={`h-3.5 w-3.5 ${allPending ? "animate-pulse" : ""}`} />
              {allPending ? "Adding…" : `Add all ${confident} confident matches`}
            </button>
          </form>
        )}
      </div>

      {allResult && (
        <p className={`text-xs ${allResult.ok ? "text-success" : "text-danger"}`}>
          {allResult.message}
        </p>
      )}

      <ul className="divide-y">
        {rows.map((row) => (
          <SenderRow key={row.address} row={row} clients={clients} />
        ))}
      </ul>

      <p className="text-xs text-muted-foreground">
        Adding a contact fixes the <span className="font-medium">next</span> message from that
        sender — the ones already refused are not retried, because the mailbox poll has moved past
        them. Only the address is needed; the name is taken from it and everything else on the
        contact is optional.
      </p>
    </div>
  );
}

function SenderRow({
  row,
  clients,
}: {
  row: UnknownSenderRow;
  clients: { id: string; name: string }[];
}) {
  const [result, action, pending] = useActionState<SfActionResult | null, FormData>(
    adoptSenderAction,
    null,
  );
  const [clientId, setClientId] = useState(row.suggestedClientId ?? "");

  // Done rows stay put rather than vanishing: seeing the confirmation next to the
  // address is how you know which of eighteen rows you just dealt with.
  const done = result?.ok === true;

  return (
    <li className={`py-2.5 text-sm ${done ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-mono text-xs">{row.address}</span>
        {row.count > 1 && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {row.count} messages
          </span>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          <LocalTime value={row.lastAt} />
        </span>
      </div>

      {row.lastSubject && (
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{row.lastSubject}</p>
      )}

      {!row.nameable ? (
        <p className="mt-1 text-xs text-warning">
          No name can be derived from this address (it looks automated), so a contact would have a
          blank name. Create it by hand from the client page if you do want it.
        </p>
      ) : done ? (
        <p className="mt-1 text-xs text-success">{result.message}</p>
      ) : (
        <form action={action} className="mt-1.5 flex flex-wrap items-center gap-2">
          <input type="hidden" name="address" value={row.address} />
          {/* Type-to-filter: with a couple of thousand clients, scrolling to the
              right one for each of eighteen senders is the slow part. */}
          <div className="w-64">
            <Combobox
              name="clientId"
              options={clients.map((c) => ({ id: c.id, label: c.name }))}
              value={clientId}
              onChange={setClientId}
              placeholder="Type to find a client…"
              emptyLabel={null}
              required
            />
          </div>
          <button
            type="submit"
            disabled={pending || !clientId}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
          >
            <UserPlus className="h-3.5 w-3.5" />
            {pending ? "Adding…" : "Add contact"}
          </button>
          {row.suggestedTier && clientId === row.suggestedClientId ? (
            <span
              className={`text-xs ${row.suggestedTier === "partial" ? "text-warning" : "text-muted-foreground"}`}
            >
              Suggested: {describeTier(row.suggestedTier)}
            </span>
          ) : (
            !row.suggestedClientId && (
              <span className="text-xs text-muted-foreground">
                No client matches {row.domain} — pick one.
              </span>
            )
          )}
        </form>
      )}

      {result && !result.ok && <p className="mt-1 text-xs text-danger">{result.message}</p>}
    </li>
  );
}
