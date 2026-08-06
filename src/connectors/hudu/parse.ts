/**
 * Pure parsers for Hudu API records — no I/O, so the shape-handling and, above
 * all, the redaction rules are unit-testable.
 *
 * Hudu is a credential vault as well as a documentation system. The single most
 * important thing in this file is `isSecretField`: anything it flags never
 * reaches the database. It errs deliberately towards withholding, because a
 * false positive costs a field nobody sees in SilverFang while a false negative
 * copies a live credential into a second system.
 */

export type Obj = Record<string, unknown>;

export function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t === "" ? null : t;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function bool(v: unknown): boolean {
  return v === true || v === "true";
}

function date(v: unknown): Date | null {
  const s = typeof v === "string" ? v : null;
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** First non-null value among the given keys. */
function pick(raw: Obj, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = str(raw[k]);
    if (v !== null) return v;
  }
  return null;
}

/**
 * Field labels that indicate a secret. Matched case-insensitively as substrings,
 * because layouts are named by hand ("Admin Password", "API token (prod)").
 */
const SECRET_LABEL_PATTERNS = [
  "password",
  "passwd",
  "passphrase",
  "secret",
  "credential",
  "api key",
  "apikey",
  "api-key",
  "token",
  "private key",
  "licence key",
  "license key",
  "product key",
  "recovery key",
  "bitlocker",
  "seed",
  "otp",
  "mfa",
  "2fa",
  "pin",
  "cvv",
  "ssn",
  "sin ",
  "bank account",
  "routing number",
  "iban",
];

/** Hudu field types that are confidential by definition. */
const SECRET_FIELD_TYPES = new Set([
  "password",
  "confidential",
  "confidentialtext",
  "confidential_text",
  "embedpassword",
  "embed_password",
  "assetpassword",
  "asset_password",
]);

/**
 * Whether an asset field must be withheld. True when Hudu says the field type is
 * confidential, when the record carries any confidentiality flag, or when the
 * label reads like a secret.
 */
export function isSecretField(field: Obj): boolean {
  const type = (str(field.field_type) ?? str(field.type) ?? "")
    .toLowerCase()
    .replace(/\s+/g, "");
  if (SECRET_FIELD_TYPES.has(type)) return true;
  if (bool(field.confidential) || bool(field.is_confidential)) return true;
  if (bool(field.hint_secret) || bool(field.secret)) return true;

  const label = (pick(field, "label", "name") ?? "").toLowerCase();
  if (label === "") return false;
  return SECRET_LABEL_PATTERNS.some((p) => label.includes(p));
}

export interface SafeField {
  label: string;
  value: string;
}

/**
 * Split an asset's custom fields into what may be stored and a count of what was
 * withheld. The count is kept so the UI can say "3 fields withheld" rather than
 * implying Hudu held nothing else.
 */
export function safeFields(raw: Obj): { fields: SafeField[]; redacted: number } {
  const source = Array.isArray(raw.fields)
    ? raw.fields
    : Array.isArray(raw.custom_fields)
      ? raw.custom_fields
      : [];
  const fields: SafeField[] = [];
  let redacted = 0;

  for (const entry of source) {
    if (!isObj(entry)) continue;
    if (isSecretField(entry)) {
      redacted += 1;
      continue;
    }
    const label = pick(entry, "label", "name");
    const value = pick(entry, "value", "content");
    if (!label || !value) continue;
    // Long values are documentation bodies, not facts worth mirroring; and the
    // longer the text the likelier it embeds something confidential.
    if (value.length > 500) {
      redacted += 1;
      continue;
    }
    fields.push({ label, value });
  }
  return { fields, redacted };
}

export interface ParsedCompany {
  huduId: string;
  name: string;
  nickname: string | null;
  companyType: string | null
  address: string | null;
  phone: string | null;
  website: string | null;
  idNumber: string | null;
  huduUrl: string | null;
  archived: boolean;
}

/** Join the address parts Hudu keeps in separate columns into one line. */
export function joinAddress(raw: Obj): string | null {
  const parts = [
    pick(raw, "address_line_1"),
    pick(raw, "address_line_2"),
    pick(raw, "city"),
    pick(raw, "state"),
    pick(raw, "zip"),
    pick(raw, "country_name", "country"),
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * Build the deep link into Hudu. Hudu returns a `url` on most records; when it
 * does not, a path is constructed from the base URL. Returns null rather than a
 * guess when there is no id to build from.
 */
export function huduLink(raw: Obj, base: string, path: string): string | null {
  const given = pick(raw, "url");
  if (given) return given;
  const id = pick(raw, "id");
  if (!id || !base) return null;
  return `${base.replace(/\/$/, "")}/${path}/${id}`;
}

export function parseCompany(raw: Obj, base: string): ParsedCompany | null {
  const huduId = pick(raw, "id");
  const name = pick(raw, "name");
  if (!huduId || !name) return null;
  return {
    huduId,
    name,
    nickname: pick(raw, "nickname"),
    companyType: pick(raw, "company_type"),
    address: joinAddress(raw),
    phone: pick(raw, "phone_number", "phone"),
    website: pick(raw, "website"),
    idNumber: pick(raw, "id_number"),
    huduUrl: huduLink(raw, base, "c"),
    archived: bool(raw.archived),
  };
}

export interface ParsedAsset {
  huduId: string;
  companyHuduId: string;
  name: string;
  assetLayout: string | null;
  serial: string | null;
  model: string | null;
  manufacturer: string | null;
  primaryMail: string | null;
  huduUrl: string | null;
  archived: boolean;
  fields: SafeField[];
  redactedFieldCount: number;
  huduUpdatedAt: Date | null;
}

export function parseAsset(raw: Obj, base: string): ParsedAsset | null {
  const huduId = pick(raw, "id");
  const companyHuduId = pick(raw, "company_id");
  const name = pick(raw, "name");
  // An asset with no company cannot be shown against a client, which is the
  // whole point of the sync — skipped and counted rather than stored loose.
  if (!huduId || !companyHuduId || !name) return null;

  const { fields, redacted } = safeFields(raw);
  return {
    huduId,
    companyHuduId,
    name,
    assetLayout: pick(raw, "asset_type", "asset_layout_name"),
    serial: pick(raw, "primary_serial"),
    model: pick(raw, "primary_model"),
    manufacturer: pick(raw, "primary_manufacturer"),
    primaryMail: pick(raw, "primary_mail"),
    huduUrl: huduLink(raw, base, "a"),
    archived: bool(raw.archived),
    fields,
    redactedFieldCount: redacted,
    huduUpdatedAt: date(raw.updated_at),
  };
}

export interface ParsedArticle {
  huduId: string;
  companyHuduId: string | null;
  name: string;
  folder: string | null;
  huduUrl: string | null;
  global: boolean;
  archived: boolean;
  huduUpdatedAt: Date | null;
}

export function parseArticle(raw: Obj, base: string): ParsedArticle | null {
  const huduId = pick(raw, "id");
  const name = pick(raw, "name");
  if (!huduId || !name) return null;
  const companyHuduId = pick(raw, "company_id");
  return {
    huduId,
    companyHuduId,
    name,
    folder: pick(raw, "folder_name"),
    huduUrl: huduLink(raw, base, "kba"),
    global: companyHuduId === null,
    archived: bool(raw.archived),
    huduUpdatedAt: date(raw.updated_at),
  };
}
