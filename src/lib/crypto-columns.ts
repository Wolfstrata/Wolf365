import { contactEmailLookup } from "@/lib/silverfang/pii";

/**
 * The declaration of which database columns hold app-encrypted data.
 *
 * Kept apart from the rotation machinery so it is plain data with no database
 * connection behind it, and can therefore be checked against the real Prisma
 * schema in a unit test. A typo here does not fail to compile — the rotation
 * addresses models by name — so it would otherwise only surface in production, as
 * a column silently left behind on an old key.
 */

export interface EncryptedColumn {
  /** Prisma model delegate name (camelCase), which is also what the report shows. */
  model: string;
  column: string;
  /**
   * Lookup columns computed from the plaintext, rebuilt on every rotation. A
   * blind index is an HMAC under the data key, so changing the key changes every
   * index; a rotation that skipped this would leave equality lookups silently
   * matching nothing. It delegates to the same helper the write path uses —
   * deriving the index a second way here is exactly how the two drift apart.
   */
  derived?: (plain: string) => Record<string, unknown>;
}

export const ENCRYPTED_COLUMNS: EncryptedColumn[] = [
  // Connector secret bags: TD SYNNEX, QBO (including OAuth tokens), Hudu,
  // SuperOps, Salesforce.
  { model: "connector", column: "secretsEnc" },
  // Entra SSO client secret.
  { model: "ssoSettings", column: "clientSecretEnc" },
  // Personal data. The read paths decrypt these (src/lib/silverfang/pii.ts) and
  // tolerate plaintext, so a column can be listed here before its data is
  // converted — the first rotation pass is what converts it.
  //
  // The contact address carries `derived` because inbound mail finds its contact
  // by `emailIndex`; a rotation that left the index behind would silently stop
  // matching senders.
  { model: "sfContact", column: "email", derived: contactEmailLookup },
  { model: "sfContact", column: "phone" },
  { model: "sfContact", column: "mobile" },
  { model: "sfTicket", column: "description" },
  { model: "sfTicketNote", column: "body" },
  { model: "sfTicketMessage", column: "fromAddress" },
  { model: "sfTicketMessage", column: "bodyText" },
  { model: "sfTicketMessage", column: "bodyHtml" },
  // The sender on an inbound-mail decision. Same data as a ticket message's
  // from-address, so it gets the same treatment.
  { model: "sfMailEvent", column: "fromAddress" },
];
