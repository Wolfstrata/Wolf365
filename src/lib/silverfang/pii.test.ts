import { describe, it, expect } from "vitest";
import {
  contactEmailIndex,
  contactEmailLookup,
  contactRead,
  contactWrite,
  textRead,
  textWrite,
} from "@/lib/silverfang/pii";

/**
 * These tests exist for one failure mode above all others: a write that encrypts
 * the address but derives its lookup index from something else. That never
 * throws — it just quietly stops inbound mail finding the contact.
 */

describe("contactWrite / contactRead", () => {
  it("round-trips every detail field", () => {
    const stored = contactWrite({
      email: "Alex@Acme.com",
      phone: "+1 555 0100",
      mobile: "+1 555 0199",
    });
    expect(stored.email).not.toContain("Acme");
    expect(stored.phone).not.toContain("555");
    const read = contactRead(stored);
    expect(read.email).toBe("Alex@Acme.com");
    expect(read.phone).toBe("+1 555 0100");
    expect(read.mobile).toBe("+1 555 0199");
  });

  it("preserves the address exactly as entered, casing included", () => {
    // The index normalizes; the stored value must not, or the contact card would
    // show something the user did not type.
    const read = contactRead(contactWrite({ email: "Alex.Smith@Acme.COM" }));
    expect(read.email).toBe("Alex.Smith@Acme.COM");
  });

  it("leaves missing detail null rather than encrypting an empty string", () => {
    const stored = contactWrite({ email: null });
    expect(stored.email).toBeNull();
    expect(stored.phone).toBeNull();
    expect(stored.mobile).toBeNull();
    // No address means no index — an index of "" would let two contacts without
    // an email collide with each other.
    expect(stored.emailIndex).toBeNull();
    expect(stored.emailDomain).toBeNull();
  });

  it("indexes what the lookup will search for", () => {
    // The whole point: a contact saved with stray case/whitespace/angle brackets
    // must still be found by the plain address inbound mail carries.
    const stored = contactWrite({ email: "  Alex Smith <Alex@Acme.com> " });
    expect(stored.emailIndex).toBe(contactEmailIndex("alex@acme.com"));
    expect(stored.emailDomain).toBe("acme.com");
  });

  it("gives different addresses different indexes", () => {
    expect(contactEmailIndex("a@acme.com")).not.toBe(contactEmailIndex("b@acme.com"));
  });

  it("has no index for a value that is not an address", () => {
    expect(contactEmailIndex("not-an-address")).toBeNull();
    expect(contactEmailIndex("")).toBeNull();
    expect(contactEmailIndex(null)).toBeNull();
  });

  it("derives the same lookup columns as a write", () => {
    // Key rotation rebuilds the index through contactEmailLookup; if it drifted
    // from contactWrite, rotating would break sender matching.
    const stored = contactWrite({ email: "sam@acme.com" });
    expect(contactEmailLookup("sam@acme.com")).toEqual({
      emailIndex: stored.emailIndex,
      emailDomain: stored.emailDomain,
    });
  });

  it("reads a plaintext row unchanged, so it works before the backfill", () => {
    const read = contactRead({ email: "legacy@acme.com", phone: "555", mobile: null });
    expect(read.email).toBe("legacy@acme.com");
    expect(read.phone).toBe("555");
    expect(read.mobile).toBeNull();
  });

  it("keeps the caller's other selected fields", () => {
    const read = contactRead({ id: "c1", firstName: "Alex", email: null });
    expect(read.id).toBe("c1");
    expect(read.firstName).toBe("Alex");
  });
});

describe("textWrite / textRead", () => {
  it("round-trips free text", () => {
    const body = "The printer in accounting is offline again.\nSecond line.";
    const stored = textWrite(body);
    expect(stored).not.toContain("printer");
    expect(textRead(stored)).toBe(body);
  });

  it("passes null and empty through untouched", () => {
    expect(textWrite(null)).toBeNull();
    expect(textWrite(undefined)).toBeNull();
    expect(textWrite("")).toBe("");
    expect(textRead(null)).toBeNull();
  });

  it("reads plaintext as-is", () => {
    expect(textRead("an unencrypted legacy body")).toBe("an unencrypted legacy body");
  });
});
