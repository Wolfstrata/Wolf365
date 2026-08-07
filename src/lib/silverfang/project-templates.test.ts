import { describe, it, expect } from "vitest";
import {
  dueDateFromOffset,
  formatTemplatePhases,
  formatTemplateTasks,
  formatTemplateTickets,
  parseTemplatePhases,
  parseTemplateTasks,
  parseTemplateTickets,
  projectToTemplateDraft,
  unknownPhaseNames,
} from "./project-templates";

describe("parseTemplateTasks", () => {
  it("parses a bare task name", () => {
    expect(parseTemplateTasks("Kickoff call")).toEqual({
      tasks: [{ phase: null, name: "Kickoff call", estimatedHours: null, dueOffsetDays: null }],
      errors: [],
    });
  });

  it("parses phase, name, hours and offset", () => {
    expect(parseTemplateTasks("Discovery | Kickoff call | 1.5 | 2").tasks).toEqual([
      { phase: "Discovery", name: "Kickoff call", estimatedHours: 1.5, dueOffsetDays: 2 },
    ]);
  });

  it("treats two columns as phase + name", () => {
    expect(parseTemplateTasks("Build | Rack the switch").tasks).toEqual([
      { phase: "Build", name: "Rack the switch", estimatedHours: null, dueOffsetDays: null },
    ]);
  });

  it("ignores blank lines and surrounding whitespace", () => {
    const r = parseTemplateTasks("\n  Discovery | Audit  \n\n   \nBuild | Install\n");
    expect(r.tasks.map((t) => t.name)).toEqual(["Audit", "Install"]);
    expect(r.errors).toEqual([]);
  });

  it("accepts a zero-day offset as meaning due on the start date", () => {
    expect(parseTemplateTasks("Kickoff | 1 | 0").tasks[0]).toEqual({
      phase: "Kickoff",
      name: "1",
      estimatedHours: 0,
      dueOffsetDays: null,
    });
    expect(parseTemplateTasks("Discovery | Audit | 2 | 0").tasks[0]!.dueOffsetDays).toBe(0);
  });

  it("reports a bad hours value with its line number, and drops the row", () => {
    const r = parseTemplateTasks("Discovery | Audit | soon");
    expect(r.tasks).toEqual([]);
    expect(r.errors[0]).toContain("Line 1");
    expect(r.errors[0]).toContain("soon");
  });

  it("rejects negative hours and fractional or out-of-range offsets", () => {
    expect(parseTemplateTasks("A | B | -1").errors).toHaveLength(1);
    expect(parseTemplateTasks("A | B | 1 | 1.5").errors).toHaveLength(1);
    expect(parseTemplateTasks("A | B | 1 | 99999").errors).toHaveLength(1);
  });

  it("reports a line whose name is missing", () => {
    // A leading separator leaves no name in either column.
    expect(parseTemplateTasks("|").errors).toHaveLength(1);
  });

  it("keeps good lines when another is bad, so one typo doesn't discard the lot", () => {
    const r = parseTemplateTasks("Discovery | Audit | 2\nBuild | Install | nope\nTest | Verify");
    expect(r.tasks.map((t) => t.name)).toEqual(["Audit", "Verify"]);
    expect(r.errors).toHaveLength(1);
  });

  it("handles empty input", () => {
    expect(parseTemplateTasks("")).toEqual({ tasks: [], errors: [] });
    expect(parseTemplateTasks(null)).toEqual({ tasks: [], errors: [] });
  });
});

describe("formatTemplateTasks", () => {
  it("round-trips a full task", () => {
    const line = "Discovery | Audit | 2 | 3";
    expect(formatTemplateTasks(parseTemplateTasks(line).tasks)).toBe(line);
  });

  it("drops trailing empty columns", () => {
    expect(formatTemplateTasks([{ name: "Kickoff call" }])).toBe("Kickoff call");
    expect(formatTemplateTasks([{ phase: "Build", name: "Install" }])).toBe("Build | Install");
  });

  it("round-trips a multi-line template", () => {
    const text = "Discovery | Audit | 2 | 1\nBuild | Install | 8 | 5\nHandover";
    expect(formatTemplateTasks(parseTemplateTasks(text).tasks)).toBe(text);
  });
});

describe("parseTemplatePhases", () => {
  it("parses a name and hours", () => {
    expect(parseTemplatePhases("Discovery | 8\nBuild | 40\nHandover")).toEqual({
      phases: [
        { name: "Discovery", hours: 8 },
        { name: "Build", hours: 40 },
        { name: "Handover", hours: null },
      ],
      errors: [],
    });
  });

  it("refuses duplicate names rather than deduping", () => {
    // Phase name is how tasks and tickets attach; two "Build" phases would put
    // half the work in the wrong place with no error.
    const result = parseTemplatePhases("Build | 8\nbuild | 4");
    expect(result.phases).toHaveLength(1);
    expect(result.errors[0]).toContain("already a phase called");
  });

  it("rejects bad hours and skips that line", () => {
    const result = parseTemplatePhases("Build | eight");
    expect(result.phases).toEqual([]);
    expect(result.errors[0]).toContain("not a valid number of hours");
  });

  it("ignores blank lines and handles empty input", () => {
    expect(parseTemplatePhases("\n  \nBuild\n").phases).toEqual([
      { name: "Build", hours: null },
    ]);
    expect(parseTemplatePhases(null)).toEqual({ phases: [], errors: [] });
  });

  it("round-trips through the formatter", () => {
    const text = "Discovery | 8\nBuild | 40\nHandover";
    expect(formatTemplatePhases(parseTemplatePhases(text).phases)).toBe(text);
  });
});

describe("parseTemplateTickets", () => {
  it("parses phase, summary, priority and hours", () => {
    expect(parseTemplateTickets("Build | Rack the switch | P2 | 4").tickets).toEqual([
      { phase: "Build", summary: "Rack the switch", priority: "P2", estimatedHours: 4 },
    ]);
  });

  it("treats a single column as a bare summary", () => {
    expect(parseTemplateTickets("Kickoff call").tickets).toEqual([
      { phase: null, summary: "Kickoff call", priority: "P3", estimatedHours: null },
    ]);
  });

  it("defaults priority to P3 and accepts lower case", () => {
    expect(parseTemplateTickets("Build | Install | | 2").tickets[0]!.priority).toBe("P3");
    expect(parseTemplateTickets("Build | Install | p1").tickets[0]!.priority).toBe("P1");
  });

  it("rejects an unknown priority", () => {
    const result = parseTemplateTickets("Build | Install | URGENT");
    expect(result.tickets).toEqual([]);
    expect(result.errors[0]).toContain("is not a priority");
  });

  it("rejects bad hours", () => {
    expect(parseTemplateTickets("Build | Install | P2 | -3").errors[0]).toContain(
      "not a valid number of hours",
    );
  });

  it("round-trips through the formatter", () => {
    const text = "Build | Rack the switch | P2 | 4";
    expect(formatTemplateTickets(parseTemplateTickets(text).tickets)).toBe(text);
  });

  it("always writes the priority column so hours cannot be misread", () => {
    // Without the placeholder, "Install | 2" would re-parse 2 as the priority.
    const line = formatTemplateTickets([{ summary: "Install", estimatedHours: 2 }]);
    expect(parseTemplateTickets(line).tickets[0]).toEqual({
      phase: null,
      summary: "Install",
      priority: "P3",
      estimatedHours: 2,
    });
  });
});

describe("unknownPhaseNames", () => {
  it("lists referenced phases no phase provides", () => {
    expect(
      unknownPhaseNames([{ name: "Build" }], [{ phase: "Build" }, { phase: "Handover" }]),
    ).toEqual(["Handover"]);
  });

  it("matches case-insensitively and ignores blanks", () => {
    expect(
      unknownPhaseNames([{ name: "Build" }], [{ phase: "build" }, { phase: null }, {}]),
    ).toEqual([]);
  });

  it("reports each missing name once", () => {
    expect(unknownPhaseNames([], [{ phase: "X" }, { phase: "X" }])).toEqual(["X"]);
  });
});

describe("projectToTemplateDraft", () => {
  const start = new Date("2026-03-01T00:00:00Z");

  it("keeps the shape and drops what makes a project specific", () => {
    const draft = projectToTemplateDraft({
      startDate: start,
      billingType: "FIXED_FEE",
      contractedHours: 40,
      estimatedHours: 44,
      fixedFeeAmount: 12_000,
      billingIntervalDays: 30,
      depositPercent: 25,
      phases: [
        { name: "Build", hours: 30, sortOrder: 20 },
        { name: "Discovery", hours: 10, sortOrder: 10 },
      ],
      tasks: [{ name: "Audit", phaseName: "Discovery", dueDate: new Date("2026-03-06T00:00:00Z") }],
      tickets: [{ summary: "Rack the switch", phaseName: "Build", priority: "P2" }],
    });

    // Sorted by sortOrder, not by the order they came out of the database.
    expect(draft.phases.map((p) => p.name)).toEqual(["Discovery", "Build"]);
    // Dates became offsets — that is what makes the template reusable.
    expect(draft.tasks[0]!.dueOffsetDays).toBe(5);
    expect(draft.tickets[0]).toEqual({
      phase: "Build",
      summary: "Rack the switch",
      priority: "P2",
      estimatedHours: null,
    });
    expect(draft.shape).toEqual({
      billingType: "FIXED_FEE",
      contractedHours: 40,
      estimatedHours: 44,
      fixedFeeAmount: 12_000,
      billingIntervalDays: 30,
      depositPercent: 25,
    });
    // Nothing client-specific survived.
    expect(JSON.stringify(draft)).not.toContain("clientId");
  });

  it("leaves offsets null when the project has no start date", () => {
    const draft = projectToTemplateDraft({
      startDate: null,
      billingType: "TIME_AND_MATERIALS",
      phases: [],
      tasks: [{ name: "Audit", dueDate: new Date("2026-03-06T00:00:00Z") }],
    });
    expect(draft.tasks[0]!.dueOffsetDays).toBeNull();
  });

  it("floors a task dated before the project start at day 0", () => {
    const draft = projectToTemplateDraft({
      startDate: start,
      billingType: "TIME_AND_MATERIALS",
      phases: [],
      tasks: [{ name: "Pre-work", dueDate: new Date("2026-02-01T00:00:00Z") }],
    });
    expect(draft.tasks[0]!.dueOffsetDays).toBe(0);
  });

  it("falls back to the legacy free-text phase on a task", () => {
    const draft = projectToTemplateDraft({
      startDate: start,
      billingType: "TIME_AND_MATERIALS",
      phases: [{ name: "Build" }],
      tasks: [{ name: "Install", phase: "Build" }],
    });
    expect(draft.tasks[0]!.phase).toBe("Build");
  });

  it("normalises an unrecognised ticket priority to P3", () => {
    const draft = projectToTemplateDraft({
      startDate: start,
      billingType: "TIME_AND_MATERIALS",
      phases: [],
      tasks: [],
      tickets: [{ summary: "Thing", priority: "WHATEVER" }],
    });
    expect(draft.tickets[0]!.priority).toBe("P3");
  });

  it("handles a project with nothing in it", () => {
    const draft = projectToTemplateDraft({
      billingType: "TIME_AND_MATERIALS",
      phases: [],
      tasks: [],
    });
    expect(draft).toMatchObject({ phases: [], tasks: [], tickets: [] });
  });
});

describe("dueDateFromOffset", () => {
  it("resolves an offset against a start date", () => {
    expect(dueDateFromOffset(new Date("2026-03-01T00:00:00Z"), 5)?.toISOString()).toBe(
      "2026-03-06T00:00:00.000Z",
    );
  });

  it("returns null for no offset", () => {
    expect(dueDateFromOffset(new Date("2026-03-01T00:00:00Z"), null)).toBeNull();
  });
});
