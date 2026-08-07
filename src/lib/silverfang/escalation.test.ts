import { describe, it, expect } from "vitest";
import {
  atRiskNote,
  minutesLabel,
  shouldWarnAtRisk,
} from "@/lib/silverfang/escalation";

const atRisk = { breached: false, atRisk: true, remainingMinutes: 20 };

describe("shouldWarnAtRisk", () => {
  it("warns when the target is inside its threshold and nobody has been told", () => {
    expect(shouldWarnAtRisk(atRisk, null)).toBe(true);
    expect(shouldWarnAtRisk(atRisk, undefined)).toBe(true);
  });

  it("does not warn twice", () => {
    // The sweep runs every 15 minutes. Re-warning on every pass trains people to
    // ignore the alert, which is worse than not sending it.
    expect(shouldWarnAtRisk(atRisk, new Date("2026-08-07T10:00:00Z"))).toBe(false);
  });

  it("does not warn once breached", () => {
    // A breach has its own alert; both would say the same thing twice.
    expect(
      shouldWarnAtRisk({ breached: true, atRisk: false, remainingMinutes: -30 }, null),
    ).toBe(false);
    // Even if a caller passes a state claiming both.
    expect(shouldWarnAtRisk({ breached: true, atRisk: true, remainingMinutes: 5 }, null)).toBe(
      false,
    );
  });

  it("does not warn with plenty of time left", () => {
    expect(
      shouldWarnAtRisk({ breached: false, atRisk: false, remainingMinutes: 400 }, null),
    ).toBe(false);
  });

  it("does not warn when the target does not exist", () => {
    // No target configured for this priority — there is nothing to be at risk of.
    expect(
      shouldWarnAtRisk({ breached: false, atRisk: true, remainingMinutes: null }, null),
    ).toBe(false);
  });
});

describe("minutesLabel", () => {
  it("reads as minutes under an hour", () => {
    expect(minutesLabel(1)).toBe("1 minute");
    expect(minutesLabel(45)).toBe("45 minutes");
  });

  it("reads as hours and minutes above one", () => {
    expect(minutesLabel(60)).toBe("1 hour");
    expect(minutesLabel(90)).toBe("1 hour 30 minutes");
    expect(minutesLabel(125)).toBe("2 hours 5 minutes");
    expect(minutesLabel(120)).toBe("2 hours");
  });

  it("never renders a negative", () => {
    // A caller that hands over a breached remaining value must not produce
    // "-30 minutes left".
    expect(minutesLabel(-30)).toBe("0 minutes");
  });
});

describe("atRiskNote", () => {
  it("names the target and the time left", () => {
    expect(atRiskNote("RESPONSE", 20)).toBe(
      "Response target at risk — 20 minutes of business time left",
    );
    expect(atRiskNote("RESOLUTION", 90)).toBe(
      "Resolution target at risk — 1 hour 30 minutes of business time left",
    );
  });

  it("says business time, since that is the clock the target uses", () => {
    // Wall-clock wording would make a Friday-afternoon warning look wrong on Monday.
    expect(atRiskNote("RESPONSE", 10)).toContain("business time");
  });
});
