/**
 * Mapping a SuperOps ticket onto a SilverFang one.
 *
 * Both systems use free text where SilverFang uses enums and rows, so this is
 * string matching again — and again the honest way to ship it is pure, tested, and
 * reporting what it could not place rather than guessing.
 *
 * The overwrite decision lives here too. It is the part with consequences: an
 * import that silently rewrote a ticket a technician had already worked on would
 * destroy notes-worth of context, so the choice is explicit and the *skip* is the
 * default.
 */

export type TicketPriority = "P1" | "P2" | "P3" | "P4";

/**
 * SuperOps priority text → SilverFang priority.
 *
 * Falls back to P3 rather than refusing the ticket: an unrecognised priority is a
 * detail worth getting slightly wrong, where dropping the ticket is not.
 */
export function mapPriority(value: string | null | undefined): TicketPriority {
  const text = (value ?? "").toLowerCase();
  if (/\b(p1|critical|urgent|emergency)\b/.test(text)) return "P1";
  if (/\b(p2|high)\b/.test(text)) return "P2";
  if (/\b(p4|low|minor|planning)\b/.test(text)) return "P4";
  return "P3";
}

export interface StatusOption {
  id: string;
  name: string;
  isDefault: boolean;
  isClosed: boolean;
}

export interface StatusMatch {
  statusId: string;
  /** How it was chosen, reported so an operator can see what was inferred. */
  via: "name" | "closed" | "open-default" | "default";
}

/** Lower-cased, punctuation-stripped, for comparing status names. */
function statusKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const CLOSED_WORDS = /\b(closed|resolved|complete|completed|cancelled|canceled|done)\b/;

/**
 * The SilverFang status a SuperOps status name should land on.
 *
 * Exact name first, then closed-vs-open, then the board default. Getting the
 * open/closed side right matters more than the exact label: a closed source ticket
 * arriving open would put finished work back in somebody's queue, and an open one
 * arriving closed would hide live work.
 *
 * Returns null only when the board has no statuses at all, which is a setup
 * problem rather than a mapping one.
 */
export function matchStatus(
  sourceName: string | null | undefined,
  statuses: StatusOption[],
): StatusMatch | null {
  if (statuses.length === 0) return null;
  const text = (sourceName ?? "").trim();

  if (text) {
    const key = statusKey(text);
    const exact = statuses.find((s) => statusKey(s.name) === key);
    if (exact) return { statusId: exact.id, via: "name" };

    if (CLOSED_WORDS.test(text.toLowerCase())) {
      const closed = statuses.find((s) => s.isClosed);
      if (closed) return { statusId: closed.id, via: "closed" };
    }
  }

  const openDefault = statuses.find((s) => s.isDefault && !s.isClosed);
  if (openDefault) return { statusId: openDefault.id, via: "open-default" };
  const anyOpen = statuses.find((s) => !s.isClosed);
  if (anyOpen) return { statusId: anyOpen.id, via: "open-default" };
  return { statusId: statuses[0]!.id, via: "default" };
}

export type ImportAction = "create" | "overwrite" | "skip";

/**
 * What to do with one source ticket.
 *
 * `overwrite: false` is the safe answer and the default: an existing ticket is
 * left exactly as it is. `overwrite: true` refreshes it in place.
 *
 * Locally-edited tickets are still overwritten when overwrite is on — the operator
 * asked for that explicitly, and quietly excluding some rows would make the count
 * a lie. What is *never* overwritten is a ticket somebody has closed, because
 * reopening finished work is a change nobody asked for and the source being stale
 * is the more likely explanation.
 */
export function importAction(input: {
  existing: { id: string; closedAt: Date | null } | null;
  overwrite: boolean;
}): ImportAction {
  if (!input.existing) return "create";
  if (!input.overwrite) return "skip";
  if (input.existing.closedAt) return "skip";
  return "overwrite";
}

/** Match a source technician name to a user, by name then by email local part. */
export function matchTechnician(
  technician: string | null | undefined,
  users: { id: string; name: string | null; email: string }[],
): string | null {
  const text = (technician ?? "").trim().toLowerCase();
  if (!text) return null;

  const byName = users.filter((u) => (u.name ?? "").trim().toLowerCase() === text);
  // Only an unambiguous match: two people with the same display name means we
  // cannot tell, and assigning to the wrong one is worse than leaving it blank.
  if (byName.length === 1) return byName[0]!.id;

  const byEmail = users.filter((u) => u.email.toLowerCase() === text);
  if (byEmail.length === 1) return byEmail[0]!.id;

  const byLocal = users.filter((u) => u.email.split("@")[0]?.toLowerCase() === text);
  if (byLocal.length === 1) return byLocal[0]!.id;

  return null;
}

/** A usable summary from a source subject, or a stated placeholder. */
export function summaryFrom(subject: string | null | undefined, displayId: string | null): string {
  const text = (subject ?? "").trim().replace(/\s+/g, " ");
  if (text) return text.slice(0, 300);
  // Never blank: a ticket with no summary is unreadable in a list, and saying
  // where it came from is more use than an empty cell.
  return displayId ? `Imported ticket ${displayId}` : "Imported ticket (no subject)";
}

export interface ImportCounts {
  /** Source tickets considered. */
  available: number;
  created: number;
  overwritten: number;
  /** Left alone because they already exist and overwrite was off. */
  skippedExisting: number;
  /** Left alone because somebody has closed them here. */
  skippedClosed: number;
  /** Source client not linked to a Wolf365 client, so there is nowhere to file it. */
  skippedNoClient: number;
  /** Hit the per-run bound; a second run continues. */
  truncated: boolean;
}

/** Plain-English summary, with every skip named. */
export function describeImport(c: ImportCounts, overwrite: boolean): string {
  if (c.available === 0) {
    return "No SuperOps tickets are stored in Wolf365 yet — run the SuperOps ticket sync first, then import.";
  }
  const parts = [`${c.created} created`];
  if (overwrite) parts.push(`${c.overwritten} overwritten`);
  else if (c.skippedExisting > 0) parts.push(`${c.skippedExisting} left as they are`);
  if (c.skippedClosed > 0) parts.push(`${c.skippedClosed} skipped (closed here)`);
  if (c.skippedNoClient > 0) parts.push(`${c.skippedNoClient} skipped (client not linked)`);

  let text = `${parts.join(", ")}, out of ${c.available} SuperOps ticket(s).`;
  if (!overwrite && c.skippedExisting > 0) {
    text += " Re-run with overwrite on to refresh those from SuperOps.";
  }
  if (c.skippedNoClient > 0) {
    text += " Run Import from SuperOps on the Clients page to link the missing clients first.";
  }
  if (c.truncated) text += " The per-run limit was reached — run it again to continue.";
  return text;
}
