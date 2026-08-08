import { describe, it, expect } from "vitest";
import {
  describeImport,
  importAction,
  mapPriority,
  matchStatus,
  matchTechnician,
  summaryFrom,
  type ImportCounts,
  type StatusOption,
} from "@/lib/silverfang/ticket-import";

describe("mapPriority", () => {
  it("maps the obvious words", () => {
    expect(mapPriority("Critical")).toBe("P1");
    expect(mapPriority("Urgent")).toBe("P1");
    expect(mapPriority("High")).toBe("P2");
    expect(mapPriority("Low")).toBe("P4");
  });

  it("passes through explicit P-codes", () => {
    for (const p of ["P1", "p2", "P4"] as const) {
      expect(mapPriority(p)).toBe(p.toUpperCase());
    }
  });

  it("falls back to P3 rather than dropping the ticket", () => {
    // A slightly wrong priority is recoverable; a missing ticket is not.
    expect(mapPriority("Whatever")).toBe("P3");
    expect(mapPriority(null)).toBe("P3");
    expect(mapPriority("")).toBe("P3");
  });
});

const statuses: StatusOption[] = [
  { id: "new", name: "New", isDefault: true, isClosed: false },
  { id: "prog", name: "In Progress", isDefault: false, isClosed: false },
  { id: "closed", name: "Closed", isDefault: false, isClosed: true },
];

describe("matchStatus", () => {
  it("matches an exact name, ignoring case and punctuation", () => {
    expect(matchStatus("In Progress", statuses)).toEqual({ statusId: "prog", via: "name" });
    expect(matchStatus("in-progress", statuses)?.statusId).toBe("prog");
  });

  it("lands a closed-sounding source status on a closed one", () => {
    // Getting the open/closed side right matters more than the label: finished
    // work arriving open goes back into somebody's queue.
    for (const name of ["Resolved", "Completed", "Cancelled", "Done"]) {
      expect(matchStatus(name, statuses)?.statusId, name).toBe("closed");
    }
    expect(matchStatus("Resolved", statuses)?.via).toBe("closed");
  });

  it("falls back to the open default for anything unrecognised", () => {
    const m = matchStatus("Awaiting Vendor", statuses);
    expect(m).toEqual({ statusId: "new", via: "open-default" });
  });

  it("never picks a closed status as the fallback", () => {
    const withClosedDefault: StatusOption[] = [
      { id: "c", name: "Closed", isDefault: true, isClosed: true },
      { id: "o", name: "Open", isDefault: false, isClosed: false },
    ];
    expect(matchStatus("Mystery", withClosedDefault)?.statusId).toBe("o");
  });

  it("uses whatever exists when every status is closed", () => {
    const allClosed: StatusOption[] = [
      { id: "c", name: "Closed", isDefault: true, isClosed: true },
    ];
    expect(matchStatus("Mystery", allClosed)).toEqual({ statusId: "c", via: "default" });
  });

  it("returns null only when the board has no statuses", () => {
    expect(matchStatus("New", [])).toBeNull();
  });

  it("handles a missing source status", () => {
    expect(matchStatus(null, statuses)?.statusId).toBe("new");
  });
});

describe("importAction", () => {
  it("creates when there is nothing here yet", () => {
    expect(importAction({ existing: null, overwrite: false })).toBe("create");
    expect(importAction({ existing: null, overwrite: true })).toBe("create");
  });

  it("skips an existing ticket when overwrite is off", () => {
    // The safe answer, and the default.
    expect(
      importAction({ existing: { id: "t", closedAt: null }, overwrite: false }),
    ).toBe("skip");
  });

  it("overwrites an open existing ticket when overwrite is on", () => {
    expect(
      importAction({ existing: { id: "t", closedAt: null }, overwrite: true }),
    ).toBe("overwrite");
  });

  it("never reopens a ticket somebody closed here, even with overwrite on", () => {
    // Reopening finished work is a change nobody asked for; a stale source is the
    // likelier explanation.
    expect(
      importAction({ existing: { id: "t", closedAt: new Date() }, overwrite: true }),
    ).toBe("skip");
  });
});

describe("matchTechnician", () => {
  const users = [
    { id: "u1", name: "Sam Jones", email: "sam@wolfstrata.com" },
    { id: "u2", name: "Jo Blake", email: "jo@wolfstrata.com" },
    { id: "u3", name: "Sam Jones", email: "sam.jones@wolfstrata.com" },
  ];

  it("matches a unique display name", () => {
    expect(matchTechnician("Jo Blake", users)).toBe("u2");
  });

  it("refuses an ambiguous name rather than guessing", () => {
    // Two Sam Joneses: assigning to the wrong one is worse than leaving it blank.
    expect(matchTechnician("Sam Jones", users)).toBeNull();
  });

  it("matches a full address or its local part", () => {
    expect(matchTechnician("jo@wolfstrata.com", users)).toBe("u2");
    expect(matchTechnician("jo", users)).toBe("u2");
  });

  it("returns null for nobody and for no input", () => {
    expect(matchTechnician("Nobody Here", users)).toBeNull();
    expect(matchTechnician(null, users)).toBeNull();
    expect(matchTechnician("  ", users)).toBeNull();
  });
});

describe("summaryFrom", () => {
  it("uses the subject, collapsed", () => {
    expect(summaryFrom("  Salesforce   not working ", null)).toBe("Salesforce not working");
  });

  it("never leaves it blank", () => {
    expect(summaryFrom("", "SO-42")).toBe("Imported ticket SO-42");
    expect(summaryFrom(null, null)).toBe("Imported ticket (no subject)");
  });

  it("bounds the length to the column", () => {
    expect(summaryFrom("x".repeat(500), null)).toHaveLength(300);
  });
});

describe("describeImport", () => {
  const base: ImportCounts = {
    available: 10,
    created: 4,
    overwritten: 0,
    skippedExisting: 6,
    skippedClosed: 0,
    skippedNoClient: 0,
    truncated: false,
  };

  it("says nothing was stored when the sync has not run", () => {
    expect(describeImport({ ...base, available: 0 }, false)).toContain(
      "run the SuperOps ticket sync first",
    );
  });

  it("offers the overwrite re-run when rows were left alone", () => {
    const text = describeImport(base, false);
    expect(text).toContain("6 left as they are");
    expect(text).toContain("overwrite on");
  });

  it("reports overwrites when overwrite was on", () => {
    const text = describeImport({ ...base, overwritten: 6, skippedExisting: 0 }, true);
    expect(text).toContain("6 overwritten");
    expect(text).not.toContain("overwrite on to refresh");
  });

  it("names the closed and unlinked skips", () => {
    const text = describeImport({ ...base, skippedClosed: 2, skippedNoClient: 3 }, true);
    expect(text).toContain("2 skipped (closed here)");
    expect(text).toContain("3 skipped (client not linked)");
    expect(text).toContain("Clients page");
  });

  it("says when the run was truncated", () => {
    expect(describeImport({ ...base, truncated: true }, false)).toContain("run it again");
  });
});
