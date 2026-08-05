import { describe, it, expect } from "vitest";
import { computeDueDates, elapsedMinutes, evaluateTarget, targetMinutes, type SlaLike } from "@/lib/silverfang/sla";
import { weekdayWindows } from "@/lib/silverfang/business-hours";

const TZ = "America/Winnipeg";
const sla: SlaLike = {
  useBusinessHours: true,
  targets: [
    { priority: "P1", kind: "RESPONSE", minutes: 30 },
    { priority: "P1", kind: "RESOLUTION", minutes: 240 },
    { priority: "P3", kind: "RESPONSE", minutes: 240 },
  ],
  calendar: { windows: weekdayWindows(480, 1020, TZ), holidays: [], timezone: TZ },
};

/** Wednesday 2026-08-05, 08:00 local = 13:00Z. */
const opened = new Date("2026-08-05T13:00:00Z");

describe("targetMinutes", () => {
  it("finds a configured target and returns null otherwise", () => {
    expect(targetMinutes(sla, "P1", "RESPONSE")).toBe(30);
    expect(targetMinutes(sla, "P3", "RESOLUTION")).toBeNull();
  });
});

describe("computeDueDates", () => {
  it("computes due dates in business hours", () => {
    const { responseDueAt, resolutionDueAt } = computeDueDates(sla, "P1", opened);
    expect(responseDueAt?.toISOString()).toBe("2026-08-05T13:30:00.000Z"); // 08:30 local
    expect(resolutionDueAt?.toISOString()).toBe("2026-08-05T17:00:00.000Z"); // 12:00 local
  });

  it("rolls a long target into the next business day", () => {
    // P3 resolution isn't set; use P3 response 240 from 15:00 local (20:00Z):
    // 120 min left Wed, 120 into Thu → Thu 10:00 local = 15:00Z.
    const late = new Date("2026-08-05T20:00:00Z");
    const { responseDueAt } = computeDueDates(sla, "P3", late);
    expect(responseDueAt?.toISOString()).toBe("2026-08-06T15:00:00.000Z");
  });

  it("pushes deadlines out by paused minutes", () => {
    const { responseDueAt } = computeDueDates(sla, "P1", opened, 60);
    // 30 + 60 paused = 90 business minutes → 09:30 local.
    expect(responseDueAt?.toISOString()).toBe("2026-08-05T14:30:00.000Z");
  });

  it("returns null for a priority with no target", () => {
    expect(computeDueDates(sla, "P4", opened).responseDueAt).toBeNull();
  });

  it("uses calendar time when business hours are disabled", () => {
    const always: SlaLike = { ...sla, useBusinessHours: false };
    // 240 elapsed minutes from 08:00 local, ignoring the window.
    const { resolutionDueAt } = computeDueDates(always, "P1", opened);
    expect(resolutionDueAt?.toISOString()).toBe("2026-08-05T17:00:00.000Z");
    // And after close it keeps counting rather than waiting for tomorrow.
    const evening = new Date("2026-08-06T02:00:00Z"); // 21:00 local Wed
    expect(computeDueDates(always, "P1", evening).responseDueAt?.toISOString()).toBe(
      "2026-08-06T02:30:00.000Z",
    );
  });
});

describe("elapsedMinutes", () => {
  it("excludes paused time and never goes negative", () => {
    const now = new Date("2026-08-05T15:00:00Z"); // 10:00 local → 120 business min
    expect(elapsedMinutes(sla, opened, now)).toBe(120);
    expect(elapsedMinutes(sla, opened, now, 30)).toBe(90);
    expect(elapsedMinutes(sla, opened, now, 500)).toBe(0);
  });
});

describe("evaluateTarget", () => {
  it("reports remaining time, at-risk, and breach", () => {
    // 10 minutes in on a 30-minute response target.
    const ok = evaluateTarget(sla, "P1", "RESPONSE", opened, new Date("2026-08-05T13:10:00Z"));
    expect(ok).toMatchObject({ remainingMinutes: 20, breached: false, atRisk: false });

    // 25 minutes in → 5 remaining, within 25% of 30 → at risk.
    const risky = evaluateTarget(sla, "P1", "RESPONSE", opened, new Date("2026-08-05T13:25:00Z"));
    expect(risky).toMatchObject({ breached: false, atRisk: true });

    // 45 minutes in → breached.
    const late = evaluateTarget(sla, "P1", "RESPONSE", opened, new Date("2026-08-05T13:45:00Z"));
    expect(late.breached).toBe(true);
    expect(late.remainingMinutes).toBe(-15);
    expect(late.atRisk).toBe(false);
  });

  it("settles the verdict once the clock stops", () => {
    // Responded at 20 minutes: not breached even though 'now' is much later.
    const met = evaluateTarget(sla, "P1", "RESPONSE", opened, new Date("2026-08-07T13:00:00Z"), {
      metAt: new Date("2026-08-05T13:20:00Z"),
    });
    expect(met).toMatchObject({ breached: false, atRisk: false });

    // Responded late: breached, and stays breached.
    const missed = evaluateTarget(sla, "P1", "RESPONSE", opened, new Date("2026-08-07T13:00:00Z"), {
      metAt: new Date("2026-08-05T14:00:00Z"),
    });
    expect(missed.breached).toBe(true);
  });

  it("treats an unset target as nothing to breach", () => {
    const none = evaluateTarget(sla, "P4", "RESPONSE", opened, new Date("2026-09-01T13:00:00Z"));
    expect(none).toEqual({ remainingMinutes: null, breached: false, atRisk: false });
  });

  it("does not breach across a weekend when the clock is paused by hours", () => {
    // Opened Fri 16:00 local; P1 resolution 240 business min. Sat/Sun don't count,
    // so at Sun noon only 60 business minutes have elapsed → not breached.
    const fri = new Date("2026-08-07T21:00:00Z");
    const sun = new Date("2026-08-09T17:00:00Z");
    expect(evaluateTarget(sla, "P1", "RESOLUTION", fri, sun).breached).toBe(false);
  });
});
