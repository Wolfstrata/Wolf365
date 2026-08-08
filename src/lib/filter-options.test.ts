import { describe, it, expect } from "vitest";
import { filterOptions, matchScore, queryTerms } from "@/lib/filter-options";

const clients = [
  { id: "1", label: "Wolf Test" },
  { id: "2", label: "Grey Wolf Holdings" },
  { id: "3", label: "EG Penner Building Centres" },
  { id: "4", label: "McFadden Benefits" },
  { id: "5", label: "Wolfstrata" },
];

const labels = (rows: { label: string }[]) => rows.map((r) => r.label);

describe("queryTerms", () => {
  it("splits on whitespace and drops empties", () => {
    expect(queryTerms("  wolf   test ")).toEqual(["wolf", "test"]);
    expect(queryTerms("")).toEqual([]);
    expect(queryTerms("   ")).toEqual([]);
  });
});

describe("matchScore", () => {
  it("matches a substring, not just a prefix", () => {
    // The whole point: nobody types a company's legal first word.
    expect(matchScore({ id: "1", label: "EG Penner Building Centres" }, ["penner"])).toBe(3);
  });

  it("requires every term, so adding a word narrows", () => {
    const option = { id: "1", label: "Wolf Test" };
    expect(matchScore(option, ["wolf", "test"])).not.toBeNull();
    expect(matchScore(option, ["wolf", "nope"])).toBeNull();
  });

  it("ignores the order the terms were typed in", () => {
    const option = { id: "1", label: "Wolf Test" };
    expect(matchScore(option, ["test", "wolf"])).not.toBeNull();
  });

  it("scores by the earliest match, so a leading match wins", () => {
    const early = matchScore({ id: "1", label: "Wolf Test" }, ["wolf"])!;
    const late = matchScore({ id: "2", label: "Grey Wolf Holdings" }, ["wolf"])!;
    expect(early).toBeLessThan(late);
  });

  it("searches hidden keywords too", () => {
    const option = { id: "1", label: "Jane Doe", keywords: "jane@example.com" };
    expect(matchScore(option, ["example.com"])).not.toBeNull();
  });

  it("matches everything on an empty query", () => {
    expect(matchScore({ id: "1", label: "Anything" }, [])).toBe(0);
  });
});

describe("filterOptions", () => {
  it("narrows as the user types, the example from the request", () => {
    // W → o → l → f
    expect(labels(filterOptions(clients, "w"))).toContain("Wolf Test");
    const wolf = labels(filterOptions(clients, "wolf"));
    expect(wolf).toEqual(["Wolf Test", "Wolfstrata", "Grey Wolf Holdings"]);
    // Adding the second word gets to exactly one.
    expect(labels(filterOptions(clients, "wolf test"))).toEqual(["Wolf Test"]);
  });

  it("is case insensitive", () => {
    expect(labels(filterOptions(clients, "WOLF TEST"))).toEqual(["Wolf Test"]);
  });

  it("puts a leading match above a mid-string one", () => {
    const result = labels(filterOptions(clients, "wolf"));
    expect(result.indexOf("Wolf Test")).toBeLessThan(result.indexOf("Grey Wolf Holdings"));
  });

  it("breaks score ties alphabetically, so the order is stable", () => {
    const rows = [
      { id: "b", label: "Acme Two" },
      { id: "a", label: "Acme One" },
    ];
    expect(labels(filterOptions(rows, "acme"))).toEqual(["Acme One", "Acme Two"]);
    expect(labels(filterOptions([...rows].reverse(), "acme"))).toEqual([
      "Acme One",
      "Acme Two",
    ]);
  });

  it("returns everything for an empty query", () => {
    expect(filterOptions(clients, "")).toHaveLength(clients.length);
  });

  it("returns nothing when nothing matches", () => {
    expect(filterOptions(clients, "zzzz")).toEqual([]);
  });

  it("bounds the result so a two-thousand-client list stays fast", () => {
    const many = Array.from({ length: 500 }, (_, i) => ({
      id: String(i),
      label: `Client ${i}`,
    }));
    expect(filterOptions(many, "client", 20)).toHaveLength(20);
  });

  it("copes with an empty option list", () => {
    expect(filterOptions([], "wolf")).toEqual([]);
  });
});
