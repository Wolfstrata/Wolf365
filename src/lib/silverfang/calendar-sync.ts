/**
 * Turning a SilverFang time block into an Outlook calendar event.
 *
 * Pure, because the two decisions here are both easy to get subtly wrong and both
 * invisible when they are: *whether* a block belongs on someone's calendar, and
 * *what* it says once it is there.
 *
 * Direction is one-way, Wolf365 → Outlook. Nothing read from Outlook is written
 * back, so an event a tech edits in Outlook is overwritten on the next sync — the
 * block in Wolf365 is the record, and pretending otherwise would mean silently
 * choosing a winner every time the two disagree.
 */

/** The parts of a time block that decide and shape its event. */
export interface SyncableBlock {
  id: string;
  startedAt: Date | null;
  endedAt: Date | null;
  /** Free text the tech typed. May be absent. */
  notes: string | null;
  /** True when the notes must not leave Wolf365. */
  internalOnly: boolean;
  ticketNumber: number | null;
  ticketSummary: string | null;
  clientName: string | null;
  chargeCodeName: string | null;
}

/** The tech's sync configuration. */
export interface SyncTarget {
  calendarMailbox: string | null;
  calendarSyncEnabled: boolean;
  active: boolean;
}

export type SkipReason =
  | "sync-disabled"
  | "no-mailbox"
  | "profile-inactive"
  | "no-times"
  | "zero-length"
  | "reversed-times";

export type SyncDecision = { sync: true } | { sync: false; reason: SkipReason };

/**
 * Whether this block belongs on that calendar.
 *
 * Every refusal is named rather than returning a bare false, so the caller can
 * report why nothing appeared — "I enabled sync and my calendar is still empty"
 * is otherwise unanswerable without reading code.
 */
export function shouldSyncBlock(block: SyncableBlock, target: SyncTarget): SyncDecision {
  if (!target.active) return { sync: false, reason: "profile-inactive" };
  if (!target.calendarSyncEnabled) return { sync: false, reason: "sync-disabled" };
  if (!target.calendarMailbox?.trim()) return { sync: false, reason: "no-mailbox" };
  // A block with no clock is a duration, not an appointment. Most time is logged
  // that way — "1.5h today" — and inventing a start time to place it on a
  // calendar would put work at an hour nobody did it.
  if (!block.startedAt || !block.endedAt) return { sync: false, reason: "no-times" };
  const ms = block.endedAt.getTime() - block.startedAt.getTime();
  if (ms < 0) return { sync: false, reason: "reversed-times" };
  if (ms === 0) return { sync: false, reason: "zero-length" };
  return { sync: true };
}

export const SKIP_LABELS: Record<SkipReason, string> = {
  "sync-disabled": "Calendar sync is switched off for this technician.",
  "no-mailbox": "No calendar mailbox is set on the technician's profile.",
  "profile-inactive": "The technician's SilverFang profile is inactive.",
  "no-times": "The block has no start and end time — only timed blocks become events.",
  "zero-length": "The block starts and ends at the same moment.",
  "reversed-times": "The block ends before it starts.",
};

export interface CalendarEventShape {
  subject: string;
  /** Plain-text body. Never HTML: this is a description, not a message. */
  body: string;
  startIso: string;
  endIso: string;
}

/** Truncate for a subject line without cutting mid-word where avoidable. */
function clamp(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${space > max * 0.6 ? cut.slice(0, space) : cut}…`;
}

/**
 * The event a block becomes.
 *
 * The subject leads with the ticket number so a tech scanning their day can match
 * a calendar entry to a ticket without opening either. Notes marked internal-only
 * are omitted from the body — the mailbox belongs to staff, but "internal only" is
 * a promise about where that text goes, and a calendar event is somewhere else.
 */
export function calendarEventFor(block: SyncableBlock): CalendarEventShape {
  if (!block.startedAt || !block.endedAt) {
    throw new Error("calendarEventFor requires a block with both a start and an end");
  }

  const label = block.ticketSummary ?? block.chargeCodeName ?? "Scheduled work";
  const prefix = block.ticketNumber != null ? `#${block.ticketNumber} ` : "";
  const client = block.clientName ? ` — ${block.clientName}` : "";
  const subject = clamp(`${prefix}${label}${client}`, 120);

  const lines: string[] = [];
  if (block.clientName) lines.push(`Client: ${block.clientName}`);
  if (block.ticketNumber != null) {
    lines.push(`Ticket: #${block.ticketNumber}${block.ticketSummary ? ` — ${block.ticketSummary}` : ""}`);
  }
  if (block.chargeCodeName) lines.push(`Charge code: ${block.chargeCodeName}`);
  if (block.notes && !block.internalOnly) lines.push("", block.notes);
  lines.push("", "Created by Wolf365 SilverFang. Edits here are overwritten on the next sync.");

  return {
    subject,
    body: lines.join("\n"),
    startIso: block.startedAt.toISOString(),
    endIso: block.endedAt.toISOString(),
  };
}

/**
 * Whether a stored event needs rewriting.
 *
 * Compared on the times only. The subject and body are cheap to send but a PATCH
 * per sync pass on unchanged blocks would rewrite every event on every cron run,
 * which shows up in a mailbox's audit log as constant churn.
 */
export function eventNeedsUpdate(
  link: { startAt: Date; endAt: Date },
  block: SyncableBlock,
): boolean {
  if (!block.startedAt || !block.endedAt) return false;
  return (
    link.startAt.getTime() !== block.startedAt.getTime() ||
    link.endAt.getTime() !== block.endedAt.getTime()
  );
}
