/**
 * Contact name handling for SilverFang.
 *
 * Source systems (SuperOps among them) store a single full-name string, while
 * `SfContact` needs a required `firstName` plus an optional `lastName`. Splitting
 * is pure and unit-tested so an import can't silently write blank contacts.
 */

export interface SplitName {
  firstName: string;
  lastName: string | null;
}

/**
 * Split a full name into first + last. The last whitespace-separated token
 * becomes the surname, so middle names stay with the first name ("Mary Jane
 * Watson" → "Mary Jane" / "Watson"). Returns null when there's no usable name,
 * so callers skip the record rather than create an empty contact.
 */
export function splitName(full: string | null | undefined): SplitName | null {
  if (!full) return null;
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return { firstName: parts[0]!, lastName: null };
  const lastName = parts[parts.length - 1]!;
  const firstName = parts.slice(0, -1).join(" ");
  return { firstName, lastName };
}

/**
 * What an import should do with a contact it has a source record for.
 *
 * `preserve` is the important case: once someone corrects a contact by hand in
 * Wolf365, a later import must not revert it. SilverFang is replacing SuperOps,
 * so the local record wins — but the skip is counted and reported rather than
 * silently passed over.
 */
export type ImportDecision = "create" | "update" | "preserve";

export function contactImportDecision(
  existing: { locallyModifiedAt?: Date | null } | null | undefined,
): ImportDecision {
  if (!existing) return "create";
  return existing.locallyModifiedAt ? "preserve" : "update";
}

/**
 * A display name for a contact, tolerant of a missing surname. Falls back to the
 * email local part and finally a placeholder, so lists never render blanks.
 */
export function contactDisplayName(contact: {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}): string {
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim();
  if (name) return name;
  if (contact.email) return contact.email.split("@")[0] ?? contact.email;
  return "Unnamed contact";
}

/**
 * A usable name for someone we only know by email address.
 *
 * Used when auto-creating a contact from inbound mail: "sam.jones@acme.com"
 * becomes "Sam Jones". Separators become spaces and each word is capitalised,
 * which is wrong often enough (initials, "info", "j.smith") that the result should
 * be treated as a starting point a human will correct — but a name is far more
 * useful on a ticket than a bare address, and the address is stored either way.
 *
 * Returns null when there is nothing to work with, so the caller can fall back
 * rather than creating a blank contact.
 */
export function nameFromAddress(email: string | null | undefined): SplitName | null {
  if (!email) return null;
  const local = email.split("@")[0];
  if (!local) return null;
  const cleaned = local.replace(/[._+-]+/g, " ").trim();
  if (!cleaned) return null;
  // Digits-only local parts ("12345@") produce no useful name at all.
  if (!/[a-z]/i.test(cleaned)) return null;
  const titled = cleaned
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return splitName(titled);
}
