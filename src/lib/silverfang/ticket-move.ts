/**
 * Moving tickets between boards and projects.
 *
 * The trap here is that a status belongs to a board. `SfTicket.statusId` points at
 * one of *its board's* statuses, so a move that only rewrites `boardId` leaves the
 * ticket pointing at a status on a board it is no longer on — a dangling reference
 * that renders as a status the board does not have and breaks every open/closed
 * filter that reads through it.
 *
 * So every board move must remap the status, and this is where that mapping is
 * decided. Pure and tested: a mapping that silently reopened closed tickets, or
 * closed open ones, would quietly corrupt the queue and the SLA figures with it.
 */

export interface StatusLike {
  id: string;
  name: string;
  isOpen: boolean;
  isClosed: boolean;
  isDefault: boolean;
  stopsSlaClock: boolean;
  sortOrder: number;
}

export type StatusMatch = "name" | "closed-equivalent" | "paused-equivalent" | "default";

export interface StatusMapping {
  statusId: string;
  /** How the target was chosen, so the move can report what it did. */
  via: StatusMatch;
}

/**
 * The status a ticket should hold on its new board.
 *
 * Order of preference:
 *  1. the same status name — boards seeded from the same defaults share names, so
 *     this is the common case and preserves exactly where the ticket was
 *  2. an equivalent by meaning — a closed ticket stays closed, a paused one stays
 *     paused. Getting this wrong is worse than the move failing: reopening a batch
 *     of closed tickets restarts their SLA clocks and puts them back in the queue
 *  3. the target board's default status, for an open ticket with no better match
 *
 * Returns null when the target board has no statuses at all, so the caller refuses
 * the move rather than writing a null reference.
 */
export function mapStatusToBoard(
  current: StatusLike,
  targetStatuses: StatusLike[],
): StatusMapping | null {
  if (targetStatuses.length === 0) return null;

  const byName = targetStatuses.find(
    (s) => s.name.trim().toLowerCase() === current.name.trim().toLowerCase(),
  );
  if (byName) return { statusId: byName.id, via: "name" };

  if (current.isClosed) {
    // Lowest-sorted closed status: "Resolved" before "Closed" on the default flow,
    // which is the less final of the two and the safer landing place.
    const closed = targetStatuses
      .filter((s) => s.isClosed)
      .sort((a, b) => a.sortOrder - b.sortOrder)[0];
    // Never silently reopen. Without a closed status on the target there is no
    // honest destination, so the caller must refuse.
    if (!closed) return null;
    return { statusId: closed.id, via: "closed-equivalent" };
  }

  if (current.stopsSlaClock) {
    const paused = targetStatuses
      .filter((s) => s.stopsSlaClock && !s.isClosed)
      .sort((a, b) => a.sortOrder - b.sortOrder)[0];
    if (paused) return { statusId: paused.id, via: "paused-equivalent" };
    // Falls through to the default: an open ticket that loses its paused status
    // resumes, which is visible and recoverable, unlike a closed one reopening.
  }

  const fallback =
    targetStatuses.find((s) => s.isDefault && !s.isClosed) ??
    targetStatuses.filter((s) => !s.isClosed).sort((a, b) => a.sortOrder - b.sortOrder)[0];
  if (!fallback) return null;
  return { statusId: fallback.id, via: "default" };
}

export type MoveRefusal =
  | "same-board"
  | "no-target-statuses"
  | "no-equivalent-status"
  | "different-client"
  | "same-project"
  | "phase-not-in-project"
  | "not-found";

export const REFUSAL_LABELS: Record<MoveRefusal, string> = {
  "same-board": "already on that board",
  "no-target-statuses": "the target board has no statuses",
  "no-equivalent-status": "the target board has no closed status to preserve this ticket's state",
  "different-client": "belongs to a different client",
  "same-project": "already on that project",
  "phase-not-in-project": "that phase belongs to a different project",
  "not-found": "no longer exists",
};

/**
 * Whether a ticket may join a project.
 *
 * A project belongs to one client, so a ticket for a different client cannot join
 * it — its hours would land on someone else's total. Refused rather than
 * reassigned: silently changing a ticket's client to make a move work would be a
 * far larger change than the one that was asked for.
 */
export function canJoinProject(
  ticket: { clientId: string; projectId: string | null },
  project: { id: string; clientId: string },
  phase?: { projectId: string } | null,
): MoveRefusal | null {
  if (ticket.clientId !== project.clientId) return "different-client";
  if (phase && phase.projectId !== project.id) return "phase-not-in-project";
  if (ticket.projectId === project.id && !phase) return "same-project";
  return null;
}

/** One line summarising a bulk move, naming what was refused and why. */
export function summarizeMove(
  moved: number,
  refusals: { number: number; reason: MoveRefusal }[],
): string {
  const parts = [`${moved} ticket${moved === 1 ? "" : "s"} moved`];
  if (refusals.length === 0) return `${parts[0]}.`;

  // Grouped by reason: fifteen tickets refused for one reason should read as one
  // sentence, not fifteen.
  const byReason = new Map<MoveRefusal, number[]>();
  for (const r of refusals) {
    const list = byReason.get(r.reason) ?? [];
    list.push(r.number);
    byReason.set(r.reason, list);
  }
  for (const [reason, numbers] of byReason) {
    const shown = numbers.slice(0, 5).map((n) => `#${n}`).join(", ");
    const more = numbers.length > 5 ? ` and ${numbers.length - 5} more` : "";
    parts.push(`${numbers.length} skipped — ${REFUSAL_LABELS[reason]} (${shown}${more})`);
  }
  return `${parts.join(". ")}.`;
}
