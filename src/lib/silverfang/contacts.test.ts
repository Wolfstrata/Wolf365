import { describe, it, expect } from "vitest";
import {
  contactDisplayName,
  contactImportDecision,
  nameFromAddress,
  splitName,
} from "@/lib/silverfang/contacts";

describe("splitName", () => {
  it("splits a simple first/last name", () => {
    expect(splitName("Jane Doe")).toEqual({ firstName: "Jane", lastName: "Doe" });
  });

  it("keeps middle names with the first name", () => {
    expect(splitName("Mary Jane Watson")).toEqual({
      firstName: "Mary Jane",
      lastName: "Watson",
    });
  });

  it("handles a single name", () => {
    expect(splitName("Cher")).toEqual({ firstName: "Cher", lastName: null });
  });

  it("collapses extra whitespace", () => {
    expect(splitName("  Jane   Doe  ")).toEqual({ firstName: "Jane", lastName: "Doe" });
    expect(splitName("\tJohn\nSmith ")).toEqual({ firstName: "John", lastName: "Smith" });
  });

  it("returns null for unusable input so callers can skip the record", () => {
    for (const v of ["", "   ", "\n", null, undefined]) {
      expect(splitName(v as string)).toBeNull();
    }
  });
});

describe("contactImportDecision", () => {
  it("creates when there is no existing contact", () => {
    expect(contactImportDecision(null)).toBe("create");
    expect(contactImportDecision(undefined)).toBe("create");
  });

  it("updates an imported contact nobody has touched", () => {
    expect(contactImportDecision({ locallyModifiedAt: null })).toBe("update");
    expect(contactImportDecision({})).toBe("update");
  });

  it("preserves a contact edited by hand, so a re-import cannot revert it", () => {
    expect(contactImportDecision({ locallyModifiedAt: new Date("2026-08-06") })).toBe(
      "preserve",
    );
  });
});

describe("contactDisplayName", () => {
  it("joins first and last", () => {
    expect(contactDisplayName({ firstName: "Jane", lastName: "Doe" })).toBe("Jane Doe");
  });
  it("tolerates a missing surname", () => {
    expect(contactDisplayName({ firstName: "Jane", lastName: null })).toBe("Jane");
  });
  it("falls back to the email local part, then a placeholder", () => {
    expect(contactDisplayName({ firstName: "", email: "sam@example.com" })).toBe("sam");
    expect(contactDisplayName({})).toBe("Unnamed contact");
  });
});

describe("nameFromAddress", () => {
  it("turns a dotted local part into a name", () => {
    expect(nameFromAddress("sam.jones@acme.com")).toEqual({
      firstName: "Sam",
      lastName: "Jones",
    });
  });

  it("handles underscores, plus tags and hyphens", () => {
    expect(nameFromAddress("sam_jones@acme.com")?.lastName).toBe("Jones");
    expect(nameFromAddress("sam-jones@acme.com")?.lastName).toBe("Jones");
    expect(nameFromAddress("sam+tickets@acme.com")?.firstName).toBe("Sam");
  });

  it("gives a first name only for a single-word local part", () => {
    expect(nameFromAddress("sam@acme.com")).toEqual({ firstName: "Sam", lastName: null });
  });

  it("returns null when there is no name to find", () => {
    // Better to fall back than to create a contact called "12345".
    expect(nameFromAddress("12345@acme.com")).toBeNull();
    expect(nameFromAddress("@acme.com")).toBeNull();
    expect(nameFromAddress(null)).toBeNull();
    expect(nameFromAddress("")).toBeNull();
  });
});
