import { describe, it, expect } from "vitest";
import { contactDisplayName, splitName } from "@/lib/silverfang/contacts";

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
