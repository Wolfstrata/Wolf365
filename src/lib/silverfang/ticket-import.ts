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

// ---------------------------------------------------------------------------
// Reading the synced ticket JSON
// ---------------------------------------------------------------------------

/**
 * The connector builds its ticket query by introspecting SuperOps' schema, so the
 * stored `raw` object holds every scalar SuperOps exposes — description,
 * requester, category, source, resolution times — under whatever key names that
 * tenant's schema uses.
 *
 * That is why this reads defensively from a list of candidate keys rather than a
 * fixed shape: the alternative is a mapping that silently returns nothing the day
 * SuperOps renames a field, and a ticket imported with an empty body looks like a
 * ticket that never had one.
 */
type Raw = Record<string, unknown>;

function isObj(v: unknown): v is Raw {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** First non-empty string at any of these keys. */
function rawString(obj: Raw, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
}

/**
 * A name out of either a string or a nested object — SuperOps returns some fields
 * flat and some as `{ name }`, and which is which varies by tenant.
 */
function rawName(obj: Raw, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (isObj(v)) {
      const n = rawString(v, ["name", "displayName", "fullName", "label", "title"]);
      if (n) return n;
    }
  }
  return null;
}

/** An email out of either a string or a nested requester object. */
function rawEmail(obj: Raw, keys: string[]): string | null {
  const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && looksLikeEmail(v.trim())) return v.trim().toLowerCase();
    if (isObj(v)) {
      const e = rawString(v, ["email", "emailId", "emailAddress", "primaryEmail"]);
      if (e && looksLikeEmail(e)) return e.toLowerCase();
    }
  }
  return null;
}

function rawDate(obj: Raw, keys: string[]): Date | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return d;
    }
    if (typeof v === "number" && v > 0) {
      const d = new Date(v < 1e12 ? v * 1000 : v);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return null;
}

/** Strip HTML to readable text — SuperOps descriptions are often rich text. */
export function htmlToText(value: string): string {
  return value
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    // Paragraphs and headings get a blank line, list rows a single break —
    // otherwise a multi-paragraph description arrives as one wall of text.
    .replace(/<\/(p|div|h[1-6])>/gi, "\n\n")
    .replace(/<\/(li|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type TicketSource = "PORTAL" | "EMAIL" | "PHONE" | "ALERT" | "PROJECT" | "RECURRING";

/** SuperOps channel/source text → SilverFang source. */
export function mapSource(value: string | null | undefined): TicketSource {
  const text = (value ?? "").toLowerCase();
  if (/\b(email|mail)\b/.test(text)) return "EMAIL";
  if (/\b(phone|call|voice|telephone)\b/.test(text)) return "PHONE";
  if (/\b(alert|monitor|monitoring|rmm|automation)\b/.test(text)) return "ALERT";
  // PORTAL is the honest default: it is what "raised in the tool" means, and a
  // wrong channel is a reporting detail rather than a routing one.
  return "PORTAL";
}

export interface TicketDetail {
  description: string | null;
  requesterEmail: string | null;
  requesterName: string | null;
  category: string | null;
  subCategory: string | null;
  source: TicketSource;
  siteName: string | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
}

/** Everything worth carrying across, read out of the synced JSON. */
export function extractTicketDetail(raw: unknown): TicketDetail {
  const obj = isObj(raw) ? raw : {};

  const body = rawString(obj, [
    "description",
    "ticketDescription",
    "content",
    "body",
    "requestDescription",
    "problemDescription",
    "notes",
  ]);

  return {
    description: body ? (htmlToText(body) || null) : null,
    requesterEmail: rawEmail(obj, [
      "requester",
      "requesterEmail",
      "contact",
      "contactEmail",
      "reportedBy",
      "createdBy",
      "email",
    ]),
    requesterName: rawName(obj, ["requester", "contact", "reportedBy", "requesterName"]),
    category: rawName(obj, ["category", "ticketCategory", "issueType", "classification"]),
    subCategory: rawName(obj, ["subCategory", "subcategory", "ticketSubCategory", "issueSubType"]),
    source: mapSource(rawName(obj, ["source", "channel", "ticketSource", "createdVia", "medium"])),
    siteName: rawName(obj, ["site", "location", "siteName"]),
    resolvedAt: rawDate(obj, ["resolvedTime", "resolvedAt", "resolutionTime"]),
    closedAt: rawDate(obj, ["closedTime", "closedAt", "completedTime"]),
  };
}

/** Worklog minutes → hours, rounded to the quarter SilverFang bills in. */
export function worklogHours(minutes: number | null | undefined): number | null {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return null;
  return Math.round((minutes / 60) * 100) / 100;
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
