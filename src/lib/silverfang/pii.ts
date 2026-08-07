import { blindIndex, decryptField, encryptField } from "@/lib/crypto";
import { addressDomain, normalizeAddress } from "@/lib/silverfang/email";

/**
 * Reading and writing the encrypted personal-data columns.
 *
 * Every site that touches SfContact detail or ticket free text goes through here,
 * so the three things that must happen together on a write — encrypt the value,
 * recompute the blind index, recompute the domain — cannot be done two out of
 * three. Getting that wrong does not throw; it silently stops inbound email
 * finding the contact, which is the worst kind of bug to ship.
 *
 * Reads are tolerant of plaintext (see `decryptField`), so these work before the
 * backfill has run and during it.
 */

/** The contact detail fields that are encrypted at rest. */
export interface ContactSecrets {
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
}

/**
 * Turn plaintext contact detail into the columns to store: ciphertext plus the
 * two derived lookup columns.
 *
 * The index and domain are derived from the NORMALIZED address, matching what
 * `resolveSender` will look up — normalizing on one side only would mean a
 * contact entered as "Alex@Acme.com " could never be found.
 */
export function contactWrite(input: ContactSecrets): {
  email: string | null;
  phone: string | null;
  mobile: string | null;
  emailIndex: string | null;
  emailDomain: string | null;
} {
  return {
    email: encryptField(input.email ?? null),
    phone: encryptField(input.phone ?? null),
    mobile: encryptField(input.mobile ?? null),
    ...contactEmailLookup(input.email ?? null),
  };
}

/**
 * The lookup columns derived from a contact's address.
 *
 * Its own export because key rotation has to rebuild these from the decrypted
 * plaintext, and deriving them a second way there is how the index and the
 * lookup drift apart.
 */
export function contactEmailLookup(email: string | null | undefined): {
  emailIndex: string | null;
  emailDomain: string | null;
} {
  const normalized = normalizeAddress(email ?? null);
  return {
    // Null rather than an index of "" when there is no address, so a contact
    // without an email cannot collide with another one.
    emailIndex: normalized ? blindIndex(normalized) : null,
    emailDomain: normalized ? addressDomain(normalized) : null,
  };
}

/** The lookup value for finding a contact by address. */
export function contactEmailIndex(email: string | null | undefined): string | null {
  const normalized = normalizeAddress(email ?? null);
  return normalized ? blindIndex(normalized) : null;
}

/**
 * Decrypt a contact row's detail in place of the stored ciphertext. Generic over
 * the row so callers keep their own selected fields.
 */
export function contactRead<T extends ContactSecrets>(
  row: T,
): T & { email: string | null; phone: string | null; mobile: string | null } {
  return {
    ...row,
    email: decryptField(row.email),
    phone: decryptField(row.phone),
    mobile: decryptField(row.mobile),
  };
}

/** Encrypt one free-text field (ticket description, note body, message body). */
export function textWrite(value: string | null | undefined): string | null {
  return encryptField(value ?? null);
}

/** Decrypt one free-text field, tolerating plaintext. */
export function textRead(value: string | null | undefined): string | null {
  return decryptField(value);
}
