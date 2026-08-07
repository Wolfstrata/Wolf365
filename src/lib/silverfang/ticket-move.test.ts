import { describe, it, expect } from "vitest";
import {
  canJoinProject,
  mapStatusToBoard,
  summarizeMove,
  type StatusLike,
} from "@/lib/silverfang/ticket-move";

function s(over: Partial<StatusLike> & { id: string; name: string }): StatusLike {
  return {
    isOpen: true,
    isClosed: false,
    isDefault: false,
    stopsSlaClock: false,
    sortOrder: 10,
    ...over,
  };
}

/** The default flow every seeded board gets. */
const target: StatusLike[] = [
  s({ id: "t-new", name: "New", isDefault: true, sortOrder: 10 }),
  s({ id: "t-prog", name: "In Progress", sortOrder: 30 }),
  s({ id: "t-wait", name: "Waiting on Client", stopsSlaClock: true, sortOrder: 40 }),
  s({ id: "t-res", name: "Resolved", isOpen: false, isClosed: true, sortOrder: 70 }),
  s({ id: "t-closed", name: "Closed", isOpen: false, isClosed: true, sortOrder: 80 }),
];

describe("mapStatusToBoard", () => {
  it("prefers the same status name", () => {
    // Boards seeded from the same defaults share names, so this is the common case
    // and it preserves exactly where the ticket was.
    const m = mapStatusToBoard(s({ id: "a", name: "In Progress", sortOrder: 30 }), target);
    expect(m).toEqual({ statusId: "t-prog", via: "name" });
  });

  it("matches a name case- and whitespace-insensitively", () => {
    const m = mapStatusToBoard(s({ id: "a", name: "  in progress " }), target);
    expect(m?.statusId).toBe("t-prog");
  });

  it("keeps a closed ticket closed", () => {
    // The one that matters most: reopening a batch of closed tickets restarts
    // their SLA clocks and puts them back in the queue.
    const m = mapStatusToBoard(
      s({ id: "a", name: "Done", isOpen: false, isClosed: true }),
      target,
    );
    expect(m?.via).toBe("closed-equivalent");
    // Resolved, not Closed — the less final of the two.
    expect(m?.statusId).toBe("t-res");
  });

  it("refuses rather than reopening when the target has no closed status", () => {
    const openOnly = target.filter((x) => !x.isClosed);
    const m = mapStatusToBoard(
      s({ id: "a", name: "Done", isOpen: false, isClosed: true }),
      openOnly,
    );
    expect(m).toBeNull();
  });

  it("keeps a paused ticket paused", () => {
    const m = mapStatusToBoard(
      s({ id: "a", name: "Awaiting Customer", stopsSlaClock: true }),
      target,
    );
    expect(m).toEqual({ statusId: "t-wait", via: "paused-equivalent" });
  });

  it("falls back to the default for an open ticket with no match", () => {
    const m = mapStatusToBoard(s({ id: "a", name: "Triage" }), target);
    expect(m).toEqual({ statusId: "t-new", via: "default" });
  });

  it("resumes a paused ticket when the target cannot pause, rather than refusing", () => {
    // Visible and recoverable, unlike a closed ticket reopening.
    const noPause = target.filter((x) => !x.stopsSlaClock);
    const m = mapStatusToBoard(
      s({ id: "a", name: "Awaiting Customer", stopsSlaClock: true }),
      noPause,
    );
    expect(m?.via).toBe("default");
  });

  it("returns null for a board with no statuses", () => {
    expect(mapStatusToBoard(s({ id: "a", name: "New" }), [])).toBeNull();
  });

  it("uses the lowest-sorted open status when none is marked default", () => {
    const noDefault = [
      s({ id: "x", name: "Later", sortOrder: 50 }),
      s({ id: "y", name: "Sooner", sortOrder: 20 }),
    ];
    expect(mapStatusToBoard(s({ id: "a", name: "Triage" }), noDefault)?.statusId).toBe("y");
  });
});

describe("canJoinProject", () => {
  const ticket = { clientId: "c1", projectId: null };

  it("allows a project on the same client", () => {
    expect(canJoinProject(ticket, { id: "p1", clientId: "c1" })).toBeNull();
  });

  it("refuses a project on a different client", () => {
    // Its hours would land on somebody else's total. Refused rather than
    // reassigning the ticket's client, which would be a far bigger change.
    expect(canJoinProject(ticket, { id: "p1", clientId: "c2" })).toBe("different-client");
  });

  it("refuses a phase from another project", () => {
    expect(
      canJoinProject(ticket, { id: "p1", clientId: "c1" }, { projectId: "p2" }),
    ).toBe("phase-not-in-project");
  });

  it("reports a no-op move", () => {
    expect(canJoinProject({ clientId: "c1", projectId: "p1" }, { id: "p1", clientId: "c1" })).toBe(
      "same-project",
    );
  });

  it("allows re-targeting a phase within the project the ticket is already on", () => {
    // Moving between phases of the same project is a real move, not a no-op.
    expect(
      canJoinProject(
        { clientId: "c1", projectId: "p1" },
        { id: "p1", clientId: "c1" },
        { projectId: "p1" },
      ),
    ).toBeNull();
  });
});

describe("summarizeMove", () => {
  it("reports a clean move", () => {
    expect(summarizeMove(3, [])).toBe("3 tickets moved.");
    expect(summarizeMove(1, [])).toBe("1 ticket moved.");
  });

  it("groups refusals by reason rather than listing each", () => {
    const line = summarizeMove(2, [
      { number: 10, reason: "different-client" },
      { number: 11, reason: "different-client" },
      { number: 12, reason: "same-board" },
    ]);
    expect(line).toContain("2 tickets moved");
    expect(line).toContain("2 skipped — belongs to a different client (#10, #11)");
    expect(line).toContain("1 skipped — already on that board (#12)");
  });

  it("truncates a long list of ticket numbers", () => {
    const refusals = Array.from({ length: 9 }, (_, i) => ({
      number: 100 + i,
      reason: "same-board" as const,
    }));
    const line = summarizeMove(0, refusals);
    expect(line).toContain("9 skipped");
    expect(line).toContain("and 4 more");
  });

  it("never claims a move it did not make", () => {
    expect(summarizeMove(0, [{ number: 7, reason: "not-found" }])).toContain("0 tickets moved");
  });
});
