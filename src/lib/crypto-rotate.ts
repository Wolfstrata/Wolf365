import "server-only";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import {
  blindIndex,
  ciphertextKeyId,
  decryptField,
  encryptField,
  isCiphertext,
  primaryKeyId,
} from "@/lib/crypto";

/**
 * Re-encrypting stored values under a new key.
 *
 * The rotation procedure this supports:
 *
 *   1. Generate a new 32-byte key.
 *   2. Move the current WOLF365_ENCRYPTION_KEY into WOLF365_ENCRYPTION_KEYS_OLD
 *      and set the new one as WOLF365_ENCRYPTION_KEY. Deploy. Everything still
 *      decrypts — old values open with the retired key, new writes use the new
 *      one — so there is no flag day and no downtime.
 *   3. Run the rotation from Administration → Security & SSO until it reports
 *      nothing outstanding.
 *   4. Remove WOLF365_ENCRYPTION_KEYS_OLD and deploy. The old key is now unused.
 *
 * Skipping step 3 is the trap: the app would keep working indefinitely on the
 * retired key, and dropping it later would make those values unreadable. The
 * status readout exists so "are we done?" has an answer rather than a hope.
 *
 * Rotation is resumable and idempotent — a value already under the primary key is
 * skipped — so it can be run repeatedly and interrupted safely.
 */

/**
 * Every column holding app-encrypted data. Adding an encrypted column means
 * adding it here, or rotation will silently leave it behind on the old key.
 *
 * `reindex` names a blind-index column recomputed from the plaintext during
 * rotation: the index is derived from the data key, so rotating the key changes
 * every index and they must be rebuilt in the same pass or equality lookups stop
 * matching.
 */
interface EncryptedColumn {
  /** Prisma model delegate name, for the report. */
  model: string;
  column: string;
  reindex?: { column: string; domain?: string };
}

const REGISTRY: EncryptedColumn[] = [
  // Connector secret bags: TD SYNNEX, QBO (including OAuth tokens), Hudu,
  // SuperOps, Salesforce.
  { model: "connector", column: "secretsEnc" },
  // Entra SSO client secret.
  { model: "ssoSettings", column: "clientSecretEnc" },
  // NOT YET LISTED — the personal-data columns.
  //
  // SfContact.email/phone/mobile, SfTicket.description, SfTicketNote.body and
  // SfTicketMessage.fromAddress/bodyText/bodyHtml have their schema, their
  // lookup columns (emailIndex, emailDomain) and their crypto helpers in place,
  // but the read paths do not decrypt yet. Listing them here now would be
  // actively harmful: the backfill would encrypt values the UI still reads
  // literally, and every contact email and ticket body would render as
  // "v2:a1b2c3d4:…". They go in the same change that wires the call sites.
];

export interface ColumnStatus {
  model: string;
  column: string;
  /** Rows holding a non-null value. */
  total: number;
  /** Already under the primary key. */
  current: number;
  /** Under a retired key, or a legacy v1 envelope with no key id. */
  outstanding: number;
  /** Still plaintext — never encrypted, or written before the column was. */
  plaintext: number;
}

export interface RotationStatus {
  primaryKeyId: string;
  columns: ColumnStatus[];
  outstanding: number;
  plaintext: number;
  /** True when nothing is left on a retired key AND nothing is plaintext. */
  complete: boolean;
}

/** Prisma's delegates are not indexable by name in its types; narrow once, here. */
type Delegate = {
  findMany: (args: unknown) => Promise<Record<string, unknown>[]>;
  update: (args: unknown) => Promise<unknown>;
};

function delegate(model: string): Delegate {
  const d = (prisma as unknown as Record<string, Delegate>)[model];
  if (!d) throw new Error(`Unknown model in the encryption registry: ${model}`);
  return d;
}

/**
 * What is left to rotate. Reads every encrypted value, which is acceptable for an
 * administrative report and is the only way to answer honestly — the key a value
 * is under is in the value, not in a summary column.
 */
export async function rotationStatus(): Promise<RotationStatus> {
  const current = primaryKeyId();
  const columns: ColumnStatus[] = [];

  for (const entry of REGISTRY) {
    const rows = await delegate(entry.model).findMany({
      where: { [entry.column]: { not: null } },
      select: { id: true, [entry.column]: true },
    });
    let onCurrent = 0;
    let plaintext = 0;
    let outstanding = 0;
    for (const row of rows) {
      const value = row[entry.column];
      if (typeof value !== "string" || value === "") continue;
      if (!isCiphertext(value)) plaintext += 1;
      else if (ciphertextKeyId(value) === current) onCurrent += 1;
      else outstanding += 1;
    }
    columns.push({
      model: entry.model,
      column: entry.column,
      total: onCurrent + plaintext + outstanding,
      current: onCurrent,
      outstanding,
      plaintext,
    });
  }

  const outstanding = columns.reduce((a, c) => a + c.outstanding, 0);
  const plaintext = columns.reduce((a, c) => a + c.plaintext, 0);
  return {
    primaryKeyId: current,
    columns,
    outstanding,
    plaintext,
    complete: outstanding === 0 && plaintext === 0,
  };
}

export interface RotationResult {
  rotated: number;
  encrypted: number;
  skipped: number;
  failed: number;
  errors: string[];
  status: RotationStatus;
}

/**
 * Rewrite every value that is not already under the primary key.
 *
 * Also encrypts anything still plaintext, which is how a newly-encrypted column
 * gets backfilled — the read path tolerates plaintext so the column can ship
 * before its data is converted, and this is what converts it.
 *
 * Bounded per run so an administrative click cannot run for minutes; re-run until
 * `status.complete`. A row that fails is counted and named rather than aborting
 * the pass, because one unreadable value must not block the rest.
 */
export async function rotateEncryptedValues(limitPerColumn = 500): Promise<RotationResult> {
  const current = primaryKeyId();
  let rotated = 0;
  let encrypted = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const entry of REGISTRY) {
    const rows = await delegate(entry.model).findMany({
      where: { [entry.column]: { not: null } },
      select: { id: true, [entry.column]: true },
      take: limitPerColumn * 4,
    });

    let done = 0;
    for (const row of rows) {
      if (done >= limitPerColumn) break;
      const value = row[entry.column];
      const id = row.id;
      if (typeof value !== "string" || value === "" || typeof id !== "string") continue;

      const wasCiphertext = isCiphertext(value);
      if (wasCiphertext && ciphertextKeyId(value) === current) {
        skipped += 1;
        continue;
      }

      try {
        // Decrypt with whatever key opens it (or read through as plaintext), then
        // write it back under the primary key.
        const plain = decryptField(value);
        const data: Record<string, unknown> = { [entry.column]: encryptField(plain) };
        // The blind index is derived from the data key, so it must be rebuilt from
        // the plaintext in the same write — otherwise lookups silently stop
        // matching after a rotation.
        if (entry.reindex && plain) {
          data[entry.reindex.column] = blindIndex(plain);
          if (entry.reindex.domain) {
            const at = plain.lastIndexOf("@");
            data[entry.reindex.domain] = at > 0 ? plain.slice(at + 1).toLowerCase() : null;
          }
        }
        await delegate(entry.model).update({ where: { id }, data });
        if (wasCiphertext) rotated += 1;
        else encrypted += 1;
        done += 1;
      } catch (err) {
        failed += 1;
        const message = err instanceof Error ? err.message : "unknown error";
        // Deliberately identifies the row but never echoes the value.
        errors.push(`${entry.model}.${entry.column} id=${id}: ${message}`);
      }
    }
  }

  return { rotated, encrypted, skipped, failed, errors, status: await rotationStatus() };
}

/** Rotate and record it. Auditing this matters: it touches every stored secret. */
export async function rotateWithAudit(actor: {
  id: string;
  email: string;
}): Promise<RotationResult> {
  const result = await rotateEncryptedValues();
  await audit({
    action: "SSO_SETTINGS_CHANGED",
    actorId: actor.id,
    actorEmail: actor.email,
    target: "crypto:rotate",
    metadata: {
      keyId: result.status.primaryKeyId,
      rotated: result.rotated,
      encrypted: result.encrypted,
      failed: result.failed,
      outstanding: result.status.outstanding,
      complete: result.status.complete,
    },
  });
  return result;
}
