/**
 * Reading ticket conversations out of SuperOps data.
 *
 * Two sources, and both go through here so they cannot diverge:
 *
 *  1. **Embedded** in the ticket JSON. The connector's ticket query is built by
 *     introspection and expands nested object fields, so on many tenants the
 *     conversation is already sitting in `SuperOpsTicket.raw` and costs nothing
 *     to read.
 *  2. **Fetched** per ticket by the notes sync, for tenants where it is not.
 *
 * Pure, because the shape is genuinely unknown: SuperOps exposes replies, private
 * notes and system events through one collection, distinguished by a field whose
 * name differs between tenants. Guessing wrong turns a private note into
 * something visible to a client, so the private-detection rule is tested rather
 * than trusted.
 */

type Raw = Record<string, unknown>;

function isObj(v: unknown): v is Raw {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(obj: Raw, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function bool(obj: Raw, keys: string[]): boolean | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "boolean") return v;
    if (v === "true") return true;
    if (v === "false") return false;
  }
  return null;
}

function date(obj: Raw, keys: string[]): Date | null {
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

function name(obj: Raw, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (isObj(v)) {
      const n = str(v, ["name", "displayName", "fullName", "email"]);
      if (n) return n;
    }
  }
  return null;
}

function email(obj: Raw, keys: string[]): string | null {
  const ok = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && ok(v.trim())) return v.trim().toLowerCase();
    if (isObj(v)) {
      const e = str(v, ["email", "emailId", "emailAddress"]);
      if (e && ok(e)) return e.toLowerCase();
    }
  }
  return null;
}

/** Field names that plausibly hold a ticket's conversation. */
const COLLECTION_KEYS = [
  "conversations",
  "conversation",
  "notes",
  "ticketNotes",
  "comments",
  "replies",
  "messages",
  "activities",
  "worknotes",
  "workNotes",
  "timeline",
];

export type NoteKind = "reply" | "note" | "system";

export interface ParsedNote {
  /** SuperOps' id, or a synthesised stable one. Never blank. */
  externalId: string;
  kind: NoteKind;
  /**
   * True when SuperOps marked it private/internal, false when it said public,
   * null when it did not say — which the importer treats as private.
   */
  isPrivate: boolean | null;
  author: string | null;
  authorEmail: string | null;
  body: string | null;
  createdAt: Date | null;
}

/** Words that mean "the client never saw this". */
const PRIVATE_WORDS = /\b(private|internal|worknote|work note|note)\b/i;
/** Words that mean "this went to, or came from, the client". */
const PUBLIC_WORDS = /\b(public|reply|response|email|client|customer|outgoing|incoming)\b/i;
const SYSTEM_WORDS = /\b(system|audit|automation|status change|assignment)\b/i;

/**
 * Classify one entry.
 *
 * An explicit boolean always wins. Only when there is none does the type text get
 * a say — and an entry that says nothing at all comes back `null`, which the
 * importer reads as private.
 *
 * That default is the whole safety story: an internal note wrongly marked public
 * can be emailed to a client, while a client reply wrongly marked private is only
 * ever a cosmetic problem on a migrated ticket.
 */
export function classifyNote(raw: unknown): { kind: NoteKind; isPrivate: boolean | null } {
  const obj = isObj(raw) ? raw : {};

  const explicitPrivate = bool(obj, [
    "isPrivate",
    "private",
    "internal",
    "isInternal",
    "internalOnly",
    "isPrivateNote",
  ]);
  const explicitPublic = bool(obj, ["isPublic", "public", "clientVisible", "visibleToClient"]);

  const typeText = [
    name(obj, ["type", "noteType", "conversationType", "entryType", "kind", "category"]),
    str(obj, ["source", "channel", "direction"]),
  ]
    .filter(Boolean)
    .join(" ");

  let kind: NoteKind = "note";
  if (SYSTEM_WORDS.test(typeText)) kind = "system";
  else if (PUBLIC_WORDS.test(typeText)) kind = "reply";

  let isPrivate: boolean | null = null;
  if (explicitPrivate != null) isPrivate = explicitPrivate;
  else if (explicitPublic != null) isPrivate = !explicitPublic;
  else if (typeText) {
    // Check public first: "email reply" contains neither private word, but
    // "private note" contains both patterns' worth of ambiguity if ordered wrong.
    if (PUBLIC_WORDS.test(typeText) && !PRIVATE_WORDS.test(typeText)) isPrivate = false;
    else if (PRIVATE_WORDS.test(typeText)) isPrivate = true;
  }

  return { kind, isPrivate };
}

/**
 * Parse one conversation entry.
 *
 * `fallbackId` makes the entry addressable when SuperOps gives no id of its own —
 * without a stable key a re-import would duplicate the whole conversation, which
 * is the most visible possible way for an import to be wrong.
 */
export function parseNote(raw: unknown, fallbackId: string): ParsedNote | null {
  const obj = isObj(raw) ? raw : null;
  if (!obj) return null;

  const body = str(obj, [
    "content",
    "body",
    "text",
    "note",
    "message",
    "description",
    "comment",
    "htmlContent",
  ]);
  const { kind, isPrivate } = classifyNote(obj);

  // An entry with no body is a status change SuperOps recorded in the same
  // collection. There is nothing to carry across, so it is not a note.
  if (!body) return null;

  return {
    externalId: str(obj, ["id", "noteId", "conversationId", "entryId", "itemId"]) ?? fallbackId,
    kind,
    isPrivate,
    author: name(obj, ["author", "createdBy", "technician", "user", "from", "actor"]),
    authorEmail: email(obj, ["author", "createdBy", "technician", "user", "from", "email"]),
    body,
    createdAt: date(obj, ["createdTime", "createdAt", "time", "timestamp", "sentAt", "date"]),
  };
}

/**
 * Every conversation entry embedded in a ticket's JSON.
 *
 * Returns an empty array when there is none, which is the signal to go and fetch
 * them — an embedded collection that is simply absent looks identical to a ticket
 * with no conversation, and only the notes sync can tell the two apart.
 */
export function extractEmbeddedNotes(raw: unknown, ticketId: string): ParsedNote[] {
  const obj = isObj(raw) ? raw : {};
  const out: ParsedNote[] = [];
  const seen = new Set<string>();

  for (const key of COLLECTION_KEYS) {
    const value = obj[key];
    if (!Array.isArray(value)) continue;
    value.forEach((entry, i) => {
      const parsed = parseNote(entry, `${ticketId}:${key}:${i}`);
      if (!parsed || seen.has(parsed.externalId)) return;
      seen.add(parsed.externalId);
      out.push(parsed);
    });
  }

  // Oldest first: a conversation reads in the order it happened.
  return out.sort(
    (a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0),
  );
}

/**
 * Whether a parsed note should be internal in SilverFang.
 *
 * Unknown means internal. A migrated internal note that leaked to a client is not
 * recoverable; a client reply that is merely marked internal is a cosmetic
 * problem on a historical ticket.
 */
export function isInternalNote(note: ParsedNote): boolean {
  if (note.kind === "system") return true;
  return note.isPrivate ?? true;
}

/** The countable outcome of one conversation-mirror run. */
export interface NoteSyncOutcome {
  notes: number;
  ticketsScanned: number;
  fromEmbedded: number;
  queryUsed: string | null;
  argUsed?: string | null;
  failedTickets?: number;
  firstError?: string;
  /** Distinct error samples, so a second cause is not hidden behind the first. */
  errorSamples?: string[];
  unparsedRecords?: number;
  emptyTickets?: number;
  error?: string;
}

/**
 * Turn a mirror run into an honest sentence.
 *
 * The rule this exists to enforce: **zero notes is never reported as success.**
 * A run that called 262 tickets and got 262 errors previously read "0 conversation
 * entries mirrored" in success green, which is indistinguishable from 262 tickets
 * that genuinely have no history. One of those means fix the query; the other
 * means carry on and cancel the subscription. Getting them confused loses the
 * history permanently, because the API is gone by the time anyone notices.
 *
 * So every zero says which zero it is, and every partial says what it lost.
 */
export function describeNoteSync(r: NoteSyncOutcome): { ok: boolean; message: string } {
  const failed = r.failedTickets ?? 0;
  const unparsed = r.unparsedRecords ?? 0;
  const entries = `${r.notes} conversation entr${r.notes === 1 ? "y" : "ies"}`;
  // Prefer the distinct samples: one message repeated 145 times and two different
  // causes look identical otherwise.
  const why =
    r.errorSamples && r.errorSamples.length > 0
      ? r.errorSamples.join(" / ")
      : (r.firstError ?? "no message");

  if (r.error) {
    return { ok: false, message: `${entries} mirrored. ${r.error}` };
  }

  if (r.ticketsScanned === 0) {
    return {
      ok: false,
      message: "No SuperOps tickets are mirrored yet — run the ticket sync first.",
    };
  }

  // Every call failed: the query exists but we are calling it wrongly.
  if (failed > 0 && r.notes === 0) {
    return {
      ok: false,
      message:
        `Nothing mirrored: all ${failed} conversation call(s) failed` +
        (r.queryUsed ? ` (${r.queryUsed}` : "") +
        (r.argUsed ? ` called with ${r.argUsed})` : r.queryUsed ? ")" : "") +
        `. SuperOps said: ${why}. ` +
        `The ticket history is still in SuperOps — do not cut over.`,
    };
  }

  if (r.notes === 0 && r.queryUsed === null) {
    return {
      ok: false,
      message:
        `Scanned ${r.ticketsScanned} ticket(s): no conversations are embedded in the synced ` +
        `data, and this tenant exposes no conversation query Wolf365 recognises. The history ` +
        `is not reachable through the API as configured — do not cut over.`,
    };
  }

  if (r.notes === 0 && unparsed > 0) {
    return {
      ok: false,
      message:
        `Nothing mirrored: ${r.queryUsed} returned ${unparsed} record(s), none of which had a ` +
        `readable body or author. The shape needs mapping — do not cut over.`,
    };
  }

  if (r.notes === 0) {
    return {
      ok: false,
      message:
        `Scanned ${r.ticketsScanned} ticket(s) via ${r.queryUsed} and every one answered with ` +
        `no conversation. That may be true, but confirm a ticket you know has replies before ` +
        `trusting it.`,
    };
  }

  // Something came across. Say what, and what did not.
  const parts = [`${entries} mirrored from ${r.ticketsScanned} ticket(s)`];
  if (r.fromEmbedded > 0) {
    parts.push(`${r.fromEmbedded} already embedded in the synced ticket data`);
  }
  if (r.queryUsed) parts.push(`the rest via ${r.queryUsed}`);
  const lost: string[] = [];
  if (failed > 0) lost.push(`${failed} ticket(s) failed: ${why}`);
  if (unparsed > 0) lost.push(`${unparsed} record(s) were unreadable`);

  return {
    ok: lost.length === 0,
    message:
      parts.join(", ") +
      "." +
      (lost.length > 0 ? ` Incomplete — ${lost.join("; ")}.` : " Import them below."),
  };
}
