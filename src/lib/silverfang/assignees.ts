/**
 * Assignment rules for a ticket with several assignees.
 *
 * Two columns hold the answer — `SfTicket.assigneeId` (the primary) and the
 * `SfTicketAssignee` rows (everyone) — because plenty needs a single owner:
 * the ASSIGNEE audience on auto-responses, utilisation reporting, and the
 * "unassigned" count. Two columns means a drift risk, so the rule for deriving
 * one from the other lives here, pure and tested, and exactly one writer uses it.
 *
 * Assignment is **additive**: adding someone must never quietly remove whoever was
 * already on the ticket. That is a data-loss bug disguised as a UI detail, so the
 * merge is a function with tests rather than a line inside an action.
 */

export interface AssignmentChange {
  /** Everyone on the ticket after the change, primary first. */
  userIds: string[];
  /** The primary — the first of `userIds`, or null when nobody is assigned. */
  primaryId: string | null;
  added: string[];
  removed: string[];
  /** False when the change is a no-op, so callers can skip the write. */
  changed: boolean;
}

/** Dedupe and blank-strip, preserving first-seen order. */
export function normalizeAssigneeIds(raw: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of raw) {
    const id = (value ?? "").trim();
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Work out the change from the current set to a requested set.
 *
 * The requested list **replaces** the set — that is what a multi-select submits,
 * and it is the only way to express a removal. "Additive" is enforced in the UI,
 * which starts from the current selection rather than from empty; see
 * `addAssignees` for the genuinely additive path used by bulk actions.
 *
 * The primary is preserved when they are still assigned, rather than being reset
 * to whatever now happens to sort first: the primary is who notifications go to,
 * and silently moving that because somebody was added is surprising.
 */
export function resolveAssignment(input: {
  current: string[];
  currentPrimary: string | null;
  requested: string[];
}): AssignmentChange {
  const current = normalizeAssigneeIds(input.current);
  const requested = normalizeAssigneeIds(input.requested);

  const keepPrimary =
    input.currentPrimary && requested.includes(input.currentPrimary)
      ? input.currentPrimary
      : null;
  // Primary first, so `userIds[0]` is always the primary and callers need no
  // second field to find it.
  const ordered = keepPrimary
    ? [keepPrimary, ...requested.filter((id) => id !== keepPrimary)]
    : requested;

  const currentSet = new Set(current);
  const requestedSet = new Set(requested);
  const added = requested.filter((id) => !currentSet.has(id));
  const removed = current.filter((id) => !requestedSet.has(id));
  const primaryId = ordered[0] ?? null;

  return {
    userIds: ordered,
    primaryId,
    added,
    removed,
    changed: added.length > 0 || removed.length > 0 || primaryId !== input.currentPrimary,
  };
}

/**
 * Strictly additive: add these people, keep everyone already there.
 *
 * Used where the intent is unambiguous — a bulk "also assign to" — so nothing can
 * be dropped by a stale page listing fewer assignees than the ticket now has.
 */
export function addAssignees(input: {
  current: string[];
  currentPrimary: string | null;
  add: string[];
}): AssignmentChange {
  const current = normalizeAssigneeIds(input.current);
  return resolveAssignment({
    current,
    currentPrimary: input.currentPrimary,
    requested: [...current, ...normalizeAssigneeIds(input.add)],
  });
}

/** How the assignees read in a table cell or on a ticket. */
export function assigneeSummary(names: string[]): string {
  if (names.length === 0) return "Unassigned";
  if (names.length <= 2) return names.join(", ");
  return `${names[0]}, ${names[1]} +${names.length - 2}`;
}

/** What the change says in a history row or an action result. */
export function describeAssignment(change: AssignmentChange, nameOf: (id: string) => string): string {
  if (!change.changed) return "no assignee change";
  const parts: string[] = [];
  if (change.added.length > 0) parts.push(`added ${change.added.map(nameOf).join(", ")}`);
  if (change.removed.length > 0) parts.push(`removed ${change.removed.map(nameOf).join(", ")}`);
  if (parts.length === 0) parts.push("changed the primary assignee");
  return parts.join("; ");
}
