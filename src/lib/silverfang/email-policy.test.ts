import { describe, it, expect } from "vitest";
import {
  clientEmailAllowed,
  clientEmailBlockedReason,
  clientEmailLabel,
  decideOutbound,
  outboundEnabled,
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

describe("outboundEnabled — the master switch", () => {
  it("is on only for an explicit true", () => {
    expect(outboundEnabled({ outboundEnabled: true })).toBe(true);
  });

  it("is off when false, missing, null, or when there is no policy row", () => {
    expect(outboundEnabled({ outboundEnabled: false })).toBe(false);
    expect(outboundEnabled({ outboundEnabled: null })).toBe(false);
    expect(outboundEnabled({})).toBe(false);
    expect(outboundEnabled(null)).toBe(false);
    expect(outboundEnabled(undefined)).toBe(false);
  });

  it("is off for truthy-but-not-true values", () => {
    for (const value of ["true", 1, {}, "false"] as unknown[]) {
      expect(outboundEnabled({ outboundEnabled: value as boolean })).toBe(false);
    }
  });
});

describe("decideOutbound — both gates together", () => {
  const on = { outboundEnabled: true };
  const off = { outboundEnabled: false };
  const clientOn = { allowClientEmail: true };

  it("allows client mail only when the master switch AND the client are on", () => {
    expect(
      decideOutbound({ policy: on, audience: "CLIENT", clientProfile: clientOn }),
    ).toEqual({ allowed: true });
  });

  it("blocks client mail when the client is off", () => {
    const d = decideOutbound({
      policy: on,
      audience: "CLIENT",
      clientProfile: { allowClientEmail: false },
      clientName: "Alair Homes",
    });
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.reason).toBe("CLIENT_OFF");
      expect(d.message).toContain("Alair Homes");
    }
  });

  it("blocks internal mail too when the master switch is off", () => {
    // A kill switch that leaves technician mail flowing is not a kill switch.
    const d = decideOutbound({ policy: off, audience: "INTERNAL" });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe("MASTER_OFF");
  });

  it("allows internal mail when the master switch is on, with no client involved", () => {
    expect(decideOutbound({ policy: on, audience: "INTERNAL" })).toEqual({ allowed: true });
  });

  it("reports the master switch first, so a disabled system does not blame a client", () => {
    const d = decideOutbound({
      policy: off,
      audience: "CLIENT",
      clientProfile: { allowClientEmail: false },
    });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe("MASTER_OFF");
  });

  it("blocks everything when there is no policy row at all", () => {
    for (const audience of ["CLIENT", "INTERNAL"] as const) {
      const d = decideOutbound({ policy: null, audience, clientProfile: clientOn });
      expect(d.allowed).toBe(false);
      if (!d.allowed) expect(d.reason).toBe("MASTER_OFF");
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
