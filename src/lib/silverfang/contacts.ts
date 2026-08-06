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
