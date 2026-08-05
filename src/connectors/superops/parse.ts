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
  const hrs = pickNum(obj, ["hours", "billableHours"]);
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
  const address = isObj(raw.address) ? raw.address : null;
  return {
    superOpsId,
    name: pick(raw, ["name", "siteName"]),
    timezone: pick(raw, ["timezone", "timeZone"]),
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
  const superOpsId = pick(raw, ["worklogId", "id", "entryId"]);
  if (!superOpsId) return null;
  const ticketId = isObj(raw.ticket)
    ? pick(raw.ticket, ["ticketId", "id"])
    : pick(raw, ["ticketId"]);
  return {
    superOpsId,
    ticketId,
    accountId: pickAccountId(raw),
    technician: pickName(raw, ["technician", "user", "addedBy", "createdBy"]),
    minutes: pickMinutes(raw),
    billable: pickBool(raw, ["billable", "isBillable"]),
    notes: pick(raw, ["notes", "description", "comment", "remarks"]),
    entryTime: pickDate(raw, ["entryTime", "createdTime", "date", "loggedTime", "startTime"]),
  };
}
