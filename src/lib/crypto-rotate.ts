import "server-only";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { safeErrorMessage } from "@/lib/redact";
import {
  ciphertextKeyId,
  decryptField,
  encryptField,
  isCiphertext,
  primaryKeyId,
} from "@/lib/crypto";
import { ENCRYPTED_COLUMNS } from "@/lib/crypto-columns";

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

/** Which columns hold encrypted data. Declared in crypto-columns.ts. */
const REGISTRY = ENCRYPTED_COLUMNS;

export interface ColumnStatus {
  model: string;
  column: string;
  /** Rows holding a non-null value. */
  total: number;
  /** Already under the primary key. */
  current: number;
  /** Under a key that is not the primary one. */
  outstanding: number;
  /**
   * Legacy v1 envelopes, which carry no key fingerprint. These still decrypt —
   * every key in the ring is tried — but which key opened them cannot be known
   * without doing it, so they must be rewritten before a rotation can be called
   * finished. Counted apart from `outstanding` because telling someone to remove
   * a retired key they never configured sends them looking for the wrong thing.
   */
  legacy: number;
  /** Still plaintext — never encrypted, or written before the column was. */
  plaintext: number;
  /** True when the scan hit its row cap, so these counts are a lower bound. */
  capped?: boolean;
  /** Why this column could not be read. Counts are meaningless when set. */
  error?: string;
}

export interface RotationStatus {
  primaryKeyId: string;
  columns: ColumnStatus[];
  outstanding: number;
  legacy: number;
  plaintext: number;
  /** True when every value is a v2 envelope under the primary key. */
  complete: boolean;
  /** Set when the status itself could not be determined at all. */
  error?: string;
}

/**
 * How many rows one column's scan will read. Answering "what key is this under?"
 * means reading the value, so the scan is bounded — an administrative page must
 * not be able to pull an unbounded amount of ticket text into memory. A capped
 * column reports `capped`, and can never report complete.
 */
const SCAN_LIMIT = 5_000;

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
  // Resolving the key can fail on its own (missing or malformed env value), and
  // that must read as a reportable condition rather than a blank page.
  let current: string;
  try {
    current = primaryKeyId();
  } catch (err) {
    return {
      primaryKeyId: "unavailable",
      columns: [],
      outstanding: 0,
      legacy: 0,
      plaintext: 0,
      complete: false,
      error: safeErrorMessage(err),
    };
  }

  const columns: ColumnStatus[] = [];
  for (const entry of REGISTRY) {
    // One unreadable column must not cost the whole report — and, more to the
    // point, must not take down the page this report sits on. Naming the column
    // that failed is the difference between a fixable message and a mystery.
    try {
      // Deliberately unfiltered: `{ [column]: { not: null } }` is invalid on a
      // required column and fails the entire query, so nullability is handled by
      // skipping empty values below rather than in SQL.
      const rows = await delegate(entry.model).findMany({
        select: { id: true, [entry.column]: true },
        take: SCAN_LIMIT + 1,
      });
      let onCurrent = 0;
      let plaintext = 0;
      let outstanding = 0;
      let legacy = 0;
      for (const row of rows.slice(0, SCAN_LIMIT)) {
        const value = row[entry.column];
        if (typeof value !== "string" || value === "") continue;
        if (!isCiphertext(value)) plaintext += 1;
        else if (ciphertextKeyId(value) === current) onCurrent += 1;
        else if (ciphertextKeyId(value) === null) legacy += 1;
        else outstanding += 1;
      }
      columns.push({
        model: entry.model,
        column: entry.column,
        total: onCurrent + plaintext + outstanding + legacy,
        current: onCurrent,
        outstanding,
        legacy,
        plaintext,
        ...(rows.length > SCAN_LIMIT ? { capped: true } : {}),
      });
    } catch (err) {
      columns.push({
        model: entry.model,
        column: entry.column,
        total: 0,
        current: 0,
        outstanding: 0,
        legacy: 0,
        plaintext: 0,
        error: safeErrorMessage(err),
      });
    }
  }

  const outstanding = columns.reduce((a, c) => a + c.outstanding, 0);
  const legacy = columns.reduce((a, c) => a + c.legacy, 0);
  const plaintext = columns.reduce((a, c) => a + c.plaintext, 0);
  const unknown = columns.some((c) => c.error || c.capped);
  return {
    primaryKeyId: current,
    columns,
    outstanding,
    legacy,
    plaintext,
    // A column we could not fully read might hold values on the retired key, so
    // "complete" would be a guess. Dropping the old key on a guess makes data
    // permanently unreadable, so this stays false until every column is known.
    complete: outstanding === 0 && legacy === 0 && plaintext === 0 && !unknown,
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
    let rows: Record<string, unknown>[];
    try {
      // No `{ not: null }` filter. It is invalid on a required column — Prisma
      // rejects the whole query with "Argument `not` must not be null" — and
      // rows with no value are skipped in the loop below anyway.
      rows = await delegate(entry.model).findMany({
        select: { id: true, [entry.column]: true },
        take: limitPerColumn * 4,
      });
    } catch (err) {
      // A column that cannot even be read is reported and stepped over, so the
      // rest of the rotation still happens.
      failed += 1;
      errors.push(`${entry.model}.${entry.column}: ${safeErrorMessage(err)}`);
      continue;
    }

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
        // Rebuild the lookup columns from the plaintext in the same write.
        if (entry.derived) Object.assign(data, entry.derived(plain ?? ""));
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
    action: "ENCRYPTION_KEY_ROTATED",
    actorId: actor.id,
    actorEmail: actor.email,
    target: "crypto:rotate",
    metadata: {
      keyId: result.status.primaryKeyId,
      rotated: result.rotated,
      encrypted: result.encrypted,
      failed: result.failed,
      outstanding: result.status.outstanding,
      legacy: result.status.legacy,
      plaintext: result.status.plaintext,
      complete: result.status.complete,
    },
  });
  return result;
}
