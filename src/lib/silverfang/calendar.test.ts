import { describe, it, expect } from "vitest";
import {
  DEFAULT_GRID,
  assignLanes,
  daySlots,
  formatClock,
  hourMarks,
  hoursBetweenMinutes,
  instantFor,
  minutesOf,
  minutesToTime,
  placeBlock,
  timeToMinutes,
} from "./calendar";

describe("time parsing and formatting", () => {
  it("parses HH:MM", () => {
    expect(timeToMinutes("09:30")).toBe(570);
    expect(timeToMinutes("0:00")).toBe(0);
    expect(timeToMinutes("23:59")).toBe(1439);
  });

  it("rejects rubbish and out-of-range hours", () => {
    for (const v of ["", "9", "9:5", "24:00", "25:00", "9:60", "abc", null, undefined]) {
      expect(timeToMinutes(v as string)).toBeNull();
    }
  });

  it("round-trips", () => {
    expect(minutesToTime(timeToMinutes("14:45")!)).toBe("14:45");
  });

  it("clamps out-of-day minutes rather than rolling over", () => {
    expect(minutesToTime(-30)).toBe("00:00");
    expect(minutesToTime(2000)).toBe("23:59");
  });

  it("formats a 12-hour clock", () => {
    expect(formatClock(0)).toBe("12 AM");
    expect(formatClock(9 * 60)).toBe("9 AM");
    expect(formatClock(12 * 60)).toBe("12 PM");
    expect(formatClock(13 * 60 + 30)).toBe("1:30 PM");
  });
});

describe("grid", () => {
  it("produces slots across the window", () => {
    const slots = daySlots({ startHour: 9, endHour: 11, slotMinutes: 30 });
    expect(slots).toEqual([540, 570, 600, 630]);
  });

  it("stops before the end hour", () => {
    const slots = daySlots({ startHour: 9, endHour: 10, slotMinutes: 15 });
    expect(slots[slots.length - 1]).toBe(585); // 09:45
  });

  it("marks each hour", () => {
    expect(hourMarks({ startHour: 8, endHour: 11, slotMinutes: 30 })).toEqual([480, 540, 600]);
  });
});

describe("placeBlock", () => {
  const grid = { startHour: 8, endHour: 18, slotMinutes: 30 }; // 600-minute window

  it("places a block proportionally", () => {
    const p = placeBlock(9 * 60, 10 * 60, grid);
    expect(p.topPercent).toBeCloseTo(10, 5); // 1h into a 10h window
    expect(p.heightPercent).toBeCloseTo(10, 5);
    expect(p.clipped).toBe(false);
  });

  it("starts at zero for a block at the window start", () => {
    expect(placeBlock(8 * 60, 9 * 60, grid).topPercent).toBe(0);
  });

  it("clamps and flags a block starting before the window", () => {
    const p = placeBlock(6 * 60, 9 * 60, grid);
    expect(p.topPercent).toBe(0);
    expect(p.heightPercent).toBeCloseTo(10, 5);
    expect(p.clipped).toBe(true);
  });

  it("clamps and flags a block ending after the window", () => {
    const p = placeBlock(17 * 60, 22 * 60, grid);
    expect(p.clipped).toBe(true);
    expect(p.topPercent + p.heightPercent).toBeLessThanOrEqual(100.001);
  });

  it("gives a zero-length block a clickable minimum height", () => {
    const p = placeBlock(9 * 60, 9 * 60, grid);
    expect(p.heightPercent).toBeGreaterThan(0);
  });

  it("tolerates a reversed range", () => {
    const a = placeBlock(10 * 60, 9 * 60, grid);
    const b = placeBlock(9 * 60, 10 * 60, grid);
    expect(a.topPercent).toBeCloseTo(b.topPercent, 5);
    expect(a.heightPercent).toBeCloseTo(b.heightPercent, 5);
  });

  it("never exceeds the column", () => {
    const p = placeBlock(0, 24 * 60, grid);
    expect(p.heightPercent).toBeLessThanOrEqual(100);
  });
});

describe("assignLanes", () => {
  it("keeps non-overlapping blocks in one lane", () => {
    const lanes = assignLanes([
      { id: "a", startMinutes: 540, endMinutes: 600 },
      { id: "b", startMinutes: 600, endMinutes: 660 },
    ]);
    expect(lanes.every((l) => l.lane === 0)).toBe(true);
    expect(lanes.every((l) => l.laneCount === 1)).toBe(true);
  });

  it("splits two overlapping blocks into side-by-side lanes", () => {
    const lanes = assignLanes([
      { id: "a", startMinutes: 540, endMinutes: 660 },
      { id: "b", startMinutes: 570, endMinutes: 630 },
    ]);
    expect(new Set(lanes.map((l) => l.lane))).toEqual(new Set([0, 1]));
    expect(lanes.every((l) => l.laneCount === 2)).toBe(true);
  });

  it("reuses a lane once the earlier block has ended", () => {
    const lanes = assignLanes([
      { id: "a", startMinutes: 540, endMinutes: 600 },
      { id: "b", startMinutes: 550, endMinutes: 610 },
      { id: "c", startMinutes: 605, endMinutes: 700 },
    ]);
    const byId = Object.fromEntries(lanes.map((l) => [l.id, l]));
    expect(byId.a!.lane).toBe(0);
    expect(byId.b!.lane).toBe(1);
    expect(byId.c!.lane).toBe(0);
  });

  it("scopes lane count per cluster, so one busy hour doesn't shrink the day", () => {
    const lanes = assignLanes([
      { id: "a", startMinutes: 540, endMinutes: 600 },
      { id: "b", startMinutes: 545, endMinutes: 600 },
      { id: "far", startMinutes: 900, endMinutes: 960 },
    ]);
    const byId = Object.fromEntries(lanes.map((l) => [l.id, l]));
    expect(byId.a!.laneCount).toBe(2);
    expect(byId.far!.laneCount).toBe(1);
  });

  it("handles an empty day", () => {
    expect(assignLanes([])).toEqual([]);
  });
});

describe("hours and instants", () => {
  it("computes decimal hours", () => {
    expect(hoursBetweenMinutes(540, 630)).toBe(1.5);
    expect(hoursBetweenMinutes(630, 540)).toBe(0);
    expect(hoursBetweenMinutes(540, 540)).toBe(0);
  });

  it("round-trips a wall-clock time through an instant for a negative offset", () => {
    // Winnipeg in summer is UTC-5, i.e. offset -300.
    const workDate = new Date(Date.UTC(2026, 7, 6));
    const instant = instantFor(workDate, 9 * 60, -300);
    expect(instant.toISOString()).toBe("2026-08-06T04:00:00.000Z");
    expect(minutesOf(instant, -300)).toBe(9 * 60);
  });

  it("round-trips for a positive offset", () => {
    const workDate = new Date(Date.UTC(2026, 7, 6));
    const instant = instantFor(workDate, 9 * 60, 330); // UTC+5:30
    expect(minutesOf(instant, 330)).toBe(9 * 60);
  });

  it("keeps a late-evening block on its own day", () => {
    const workDate = new Date(Date.UTC(2026, 7, 6));
    const instant = instantFor(workDate, 23 * 60, -300);
    expect(minutesOf(instant, -300)).toBe(23 * 60);
  });
});

describe("DEFAULT_GRID", () => {
  it("covers a working day", () => {
    expect(DEFAULT_GRID.startHour).toBeLessThan(DEFAULT_GRID.endHour);
    expect(daySlots().length).toBeGreaterThan(0);
  });
});
