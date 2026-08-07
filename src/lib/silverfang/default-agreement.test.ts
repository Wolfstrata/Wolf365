import { describe, it, expect } from "vitest";
import {
  describeDefaultAgreement,
  pickDefaultAgreement,
  type AgreementChoice,
} from "@/lib/silverfang/default-agreement";

const now = new Date("2026-08-07T12:00:00Z");

function agreement(over: Partial<AgreementChoice> & { id: string }): AgreementChoice {
  return {
    type: "MANAGED_SERVICES",
    status: "ACTIVE",
    startDate: new Date("2026-01-01T00:00:00Z"),
    endDate: new Date("2027-01-01T00:00:00Z"),
    ...over,
  };
}

describe("pickDefaultAgreement", () => {
  it("picks the client's managed services agreement", () => {
    const pick = pickDefaultAgreement([agreement({ id: "msa" })], { now });
    expect(pick).toEqual({ id: "msa", reason: "managed-services" });
  });

  it("never picks block time", () => {
    // Prepaid hours must not be spent because nothing else matched.
    const pick = pickDefaultAgreement([agreement({ id: "block", type: "BLOCK_TIME" })], {
      now,
    });
    expect(pick).toBeNull();
  });

  it("prefers managed services over managed NOC", () => {
    const pick = pickDefaultAgreement(
      [agreement({ id: "noc", type: "MANAGED_NOC" }), agreement({ id: "msa" })],
      { now },
    );
    expect(pick?.id).toBe("msa");
  });

  it("falls back to managed NOC when that is all there is", () => {
    const pick = pickDefaultAgreement([agreement({ id: "noc", type: "MANAGED_NOC" })], {
      now,
    });
    expect(pick).toEqual({ id: "noc", reason: "managed-noc" });
  });

  it("honours the client's configured default over the type order", () => {
    const pick = pickDefaultAgreement(
      [agreement({ id: "msa" }), agreement({ id: "block", type: "BLOCK_TIME" })],
      { profileDefaultId: "block", now },
    );
    // Somebody chose it. This function fills a gap; it does not overrule a choice.
    expect(pick).toEqual({ id: "block", reason: "profile" });
  });

  it("ignores a configured default that is no longer usable", () => {
    const pick = pickDefaultAgreement(
      [agreement({ id: "old", status: "EXPIRED" }), agreement({ id: "msa" })],
      { profileDefaultId: "old", now },
    );
    expect(pick).toEqual({ id: "msa", reason: "managed-services" });
  });

  it("skips agreements that are not active", () => {
    for (const status of ["DRAFT", "EXPIRED", "CANCELLED"]) {
      expect(
        pickDefaultAgreement([agreement({ id: "a", status })], { now }),
        status,
      ).toBeNull();
    }
  });

  it("skips a term that has not started or has ended", () => {
    expect(
      pickDefaultAgreement(
        [agreement({ id: "future", startDate: new Date("2026-09-01T00:00:00Z") })],
        { now },
      ),
    ).toBeNull();
    expect(
      pickDefaultAgreement(
        [agreement({ id: "past", endDate: new Date("2026-07-01T00:00:00Z") })],
        { now },
      ),
    ).toBeNull();
  });

  it("accepts an open-ended term", () => {
    const pick = pickDefaultAgreement(
      [agreement({ id: "open", endDate: null, startDate: null })],
      { now },
    );
    expect(pick?.id).toBe("open");
  });

  it("picks the most recently started term when a client has two", () => {
    const pick = pickDefaultAgreement(
      [
        agreement({ id: "old", startDate: new Date("2024-01-01T00:00:00Z") }),
        agreement({ id: "current", startDate: new Date("2026-01-01T00:00:00Z") }),
      ],
      { now },
    );
    expect(pick?.id).toBe("current");
  });

  it("is deterministic when two terms start on the same day", () => {
    const rows = [agreement({ id: "b" }), agreement({ id: "a" })];
    expect(pickDefaultAgreement(rows, { now })?.id).toBe("a");
    expect(pickDefaultAgreement([...rows].reverse(), { now })?.id).toBe("a");
  });

  it("returns null for a client with no agreements", () => {
    expect(pickDefaultAgreement([], { now })).toBeNull();
  });

  it("treats a missing status as usable", () => {
    // Callers that already filtered to ACTIVE need not restate it.
    const pick = pickDefaultAgreement([{ id: "a", type: "MANAGED_SERVICES" }], { now });
    expect(pick?.id).toBe("a");
  });
});

describe("describeDefaultAgreement", () => {
  it("explains every reason", () => {
    expect(describeDefaultAgreement("profile")).toContain("configured default");
    expect(describeDefaultAgreement("managed-services")).toContain("managed services");
    expect(describeDefaultAgreement("managed-noc")).toContain("managed NOC");
  });
});
