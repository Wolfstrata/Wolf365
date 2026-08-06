/**
 * Field-level change detection for the SilverFang audit trail. Pure: no Prisma,
 * no clock, no I/O — the write is done by the caller.
 *
 * The trail is only worth having if it is accurate, so the awkward cases are
 * handled deliberately rather than by whatever `!==` happens to do:
 *  - null, undefined and "" all mean "not set", so moving between them is not a
 *    change and must not create a row that says nothing happened;
 *  - Dates compare by instant, not identity;
 *  - Decimals arrive as objects or strings and must compare by value;
 *  - only the fields the caller names are examined, so internal bookkeeping
 *    (updatedAt, cached counters) never pollutes the history.
 */

export interface FieldChange {
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

/** Normalize any stored value to the string the trail records, or null. */
export function normalizeValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value === "object") {
    // Prisma Decimal and similar wrappers expose a faithful toString().
    const asString = String(value);
    return asString === "[object Object]" ? JSON.stringify(value) : asString;
  }
  const text = String(value);
  // Empty string is "not set", the same as null — otherwise clearing a field
  // records "" and setting it back records null, both of which read as noise.
  return text.trim() === "" ? null : text;
}

/**
 * Compare two versions of a record across the named fields. Returns one entry per
 * field that genuinely changed, in the order given.
 */
export function diffFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown>,
  fields: string[],
): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const field of fields) {
    const oldValue = normalizeValue(before ? before[field] : null);
    const newValue = normalizeValue(after[field]);
    if (oldValue === newValue) continue;
    changes.push({ field, oldValue, newValue });
  }
  return changes;
}

/** Field names that should never reach the trail. */
const NEVER_AUDIT = new Set(["id", "createdAt", "updatedAt", "locallyModifiedAt"]);

/**
 * Fields worth auditing on a record: everything present except bookkeeping. Used
 * when a caller wants "all of it" without listing columns that will drift.
 */
export function auditableFields(after: Record<string, unknown>): string[] {
  return Object.keys(after).filter((k) => !NEVER_AUDIT.has(k));
}

/** Human-readable summary for an action result, e.g. "email, title and 2 more". */
export function describeChanges(changes: FieldChange[]): string {
  if (changes.length === 0) return "no changes";
  const names = changes.map((c) => c.field);
  if (names.length <= 3) {
    return names.length === 1
      ? names[0]!
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  }
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}
