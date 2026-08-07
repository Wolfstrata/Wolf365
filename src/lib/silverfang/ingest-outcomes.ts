import type { IngestResult, IngestSkipReason } from "@/lib/silverfang/email-ingest";

/**
 * What happened to an inbound message, in words an operator can act on.
 *
 * The ingest already decides honestly — every path returns a named outcome rather
 * than dropping mail — but those names only ever existed inside a JSON response
 * nobody reads. "1 fetched, 0 new tickets" is true and useless: it does not say
 * whether the message was a deliberate skip, a configuration gap, or a fault.
 *
 * Pure on purpose: the vocabulary is the part worth testing, and it is shared by
 * the poll summary, the webhook response and the Email page.
 */

/** Every terminal state a message can reach. */
export type MailDecision =
  | "created"
  | "appended"
  | "deduped"
  | IngestSkipReason;

/**
 * How much attention a decision deserves.
 *  - `filed`    the message became ticket content
 *  - `ignored`  correctly not filed; nothing to fix
 *  - `problem`  mail was lost to a gap in configuration or a fault
 */
export type DecisionKind = "filed" | "ignored" | "problem";

export interface DecisionInfo {
  label: string;
  kind: DecisionKind;
  /** What the system did, and why. */
  explanation: string;
  /** The fix, for a `problem` only — an `ignored` outcome has nothing to fix. */
  remedy?: string;
}

const DECISIONS: Record<MailDecision, DecisionInfo> = {
  created: {
    label: "Opened a ticket",
    kind: "filed",
    explanation: "The sender matched a client and a new ticket was opened.",
  },
  appended: {
    label: "Added to a ticket",
    kind: "filed",
    explanation:
      "The message was a reply, matched to its ticket by the subject tag, our own header, or its threading headers.",
  },
  deduped: {
    label: "Already filed",
    kind: "ignored",
    explanation:
      "This exact message had been filed before, so it was not filed twice. Normal after a re-delivered webhook or a re-read mailbox.",
  },
  "auto-reply": {
    label: "Auto-reply ignored",
    kind: "ignored",
    explanation:
      "Machine-generated mail — an out-of-office, a bounce, or similar. It never opens a ticket and never triggers a reply, because two robots answering each other does not stop on its own.",
  },
  "loop-self": {
    label: "Our own mail ignored",
    kind: "ignored",
    explanation:
      "The sender was one of this mailbox's own addresses, so the message was our outbound mail arriving back. Filing it would loop.",
  },
  "unknown-sender": {
    label: "Sender not recognised",
    kind: "problem",
    explanation:
      "No contact holds this address, no other contact shares its domain, and the mailbox has no fallback client — so there was no client to open the ticket against.",
    remedy:
      "Add the sender as a contact on the right client, or set a fallback client on the mailbox so unmatched mail still lands somewhere.",
  },
  "no-mailbox": {
    label: "No mailbox matched",
    kind: "problem",
    explanation:
      "The message named a mailbox that is not configured for inbound, or named none while more than one exists — and mail is never filed against an arbitrary mailbox.",
    remedy:
      "Add or enable the inbound mailbox for that address, and check the address the forwarder delivers as.",
  },
  "no-board": {
    label: "No board to open on",
    kind: "problem",
    explanation:
      "No active board with statuses exists, so there was nowhere to put a new ticket.",
    remedy: "Run SilverFang Setup to create the default board and statuses.",
  },
  "missing-sender": {
    label: "No sender address",
    kind: "problem",
    explanation:
      "The message carried no usable From address, so neither a client nor a contact could be resolved.",
    remedy:
      "Usually a malformed forward or a provider quirk. Check the raw message in the mailbox.",
  },
  error: {
    label: "Failed",
    kind: "problem",
    explanation: "Processing threw an error, so the message was left unfiled.",
    remedy:
      "The reason is recorded alongside this entry. The message stays in the mailbox, so fixing the cause and polling again re-files it.",
  },
};

/** What a decision means. Unknown values degrade to a `problem` rather than throw. */
export function describeDecision(decision: string): DecisionInfo {
  return (
    DECISIONS[decision as MailDecision] ?? {
      label: decision,
      kind: "problem",
      explanation: "An outcome this version of the app does not recognise.",
    }
  );
}

/** The decision an ingest result represents. */
export function decisionOf(result: IngestResult): MailDecision {
  return result.ok ? result.action : result.reason;
}

/** True when someone needs to do something about it. */
export function needsAttention(decision: string): boolean {
  return describeDecision(decision).kind === "problem";
}

/**
 * Decisions that need no action, for querying "show me the ones that do".
 *
 * Expressed as the set to EXCLUDE rather than the set of problems, so that a
 * decision string this version does not recognise still appears in the
 * needs-attention list. Listing the problems instead would silently hide anything
 * new — matching `describeDecision`, which degrades an unknown value to a problem
 * rather than assuming it is fine.
 */
export const SETTLED_DECISIONS: string[] = (
  Object.keys(DECISIONS) as MailDecision[]
).filter((d) => DECISIONS[d].kind !== "problem");

/**
 * One line summarising a poll, naming the outcomes rather than only counting the
 * happy ones — the whole reason this module exists.
 */
export function summarizePoll(counts: {
  fetched: number;
  created: number;
  appended: number;
  deduped: number;
  skipped: Record<string, number>;
}): string {
  const parts: string[] = [`${counts.fetched} fetched`];
  if (counts.created > 0) parts.push(`${counts.created} new ticket(s)`);
  if (counts.appended > 0) parts.push(`${counts.appended} appended`);
  if (counts.deduped > 0) parts.push(`${counts.deduped} already filed`);
  for (const [reason, n] of Object.entries(counts.skipped)) {
    if (n > 0) parts.push(`${n} ${describeDecision(reason).label.toLowerCase()}`);
  }
  if (parts.length === 1) {
    // Distinguish "nothing arrived" from "things arrived and all were skipped" —
    // reporting both as "0 new tickets" is what made this opaque.
    parts.push(counts.fetched === 0 ? "nothing new in the mailbox" : "none filed");
  }
  return parts.join(", ");
}
