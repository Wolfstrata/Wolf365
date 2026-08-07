import { describe, it, expect } from "vitest";
import {
  blockingReasons,
  checkAuthorized,
  normalizeTechIds,
  restrictionLabel,
  type Restriction,
} from "@/lib/silverfang/authorized-techs";

const agreement = (ids: string[]): Restriction => ({
  authorizedUserIds: ids,
  kind: "agreement",
  name: "Acme block time",
});

describe("checkAuthorized", () => {
  it("allows everyone when no techs are named", () => {
    // The single most important case: shipping this feature must not lock the
    // whole team out of every existing agreement.
    const v = checkAuthorized(agreement([]), "u1");
    expect(v).toEqual({ allowed: true, restricted: false, reason: null });
  });

  it("allows a named tech", () => {
    const v = checkAuthorized(agreement(["u1", "u2"]), "u2");
    expect(v.allowed).toBe(true);
    // Still flagged restricted, so the list view can say so.
    expect(v.restricted).toBe(true);
  });

  it("refuses anyone not named", () => {
    const v = checkAuthorized(agreement(["u1"]), "u9");
    expect(v.allowed).toBe(false);
    expect(v.restricted).toBe(true);
    expect(v.reason).toContain("Acme block time");
    expect(v.reason).toContain("authorised technicians");
    // Tells them they can still read it, which is the point of the design.
    expect(v.reason).toContain("read everything");
  });

  it("refuses an anonymous or missing user on a restricted record", () => {
    expect(checkAuthorized(agreement(["u1"]), null).allowed).toBe(false);
    expect(checkAuthorized(agreement(["u1"]), undefined).allowed).toBe(false);
    expect(checkAuthorized(agreement(["u1"]), "").allowed).toBe(false);
  });

  it("still allows an anonymous user when unrestricted", () => {
    expect(checkAuthorized(agreement([]), null).allowed).toBe(true);
  });

  it("says project when it is a project", () => {
    const v = checkAuthorized(
      { authorizedUserIds: ["u1"], kind: "project", name: "Server refresh" },
      "u9",
    );
    expect(v.reason).toContain("project");
    expect(v.reason).not.toContain("agreement");
  });
});

describe("restrictionLabel", () => {
  it("says nothing for an unrestricted record", () => {
    expect(restrictionLabel(checkAuthorized(agreement([]), "u1"))).toBeNull();
  });

  it("distinguishes authorised from view-only", () => {
    expect(restrictionLabel(checkAuthorized(agreement(["u1"]), "u1"))).toBe(
      "Restricted — you're authorised",
    );
    expect(restrictionLabel(checkAuthorized(agreement(["u1"]), "u9"))).toBe(
      "Restricted — view only",
    );
  });
});

describe("blockingReasons", () => {
  it("returns nothing when everything allows", () => {
    expect(blockingReasons([agreement([]), agreement(["u1"])], "u1")).toEqual([]);
  });

  it("reports every blocker at once, not just the first", () => {
    const reasons = blockingReasons(
      [
        agreement(["u1"]),
        { authorizedUserIds: ["u2"], kind: "project", name: "Server refresh" },
      ],
      "u9",
    );
    expect(reasons).toHaveLength(2);
    expect(reasons[0]).toContain("Acme block time");
    expect(reasons[1]).toContain("Server refresh");
  });

  it("handles an empty restriction set", () => {
    expect(blockingReasons([], "u1")).toEqual([]);
  });
});

describe("normalizeTechIds", () => {
  it("drops blanks and duplicates", () => {
    // A select that posts an empty option, or the same tech twice, would otherwise
    // collide on the composite primary key.
    expect(normalizeTechIds(["u1", "", "u1", "  ", null, undefined, "u2"])).toEqual([
      "u1",
      "u2",
    ]);
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeTechIds([" u1 "])).toEqual(["u1"]);
  });

  it("returns an empty list for nothing selected", () => {
    expect(normalizeTechIds([])).toEqual([]);
    expect(normalizeTechIds(["", null])).toEqual([]);
  });
});
