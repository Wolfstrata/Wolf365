import { describe, it, expect } from "vitest";
import {
  BOARD_SPECS,
  boardKeyFor,
  boardNameFor,
  boardSpecFor,
} from "@/lib/silverfang/boards";

describe("boardKeyFor", () => {
  it("routes project work to Projects", () => {
    expect(boardKeyFor({ hasProject: true })).toBe("PROJECTS");
  });

  it("routes agreement-covered work to MSA", () => {
    expect(boardKeyFor({ hasProject: false, agreementType: "MANAGED_SERVICES" })).toBe("MSA");
    expect(boardKeyFor({ hasProject: false, agreementType: "MANAGED_NOC" })).toBe("MSA");
    expect(boardKeyFor({ hasProject: false, agreementType: "BLOCK_TIME" })).toBe("MSA");
  });

  it("routes everything else to Service Desk", () => {
    expect(boardKeyFor({ hasProject: false })).toBe("SERVICE");
    expect(boardKeyFor({ hasProject: false, agreementType: null })).toBe("SERVICE");
    // An agreement type this build does not know about is ad-hoc work until
    // somebody says otherwise — better the catch-all than the wrong queue.
    expect(boardKeyFor({ hasProject: false, agreementType: "SOMETHING_NEW" })).toBe("SERVICE");
  });

  it("prefers Projects over MSA when both apply", () => {
    // A managed-services client's project work is still project work: scoped,
    // phased, and tracked against a project total. Filing it under MSA is how a
    // project quietly loses its hours.
    expect(boardKeyFor({ hasProject: true, agreementType: "MANAGED_SERVICES" })).toBe("PROJECTS");
  });
});

describe("BOARD_SPECS", () => {
  it("keeps the catch-all named Service Desk", () => {
    // It is the board that already exists on every install. Renaming it would
    // strand every ticket ever filed on a board nobody recognises.
    expect(boardSpecFor("SERVICE").name).toBe("Service Desk");
  });

  it("has three boards with unique names and keys", () => {
    expect(BOARD_SPECS).toHaveLength(3);
    expect(new Set(BOARD_SPECS.map((b) => b.name)).size).toBe(3);
    expect(new Set(BOARD_SPECS.map((b) => b.key)).size).toBe(3);
  });

  it("orders MSA, Projects, then Service Desk", () => {
    const ordered = [...BOARD_SPECS].sort((a, b) => a.sortOrder - b.sortOrder);
    expect(ordered.map((b) => b.key)).toEqual(["MSA", "PROJECTS", "SERVICE"]);
  });

  it("describes every board", () => {
    for (const spec of BOARD_SPECS) expect(spec.description).toBeTruthy();
  });
});

describe("boardNameFor", () => {
  it("names the board a ticket would land on", () => {
    expect(boardNameFor({ hasProject: true })).toBe("Projects");
    expect(boardNameFor({ hasProject: false, agreementType: "MANAGED_NOC" })).toBe("MSA");
    expect(boardNameFor({ hasProject: false })).toBe("Service Desk");
  });
});
