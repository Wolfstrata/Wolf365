import { describe, it, expect } from "vitest";
import {
  addAssignees,
  assigneeSummary,
  describeAssignment,
  normalizeAssigneeIds,
  resolveAssignment,
} from "@/lib/silverfang/assignees";

describe("normalizeAssigneeIds", () => {
  it("drops blanks and duplicates, keeping first-seen order", () => {
    expect(normalizeAssigneeIds(["b", "", "a", "b", null, "  ", undefined, " a "])).toEqual([
      "b",
      "a",
    ]);
  });
});

describe("resolveAssignment", () => {
  it("assigns from nobody", () => {
    const c = resolveAssignment({ current: [], currentPrimary: null, requested: ["u1"] });
    expect(c.userIds).toEqual(["u1"]);
    expect(c.primaryId).toBe("u1");
    expect(c.added).toEqual(["u1"]);
    expect(c.changed).toBe(true);
  });

  it("adds a second person without dropping the first", () => {
    // The whole point of the feature. Losing the first assignee here would be
    // data loss dressed up as a UI detail.
    const c = resolveAssignment({
      current: ["u1"],
      currentPrimary: "u1",
      requested: ["u1", "u2"],
    });
    expect(c.userIds).toEqual(["u1", "u2"]);
    expect(c.removed).toEqual([]);
    expect(c.added).toEqual(["u2"]);
  });

  it("keeps the existing primary rather than resetting it", () => {
    // The primary is who gets notified; moving it because somebody else was
    // added would silently redirect the alerts.
    const c = resolveAssignment({
      current: ["u1"],
      currentPrimary: "u1",
      requested: ["u2", "u1"],
    });
    expect(c.primaryId).toBe("u1");
    expect(c.userIds).toEqual(["u1", "u2"]);
  });

  it("moves the primary when the old one is removed", () => {
    const c = resolveAssignment({
      current: ["u1", "u2"],
      currentPrimary: "u1",
      requested: ["u2"],
    });
    expect(c.primaryId).toBe("u2");
    expect(c.removed).toEqual(["u1"]);
  });

  it("unassigns completely", () => {
    const c = resolveAssignment({ current: ["u1"], currentPrimary: "u1", requested: [] });
    expect(c.userIds).toEqual([]);
    expect(c.primaryId).toBeNull();
    expect(c.removed).toEqual(["u1"]);
    expect(c.changed).toBe(true);
  });

  it("reports no change when the set is identical", () => {
    const c = resolveAssignment({
      current: ["u1", "u2"],
      currentPrimary: "u1",
      requested: ["u1", "u2"],
    });
    expect(c.changed).toBe(false);
    expect(c.added).toEqual([]);
    expect(c.removed).toEqual([]);
  });

  it("reports no change for an already-empty ticket", () => {
    expect(resolveAssignment({ current: [], currentPrimary: null, requested: [] }).changed).toBe(
      false,
    );
  });

  it("ignores duplicates in the request", () => {
    const c = resolveAssignment({
      current: [],
      currentPrimary: null,
      requested: ["u1", "u1", "u2"],
    });
    expect(c.userIds).toEqual(["u1", "u2"]);
  });
});

describe("addAssignees", () => {
  it("is strictly additive", () => {
    const c = addAssignees({ current: ["u1", "u2"], currentPrimary: "u1", add: ["u3"] });
    expect(c.userIds).toEqual(["u1", "u2", "u3"]);
    expect(c.removed).toEqual([]);
  });

  it("cannot drop anyone even when handed a shorter list", () => {
    // A stale page listing one assignee must not unassign the other two.
    const c = addAssignees({ current: ["u1", "u2", "u3"], currentPrimary: "u1", add: ["u1"] });
    expect(c.userIds).toEqual(["u1", "u2", "u3"]);
    expect(c.changed).toBe(false);
  });

  it("is a no-op when the person is already assigned", () => {
    expect(
      addAssignees({ current: ["u1"], currentPrimary: "u1", add: ["u1"] }).changed,
    ).toBe(false);
  });
});

describe("assigneeSummary", () => {
  it("says unassigned for nobody", () => {
    expect(assigneeSummary([])).toBe("Unassigned");
  });

  it("names one or two in full", () => {
    expect(assigneeSummary(["Sam"])).toBe("Sam");
    expect(assigneeSummary(["Sam", "Jo"])).toBe("Sam, Jo");
  });

  it("collapses three or more so a cell stays one line", () => {
    expect(assigneeSummary(["Sam", "Jo", "Alex"])).toBe("Sam, Jo +1");
    expect(assigneeSummary(["Sam", "Jo", "Alex", "Kim"])).toBe("Sam, Jo +2");
  });
});

describe("describeAssignment", () => {
  const nameOf = (id: string) => ({ u1: "Sam", u2: "Jo" })[id] ?? id;

  it("names who was added and who was removed", () => {
    const c = resolveAssignment({ current: ["u1"], currentPrimary: "u1", requested: ["u2"] });
    expect(describeAssignment(c, nameOf)).toBe("added Jo; removed Sam");
  });

  it("says nothing changed when nothing did", () => {
    const c = resolveAssignment({ current: ["u1"], currentPrimary: "u1", requested: ["u1"] });
    expect(describeAssignment(c, nameOf)).toBe("no assignee change");
  });
});
