import { describe, it, expect } from "vitest";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import {
  blindIndex,
  ciphertextKeyId,
  decrypt,
  decryptField,
  decryptJson,
  encrypt,
  encryptField,
  encryptJson,
  isCiphertext,
  keyId,
  primaryKeyId,
  safeEqual,
} from "@/lib/crypto";

describe("crypto (AES-256-GCM)", () => {
  it("round-trips a string", () => {
    const plaintext = "super-secret-client-secret-value";
    const enc = encrypt(plaintext);
    expect(enc).not.toContain(plaintext);
    expect(enc.startsWith("v2:")).toBe(true);
    expect(decrypt(enc)).toBe(plaintext);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const a = encrypt("same");
    const b = encrypt("same");
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe("same");
    expect(decrypt(b)).toBe("same");
  });

  it("round-trips JSON secret bags", () => {
    const secrets = { clientId: "abc", refreshToken: "xyz", n: 42 };
    const enc = encryptJson(secrets);
    expect(decryptJson(enc)).toEqual(secrets);
  });

  it("rejects tampered ciphertext via the auth tag", () => {
    const enc = encrypt("integrity-protected");
    const parts = enc.split(":");
    // Flip a byte in the ciphertext segment.
    const data = Buffer.from(parts[3]!, "base64");
    data[0] = data[0]! ^ 0xff;
    parts[3] = data.toString("base64");
    expect(() => decrypt(parts.join(":"))).toThrow();
  });

  it("rejects malformed payloads", () => {
    expect(() => decrypt("not-a-valid-payload")).toThrow();
    expect(() => decrypt("v2:a:b:c")).toThrow();
  });

  it("safeEqual compares correctly", () => {
    expect(safeEqual("token", "token")).toBe(true);
    expect(safeEqual("token", "other")).toBe(false);
    expect(safeEqual("a", "ab")).toBe(false);
  });
});

/** Build a v1 (pre-key-id) envelope with the key the test env is configured with. */
function legacyV1(plaintext: string, keyB64: string): string {
  const key = Buffer.from(keyB64, "base64");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ct.toString("base64"),
  ].join(":");
}

describe("key identification", () => {
  it("stamps the primary key's fingerprint into the envelope", () => {
    const enc = encrypt("x");
    expect(ciphertextKeyId(enc)).toBe(primaryKeyId());
    expect(primaryKeyId()).toHaveLength(8);
  });

  it("fingerprints are derived from the key, not random", () => {
    const key = Buffer.alloc(32, 7);
    expect(keyId(key)).toBe(createHash("sha256").update(key).digest("hex").slice(0, 8));
  });

  it("reports no key id for a legacy v1 value", () => {
    expect(ciphertextKeyId(legacyV1("x", process.env.WOLF365_ENCRYPTION_KEY!))).toBeNull();
  });

  it("still decrypts legacy v1 values, so rotation is not a flag day", () => {
    const enc = legacyV1("old-secret", process.env.WOLF365_ENCRYPTION_KEY!);
    expect(decrypt(enc)).toBe("old-secret");
  });
});

describe("isCiphertext", () => {
  it("recognises both envelope versions", () => {
    expect(isCiphertext(encrypt("a"))).toBe(true);
    expect(isCiphertext(legacyV1("a", process.env.WOLF365_ENCRYPTION_KEY!))).toBe(true);
  });

  it("does not mistake plaintext containing colons for an envelope", () => {
    expect(isCiphertext("alex@example.com")).toBe(false);
    expect(isCiphertext("v1:only:three")).toBe(false);
    expect(isCiphertext("10:30")).toBe(false);
    expect(isCiphertext("Notes: call back at 4:15 about v2:x")).toBe(false);
  });
});

describe("field encryption", () => {
  it("round-trips a value", () => {
    const enc = encryptField("alex@example.com");
    expect(enc).not.toContain("alex@example.com");
    expect(decryptField(enc)).toBe("alex@example.com");
  });

  it("passes null and empty through, so absent stays absent", () => {
    expect(encryptField(null)).toBeNull();
    expect(encryptField(undefined)).toBeNull();
    expect(encryptField("")).toBe("");
    expect(decryptField(null)).toBeNull();
    expect(decryptField("")).toBe("");
  });

  it("reads plaintext unchanged, so a column can be encrypted without a backfill", () => {
    expect(decryptField("07700 900123")).toBe("07700 900123");
    expect(decryptField("alex@example.com")).toBe("alex@example.com");
  });
});

describe("blindIndex", () => {
  it("is stable for the same value", () => {
    expect(blindIndex("alex@example.com")).toBe(blindIndex("alex@example.com"));
  });

  it("normalises case and surrounding whitespace, as email lookups must", () => {
    expect(blindIndex("  Alex@Example.COM ")).toBe(blindIndex("alex@example.com"));
  });

  it("differs for different values", () => {
    expect(blindIndex("a@example.com")).not.toBe(blindIndex("b@example.com"));
  });

  it("is not a bare hash of the value — it is keyed", () => {
    const bare = createHash("sha256").update("alex@example.com").digest("hex");
    expect(blindIndex("alex@example.com")).not.toBe(bare);
  });

  it("is hex of a full SHA-256", () => {
    expect(blindIndex("x")).toMatch(/^[0-9a-f]{64}$/);
  });
});
