import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { getEnv } from "@/env";

/**
 * Application-level encryption for connector secrets and OAuth tokens.
 *
 * Algorithm: AES-256-GCM (authenticated encryption).
 * Key:       32-byte key from WOLF365_ENCRYPTION_KEY (base64).
 * Format:    "v2:<keyId>:<iv_b64>:<authTag_b64>:<ciphertext_b64>"
 *            "v1:<iv_b64>:<authTag_b64>:<ciphertext_b64>"   (legacy, still read)
 *
 * GCM provides confidentiality + integrity: tampering with the ciphertext or
 * IV causes decryption to throw, so we never act on corrupted secrets.
 *
 * KEY ROTATION. v2 stamps a short key fingerprint into the envelope, which is
 * what makes rotation possible without downtime: retired keys stay available for
 * decryption via WOLF365_ENCRYPTION_KEYS_OLD while `scripts/rotate-keys` rewrites
 * stored values under the new one. Without the fingerprint, a mixed-key database
 * could only be decrypted by trying every key on every read and could never be
 * verified as fully migrated. v1 values predate the fingerprint and are tried
 * against every key in the ring.
 *
 * This is layered on top of Neon's encryption at rest, so secrets are protected
 * even if a raw database dump leaks.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit nonce, recommended for GCM
const VERSION = "v2";
/** Domain separator, so the blind-index key can never equal the data key. */
const INDEX_INFO = "wolf365-blind-index-v1";

function parseKey(b64: string, label: string): Buffer {
  const key = Buffer.from(b64.trim(), "base64");
  if (key.length !== 32) {
    throw new Error(`${label} must be exactly 32 bytes`);
  }
  return key;
}

/** Short, non-secret fingerprint of a key, stamped into the v2 envelope. */
export function keyId(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 8);
}

/** The key new ciphertext is written under. */
function primaryKey(): Buffer {
  return parseKey(getEnv().WOLF365_ENCRYPTION_KEY, "WOLF365_ENCRYPTION_KEY");
}

/**
 * Retired keys, for decryption only. Comma- or whitespace-separated base64 in
 * WOLF365_ENCRYPTION_KEYS_OLD. Keeping them readable is what lets a rotation run
 * while the app is serving traffic.
 */
function retiredKeys(): Buffer[] {
  const raw = getEnv().WOLF365_ENCRYPTION_KEYS_OLD;
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .filter(Boolean)
    .map((k, i) => parseKey(k, `WOLF365_ENCRYPTION_KEYS_OLD[${i}]`));
}

/** Primary first, so the common case is one attempt. */
function keyring(): Buffer[] {
  return [primaryKey(), ...retiredKeys()];
}

/** Fingerprint of the key new writes use — for reporting rotation progress. */
export function primaryKeyId(): string {
  return keyId(primaryKey());
}

/** Encrypt a UTF-8 string under the primary key. */
export function encrypt(plaintext: string): string {
  const key = primaryKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    VERSION,
    keyId(key),
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

function decryptWith(key: Buffer, iv: Buffer, tag: Buffer, data: Buffer): string {
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/**
 * Which key a stored value is under, or null for a legacy v1 value. Used by the
 * rotation runner to skip what is already current.
 */
export function ciphertextKeyId(payload: string): string | null {
  const parts = payload.split(":");
  return parts[0] === "v2" && parts.length === 5 ? (parts[1] ?? null) : null;
}

/** True for something this module produced. Lets reads tolerate plaintext rows. */
export function isCiphertext(value: string): boolean {
  const parts = value.split(":");
  return (parts[0] === "v1" && parts.length === 4) || (parts[0] === "v2" && parts.length === 5);
}

/**
 * Decrypt a value produced by {@link encrypt}. Throws if tampered or if no key in
 * the ring can open it — never returns a partial or guessed result.
 */
export function decrypt(payload: string): string {
  const parts = payload.split(":");

  if (parts[0] === "v2" && parts.length === 5) {
    const [, id, ivB64, tagB64, dataB64] = parts;
    const iv = Buffer.from(ivB64!, "base64");
    const tag = Buffer.from(tagB64!, "base64");
    const data = Buffer.from(dataB64!, "base64");
    const ring = keyring();
    // The stamped key first; the rest as a fallback, so a value written under a
    // key that has since been re-added under a different label still opens.
    const ordered = [...ring.filter((k) => keyId(k) === id), ...ring.filter((k) => keyId(k) !== id)];
    for (const key of ordered) {
      try {
        return decryptWith(key, iv, tag, data);
      } catch {
        // Wrong key — GCM authentication failed. Try the next.
      }
    }
    throw new Error(
      `No configured key can decrypt this value (written under key ${id}). ` +
        `Add the retired key to WOLF365_ENCRYPTION_KEYS_OLD.`,
    );
  }

  if (parts[0] === "v1" && parts.length === 4) {
    const [, ivB64, tagB64, dataB64] = parts;
    const iv = Buffer.from(ivB64!, "base64");
    const tag = Buffer.from(tagB64!, "base64");
    const data = Buffer.from(dataB64!, "base64");
    // v1 carries no fingerprint, so every key must be tried.
    for (const key of keyring()) {
      try {
        return decryptWith(key, iv, tag, data);
      } catch {
        // Try the next.
      }
    }
    throw new Error(
      "No configured key can decrypt this legacy (v1) value. " +
        "Add the original key to WOLF365_ENCRYPTION_KEYS_OLD.",
    );
  }

  throw new Error("Malformed or unsupported ciphertext");
}

// ---------------------------------------------------------------------------
// Field-level encryption for personal data
// ---------------------------------------------------------------------------

/**
 * Encrypt a nullable field value. Empty and null pass through untouched: storing
 * ciphertext for "no value" would make an absent field indistinguishable from a
 * present one and break every `null` check in the app.
 */
export function encryptField(value: string | null | undefined): string | null {
  if (value == null) return null;
  if (value === "") return "";
  return encrypt(value);
}

/**
 * Decrypt a nullable field value, tolerating plaintext.
 *
 * The passthrough matters: a column becomes encrypted while it already holds
 * rows, and backfilling millions of rows in a migration is worse than reading
 * both shapes. `isCiphertext` decides, so a plaintext value that merely contains
 * colons is not mistaken for an envelope.
 */
export function decryptField(value: string | null | undefined): string | null {
  if (value == null || value === "") return value ?? null;
  if (!isCiphertext(value)) return value;
  return decrypt(value);
}

/**
 * Deterministic index for finding an encrypted value by equality.
 *
 * AES-GCM is randomised — the same email encrypts differently every time — so an
 * encrypted column cannot be queried with `where`. This HMAC gives one stable
 * value per input so lookups and uniqueness still work. It is keyed, so the index
 * cannot be reversed with a dictionary the way a plain hash of an email address
 * can, and domain-separated from the data key so neither weakens the other.
 *
 * The index leaks equality by design: two identical emails share an index. That
 * is the trade being made in exchange for being able to look them up at all.
 */
export function blindIndex(value: string): string {
  const indexKey = createHmac("sha256", primaryKey()).update(INDEX_INFO).digest();
  return createHmac("sha256", indexKey).update(value.trim().toLowerCase()).digest("hex");
}

/** Encrypt a JSON-serializable object (e.g. a secrets bag). */
export function encryptJson(value: unknown): string {
  return encrypt(JSON.stringify(value));
}

/** Decrypt and parse a value produced by {@link encryptJson}. */
export function decryptJson<T = unknown>(payload: string): T {
  return JSON.parse(decrypt(payload)) as T;
}

/** Constant-time string comparison for tokens/HMACs. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
