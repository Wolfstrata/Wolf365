import { describe, it, expect } from "vitest";
import { computeAmount, resolveRate, type RateRuleLike } from "@/lib/silverfang/rates";

const CLIENT = "client-1";
const CODE = "code-remote";
const AGREEMENT = "agr-1";

const base = {
  clientId: CLIENT,
  chargeCodeId: CODE,
  timeBand: "DAY" as const,
};

const globalRule: RateRuleLike = {
  scope: "GLOBAL",
  timeBand: "ANY",
  fixedRate: 150,
  active: true,
};

describe("resolveRate precedence", () => {
  it("falls back to the global rule", () => {
    const r = resolveRate({ ...base, rules: [globalRule] });
    expect(r).toMatchObject({ rate: 150, source: "fixed", scope: "GLOBAL" });
  });

  it("prefers client over service over global", () => {
    const rules: RateRuleLike[] = [
      globalRule,
      { scope: "SERVICE", chargeCodeId: CODE, timeBand: "ANY", fixedRate: 160, active: true },
      { scope: "CLIENT", clientId: CLIENT, timeBand: "ANY", fixedRate: 175, active: true },
    ];
    expect(resolveRate({ ...base, rules }).rate).toBe(175);
    // Without the client rule, the service rule wins.
    expect(resolveRate({ ...base, rules: rules.slice(0, 2) }).rate).toBe(160);
  });

  it("prefers the most specific client+service rule", () => {
    const rules: RateRuleLike[] = [
      globalRule,
      { scope: "CLIENT", clientId: CLIENT, timeBand: "ANY", fixedRate: 175, active: true },
      {
        scope: "CLIENT_SERVICE",
        clientId: CLIENT,
        chargeCodeId: CODE,
        timeBand: "ANY",
        fixedRate: 190,
        active: true,
      },
    ];
    const r = resolveRate({ ...base, rules });
    expect(r).toMatchObject({ rate: 190, scope: "CLIENT_SERVICE" });
  });

  it("prefers agreement rules over client rules", () => {
    const rules: RateRuleLike[] = [
      { scope: "CLIENT", clientId: CLIENT, timeBand: "ANY", fixedRate: 175, active: true },
      { scope: "AGREEMENT", agreementId: AGREEMENT, timeBand: "ANY", fixedRate: 125, active: true },
    ];
    expect(resolveRate({ ...base, agreementId: AGREEMENT, rules }).rate).toBe(125);
    // With no agreement on the entry, the agreement rule can't match.
    expect(resolveRate({ ...base, rules }).rate).toBe(175);
  });

  it("ignores inactive rules", () => {
    const rules: RateRuleLike[] = [
      globalRule,
      { scope: "CLIENT", clientId: CLIENT, timeBand: "ANY", fixedRate: 999, active: false },
    ];
    expect(resolveRate({ ...base, rules }).rate).toBe(150);
  });

  it("returns unresolved rather than inventing a rate", () => {
    const r = resolveRate({ ...base, rules: [] });
    expect(r).toEqual({ rate: null, costRate: null, source: "unresolved", scope: null });
  });
});

describe("resolveRate time bands", () => {
  it("prefers a band-specific rule over an ANY rule at the same scope", () => {
    const rules: RateRuleLike[] = [
      { scope: "CLIENT", clientId: CLIENT, timeBand: "ANY", fixedRate: 175, active: true },
      { scope: "CLIENT", clientId: CLIENT, timeBand: "AFTER_HOURS", fixedRate: 260, active: true },
    ];
    expect(resolveRate({ ...base, timeBand: "AFTER_HOURS", rules }).rate).toBe(260);
    // Daytime work still uses the ANY rule.
    expect(resolveRate({ ...base, timeBand: "DAY", rules }).rate).toBe(175);
  });

  it("does not apply a rule from a different band", () => {
    const rules: RateRuleLike[] = [
      { scope: "CLIENT", clientId: CLIENT, timeBand: "WEEKEND", fixedRate: 300, active: true },
      globalRule,
    ];
    expect(resolveRate({ ...base, timeBand: "DAY", rules }).rate).toBe(150);
    expect(resolveRate({ ...base, timeBand: "WEEKEND", rules }).rate).toBe(300);
  });

  it("applies a multiplier rule to a less specific base rate", () => {
    const rules: RateRuleLike[] = [
      globalRule, // 150
      { scope: "CLIENT", clientId: CLIENT, timeBand: "AFTER_HOURS", multiplier: 1.5, active: true },
    ];
    const r = resolveRate({ ...base, timeBand: "AFTER_HOURS", rules });
    expect(r).toMatchObject({ rate: 225, source: "multiplier" });
  });

  it("applies the charge-code multiplier to fallback rates outside business hours", () => {
    const r = resolveRate({
      ...base,
      timeBand: "AFTER_HOURS",
      rules: [],
      agreementStandardRate: 200,
      chargeCodeMultiplier: 1.5,
    });
    expect(r).toMatchObject({ rate: 300, source: "multiplier" });
    // Daytime work is not multiplied.
    expect(
      resolveRate({ ...base, timeBand: "DAY", rules: [], agreementStandardRate: 200, chargeCodeMultiplier: 1.5 }),
    ).toMatchObject({ rate: 200, source: "agreement" });
  });
});

describe("resolveRate fallbacks", () => {
  it("uses the agreement standard rate before the tech rate", () => {
    const r = resolveRate({ ...base, rules: [], agreementStandardRate: 180, techBillRate: 140 });
    expect(r).toMatchObject({ rate: 180, source: "agreement" });
  });

  it("uses the tech bill rate when nothing else applies", () => {
    const r = resolveRate({ ...base, rules: [], techBillRate: 140 });
    expect(r).toMatchObject({ rate: 140, source: "tech" });
  });

  it("carries the cost rate from the most specific rule that sets one", () => {
    const rules: RateRuleLike[] = [
      { scope: "CLIENT", clientId: CLIENT, timeBand: "ANY", fixedRate: 175, costRate: 65, active: true },
    ];
    expect(resolveRate({ ...base, rules }).costRate).toBe(65);
  });
});

describe("computeAmount", () => {
  it("multiplies hours by rate and rounds to cents", () => {
    expect(computeAmount(1.5, 150)).toBe(225);
    expect(computeAmount(0.3333, 150)).toBe(50);
  });
  it("returns null without a rate", () => {
    expect(computeAmount(2, null)).toBeNull();
  });
});
