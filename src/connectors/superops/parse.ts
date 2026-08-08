/**
 * Pure, dependency-free parsing for SuperOps GraphQL records.
 *
 * SuperOps' GraphQL schema varies slightly by tenant, so every field is read
 * defensively across common aliases and the full source object is always kept
 * as `raw`. These functions do no I/O (no network, no Prisma) so they are unit
 * tested directly, following the pure-parser rule used elsewhere in the app.
 */

export type Obj = Record<string, unknown>;

export const isObj = (v: unknown): v is Obj =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** First array-of-objects found in a GraphQL result (top level or one deep). */
export function firstObjectArray(obj: unknown): Obj[] | null {
  if (!isObj(obj)) return null;
  for (const v of Object.values(obj)) {
    if (Array.isArray(v) && v.length > 0 && isObj(v[0])) return v as Obj[];
  }
  for (const v of Object.values(obj)) {
    const nested = firstObjectArray(v);
    if (nested) return nested;
  }
  return null;
}

/** First non-empty string/number among keys, coerced to string. */
export function pick(obj: Obj, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v;
    if (typeof v === "number") return String(v);
  }
  return null;
}

export function pickNum(obj: Obj, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number") return v;
    if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  }
  return null;
}

export function pickBool(obj: Obj, keys: string[]): boolean | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "boolean") return v;
    if (v === "true") return true;
    if (v === "false") return false;
  }
  return null;
}

export function pickDate(obj: Obj, keys: string[]): Date | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return d;
    }
    // Epoch millis or seconds.
    if (typeof v === "number" && v > 0) {
      const ms = v < 1e12 ? v * 1000 : v;
      const d = new Date(ms);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return null;
}

/**
 * Read a display name from a field that may be a plain string or a nested
 * object (e.g. `technician { name }`, `accountManager { name email }`).
 */
export function pickName(obj: Obj, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v;
    if (isObj(v)) {
      const n = pick(v, ["name", "displayName", "fullName", "label", "email"]);
      if (n) return n;
    }
  }
  return null;
}

/** The SuperOps account id a child record belongs to (string), from common shapes. */
export function pickAccountId(obj: Obj): string | null {
  if (isObj(obj.client)) {
    const id = pick(obj.client, ["accountId", "id"]);
    if (id) return id;
  }
  return pick(obj, ["accountId", "clientId", "clientAccountId"]);
}

/** Worklog duration in minutes, from minutes/seconds/hours aliases. */
export function pickMinutes(obj: Obj): number | null {
  const mins = pickNum(obj, ["totalTimeInMinutes", "timeSpentMinutes", "durationMinutes", "minutes"]);
  if (mins != null) return Math.round(mins);
  const secs = pickNum(obj, ["timeSpent", "timespent", "durationSeconds", "seconds"]);
  if (secs != null) return Math.round(secs / 60);
  const hrs = pickNum(obj, ["hours", "billableHours", "qty", "quantity"]);
  if (hrs != null) return Math.round(hrs * 60);
  return null;
}

// --- Normalized record shapes (no Prisma types; sync.ts maps these to rows). --

export interface ParsedClient {
  superOpsId: string;
  name: string;
  stage: string | null;
  status: string | null;
  accountManager: string | null;
  emailDomains: string[];
}
export interface ParsedSite {
  superOpsId: string;
  name: string | null;
  timezone: string | null;
  address: Obj | null;
}
export interface ParsedContact {
  superOpsId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
}
export interface ParsedAsset {
  superOpsId: string;
  name: string | null;
  serialNumber: string | null;
  platform: string | null;
  status: string | null;
  lastCommunicatedTime: Date | null;
}
export interface ParsedContract {
  superOpsId: string;
  name: string | null;
  status: string | null;
  startDate: Date | null;
  endDate: Date | null;
}
export interface ParsedTicket {
  superOpsId: string;
  accountId: string | null;
  displayId: string | null;
  subject: string | null;
  status: string | null;
  priority: string | null;
  technician: string | null;
  createdTime: Date | null;
  updatedTime: Date | null;
}
export interface ParsedWorklog {
  superOpsId: string;
  ticketId: string | null;
  accountId: string | null;
  technician: string | null;
  minutes: number | null;
  billable: boolean | null;
  notes: string | null;
  entryTime: Date | null;
}

export function parseClient(raw: Obj): ParsedClient | null {
  const superOpsId = pick(raw, ["accountId", "id", "clientId"]);
  if (!superOpsId) return null;
  const domainsRaw = raw.emailDomains ?? raw.domains;
  const emailDomains = Array.isArray(domainsRaw)
    ? domainsRaw.filter((d): d is string => typeof d === "string" && d.trim().length > 0)
    : typeof domainsRaw === "string" && domainsRaw.trim()
      ? domainsRaw.split(/[,;\s]+/).filter(Boolean)
      : [];
  return {
    superOpsId,
    name: pick(raw, ["name", "companyName", "displayName"]) ?? `Client ${superOpsId}`,
    stage: pick(raw, ["stage", "clientStage"]),
    status: pick(raw, ["status", "clientStatus", "state"]),
    accountManager: pickName(raw, ["accountManager", "primaryManager", "owner"]),
    emailDomains,
  };
}

export function parseSite(raw: Obj): ParsedSite | null {
  const superOpsId = pick(raw, ["id", "siteId"]);
  if (!superOpsId) return null;
  // Address arrives as flat fields (line1..line3/city/stateCode/countryCode/postalCode).
  let address: Obj | null = isObj(raw.address) ? raw.address : null;
  if (!address) {
    const flat: Obj = {};
    for (const [k, aliases] of [
      ["line1", ["line1", "addressLine1"]],
      ["line2", ["line2", "addressLine2"]],
      ["line3", ["line3"]],
      ["city", ["city"]],
      ["state", ["stateCode", "state"]],
      ["country", ["countryCode", "country"]],
      ["postalCode", ["postalCode", "zip", "zipCode"]],
    ] as [string, string[]][]) {
      const v = pick(raw, aliases);
      if (v) flat[k] = v;
    }
    if (Object.keys(flat).length > 0) address = flat;
  }
  return {
    superOpsId,
    name: pick(raw, ["name", "siteName"]),
    timezone: pick(raw, ["timezoneCode", "timezone", "timeZone"]),
    address,
  };
}

export function parseContact(raw: Obj): ParsedContact | null {
  const superOpsId = pick(raw, ["userId", "id", "contactId"]);
  if (!superOpsId) return null;
  return {
    superOpsId,
    name: pickName(raw, ["name", "fullName"]) ?? pick(raw, ["firstName"]),
    email: pick(raw, ["email", "emailId", "primaryEmail"]),
    phone: pick(raw, ["contactNumber", "phone", "mobile", "phoneNumber"]),
    role: pickName(raw, ["role", "designation", "title"]),
  };
}

export function parseAsset(raw: Obj): ParsedAsset | null {
  const superOpsId = pick(raw, ["assetId", "id"]);
  if (!superOpsId) return null;
  return {
    superOpsId,
    name: pick(raw, ["name", "hostName", "assetName"]),
    serialNumber: pick(raw, ["serialNumber", "serial", "serialNo"]),
    platform: pick(raw, ["platform", "os", "operatingSystem", "platformType"]),
    status: pick(raw, ["status", "state"]),
    lastCommunicatedTime: pickDate(raw, ["lastCommunicatedTime", "lastSeen", "lastOnline"]),
  };
}

export function parseContract(raw: Obj): ParsedContract | null {
  const superOpsId = pick(raw, ["contractId", "id"]);
  if (!superOpsId) return null;
  return {
    superOpsId,
    name: pickName(raw, ["name", "contractName", "displayName", "contract"]),
    status: pick(raw, ["contractStatus", "status", "state"]),
    startDate: pickDate(raw, ["startDate", "effectiveDate", "fromDate"]),
    endDate: pickDate(raw, ["endDate", "expiryDate", "toDate"]),
  };
}

export function parseTicket(raw: Obj): ParsedTicket | null {
  const superOpsId = pick(raw, ["ticketId", "id"]);
  if (!superOpsId) return null;
  return {
    superOpsId,
    accountId: pickAccountId(raw),
    displayId: pick(raw, ["displayId", "ticketNumber", "number"]),
    subject: pick(raw, ["subject", "title", "summary"]),
    status: pickName(raw, ["status", "statusEnum", "state"]),
    priority: pickName(raw, ["priority", "priorityEnum"]),
    technician: pickName(raw, ["technician", "assignee", "assignedTo", "owner"]),
    createdTime: pickDate(raw, ["createdTime", "createdAt", "creationTime", "createdDate"]),
    updatedTime: pickDate(raw, ["updatedTime", "updatedAt", "lastModifiedTime", "modifiedTime"]),
  };
}

export function parseWorklog(raw: Obj): ParsedWorklog | null {
  const superOpsId = pick(raw, ["worklogId", "itemId", "id", "entryId"]);
  if (!superOpsId) return null;
  const ticketId = isObj(raw.ticket)
    ? pick(raw.ticket, ["ticketId", "id"])
    : isObj(raw.workItem)
      ? pick(raw.workItem, ["ticketId", "id", "itemId"])
      : pick(raw, ["ticketId", "workItem"]);
  return {
    superOpsId,
    ticketId,
    accountId: pickAccountId(raw),
    technician: pickName(raw, ["technician", "user", "addedBy", "createdBy"]),
    minutes: pickMinutes(raw),
    billable: pickBool(raw, ["billable", "isBillable"]),
    notes: pick(raw, ["notes", "description", "comment", "remarks"]),
    entryTime: pickDate(raw, ["billDateTime", "entryTime", "createdTime", "date", "loggedTime", "startTime"]),
  };
}

/**
 * Which argument of a conversation query takes the ticket id.
 *
 * A schema-discovered query name says nothing about how it wants to be called.
 * `getTicketConversation(ticketId: ID!)` was an assumption, and against a tenant
 * that names the argument something else it fails on every ticket — which a loop
 * that skips failures reports as "no conversations found". So the argument is
 * chosen from what the schema actually declares.
 *
 * Preference order: a name that mentions the ticket explicitly, then a bare id,
 * then the sole required argument whatever it is called. Anything ambiguous
 * returns null so the caller can say it could not work out how to call the query,
 * rather than guessing and reporting the failure as an empty history.
 */
export function pickTicketIdArg<T extends { name: string; required: boolean }>(
  args: T[],
): T | null {
  if (args.length === 0) return null;
  const named = (re: RegExp) => args.filter((a) => re.test(a.name));

  // "ticketId", "ticket_id", "ticketDisplayId" — unambiguous when there is one.
  const ticketish = named(/ticket/i);
  if (ticketish.length === 1) return ticketish[0]!;
  if (ticketish.length > 1) {
    // Prefer the plain id over a display/reference variant: the stored SuperOps
    // id is what we hold, and a display id we do not have would fetch nothing.
    const plain = ticketish.filter((a) => /^ticket_?id$/i.test(a.name));
    if (plain.length === 1) return plain[0]!;
    return null;
  }

  const idish = named(/^id$/i);
  if (idish.length === 1) return idish[0]!;

  const required = args.filter((a) => a.required);
  return required.length === 1 ? required[0]! : null;
}

/**
 * Plausible ticket-id fields inside an input object, best first.
 *
 * Separate from `pickTicketIdArg` because the situations differ. An argument
 * list can be reasoned about — one required argument is the one you must fill.
 * An input object's fields carry no such signal, and a tenant that answers a
 * wrong shape with a bare "Internal Server Error" tells you nothing about which
 * field it wanted. So this returns an ordered shortlist for the caller to probe
 * against one real ticket, rather than a single answer to commit to blindly.
 *
 * Ordered: names mentioning the ticket, then bare ids, then anything else
 * id-shaped. A single-field input object is unambiguous whatever it is called.
 */
export function ticketIdCandidates<T extends { name: string }>(fields: T[]): T[] {
  if (fields.length === 1) return [fields[0]!];
  const seen = new Set<string>();
  const out: T[] = [];
  const take = (matches: T[]) => {
    for (const f of matches) {
      if (seen.has(f.name)) continue;
      seen.add(f.name);
      out.push(f);
    }
  };
  // A display/reference id is tried last within its group: we hold the SuperOps
  // id, so a display id would fetch nothing and read as an empty history.
  const rank = (f: T) => (/display|reference|number/i.test(f.name) ? 1 : 0);
  const byRank = (a: T, b: T) => rank(a) - rank(b);

  take(fields.filter((f) => /ticket/i.test(f.name)).sort(byRank));
  take(fields.filter((f) => /^id$/i.test(f.name)));
  take(fields.filter((f) => /id$/i.test(f.name)).sort(byRank));
  return out;
}

/**
 * Candidate conversation-query names for a tenant, best first.
 *
 * Two sources: the names we know SuperOps has used, and anything in this
 * tenant's own schema that looks conversation-shaped. The second matters because
 * a hardcoded list is a guess about someone else's API — a tenant exposing
 * `getTicketConversationList` under a name we never thought of would otherwise
 * be invisible.
 *
 * Ordering here is only by name. Whether a query can actually be called with a
 * ticket id is decided by introspecting its arguments, which is what stops the
 * caller settling on a query that fetches one conversation by conversation id.
 */
export function conversationQueryCandidates(
  available: string[],
  preferred: string[],
): string[] {
  const have = new Set(available);
  const out = preferred.filter((n) => have.has(n));
  const seen = new Set(out);
  // A list query is more likely to take a ticket id than a singular one, so it
  // comes first among the discovered names.
  const discovered = available
    .filter(
      (n) =>
        /^get/i.test(n) && /conversation|note|comment|repl(y|ies)|message/i.test(n) && !seen.has(n),
    )
    .sort((a, b) => Number(/list$/i.test(b)) - Number(/list$/i.test(a)) || a.localeCompare(b));
  return [...out, ...discovered];
}

/**
 * Turn a GraphQL `errors` array into something a human can act on.
 *
 * Written the naive way, this said "null": SuperOps returns error objects whose
 * `message` is null, `String(null)` is the four characters n-u-l-l, and a filter
 * on truthiness keeps them. An error report that invents a message is worse than
 * one that admits it has none — 145 failed tickets reading "failed: null" tells
 * you nothing about why.
 *
 * So a message is used only when it is a non-empty string. Failing that, the
 * fields GraphQL implementations conventionally carry the reason in are tried in
 * turn, and failing those the error object itself is summarised. Output is
 * capped: this lands in a debug log, not a crash report.
 */
export function describeGraphQLErrors(errors: unknown): string {
  if (!Array.isArray(errors)) return "";
  const described = errors.map(describeOneError).filter(Boolean);
  return described.slice(0, 3).join("; ");
}

const ERROR_DETAIL_KEYS = ["errorType", "code", "classification", "reason", "detail", "description"];

function describeOneError(e: unknown): string {
  if (typeof e === "string") return e.trim();
  if (!e || typeof e !== "object") return "";
  const obj = e as Record<string, unknown>;

  const message = obj.message;
  if (typeof message === "string" && message.trim()) return message.trim();

  // No message: fall back to the conventional detail fields, at the top level
  // and under `extensions`, which is where spec-compliant servers put them.
  const extensions =
    obj.extensions && typeof obj.extensions === "object"
      ? (obj.extensions as Record<string, unknown>)
      : {};
  const parts: string[] = [];
  for (const key of ERROR_DETAIL_KEYS) {
    for (const source of [obj, extensions]) {
      const v = source[key];
      if (typeof v === "string" && v.trim()) parts.push(`${key}=${v.trim()}`);
      else if (typeof v === "number" || typeof v === "boolean") parts.push(`${key}=${v}`);
    }
  }
  // `path` names the field that failed, which is often the whole diagnosis.
  if (Array.isArray(obj.path) && obj.path.length > 0) {
    parts.push(`path=${obj.path.map(String).join(".")}`);
  }
  if (parts.length > 0) return parts.slice(0, 4).join(" ");

  // Nothing recognisable: show the shape rather than claim there was a message.
  try {
    const json = JSON.stringify(obj);
    if (!json || json === "{}") return "empty error object";
    return `unlabelled error ${json.slice(0, 200)}`;
  } catch {
    return "unserialisable error object";
  }
}
