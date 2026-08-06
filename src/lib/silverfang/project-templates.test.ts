import { describe, it, expect } from "vitest";
import { formatTemplateTasks, parseTemplateTasks } from "./project-templates";

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
