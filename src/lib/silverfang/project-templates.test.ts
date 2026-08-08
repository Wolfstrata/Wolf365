import { describe, it, expect } from "vitest";
import {
  formatTemplatePhases,
  formatTemplateTickets,
  parseTemplatePhases,
  parseTemplateTickets,
  projectToTemplateDraft,
  unknownPhaseNames,
} from "./project-templates";

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
    // Phase name is how tickets attach; two "Build" phases would put half the
    // work in the wrong place with no error.
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
      tickets: [{ summary: "Rack the switch", phaseName: "Build", priority: "P2" }],
    });

    // Sorted by sortOrder, not by the order they came out of the database.
    expect(draft.phases.map((p) => p.name)).toEqual(["Discovery", "Build"]);
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

  it("normalises an unrecognised ticket priority to P3", () => {
    const draft = projectToTemplateDraft({
      startDate: start,
      billingType: "TIME_AND_MATERIALS",
      phases: [],
      tickets: [{ summary: "Thing", priority: "WHATEVER" }],
    });
    expect(draft.tickets[0]!.priority).toBe("P3");
  });

  it("handles a project with nothing in it", () => {
    const draft = projectToTemplateDraft({
      billingType: "TIME_AND_MATERIALS",
      phases: [],
    });
    expect(draft).toMatchObject({ phases: [], tickets: [] });
  });
});
