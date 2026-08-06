import { describe, it, expect } from "vitest";
import {
  clientEmailAllowed,
  clientEmailBlockedReason,
  clientEmailLabel,
} from "./email-policy";

describe("clientEmailAllowed — the hard rule", () => {
  it("allows only an explicit true", () => {
    expect(clientEmailAllowed({ allowClientEmail: true })).toBe(true);
  });

  it("refuses when explicitly false", () => {
    expect(clientEmailAllowed({ allowClientEmail: false })).toBe(false);
  });

  it("refuses when the client has no profile row at all", () => {
    // Absence must never read as "not configured, assume yes".
    expect(clientEmailAllowed(null)).toBe(false);
    expect(clientEmailAllowed(undefined)).toBe(false);
  });

  it("refuses when the flag is missing or null on an existing profile", () => {
    expect(clientEmailAllowed({})).toBe(false);
    expect(clientEmailAllowed({ allowClientEmail: null })).toBe(false);
  });

  it("refuses every truthy-but-not-true value", () => {
    // Guards against a loose `if (profile.allowClientEmail)` creeping back in:
    // a stray string or number from JSON must not open the gate.
    for (const value of ["true", "yes", 1, {}, [], "false", 0, ""] as unknown[]) {
      expect(clientEmailAllowed({ allowClientEmail: value as boolean })).toBe(false);
    }
  });
});

describe("messaging", () => {
  it("names the client and states nothing was sent", () => {
    const reason = clientEmailBlockedReason("Alair Homes");
    expect(reason).toContain("Alair Homes");
    expect(reason).toContain("Nothing has been sent");
    expect(reason).toContain("Allow email to client");
  });

  it("labels both states", () => {
    expect(clientEmailLabel({ allowClientEmail: true })).toBe("Email allowed");
    expect(clientEmailLabel(null)).toBe("Email off");
  });
});
