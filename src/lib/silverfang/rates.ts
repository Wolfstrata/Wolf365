/**
 * Rate resolution for time entries.
 *
 * Deliberately mirrors `resolveUnitPrice` in src/lib/billing/pricing.ts: the
 * MOST SPECIFIC active rule wins, a fixed rate beats a multiplier within a rule,
 * and when nothing resolves we return null so the caller can flag it rather than
 * silently invent a number.
 *
 * Precedence (most specific first):
 *   1. AGREEMENT_SERVICE  (this agreement + this charge code)
 *   2. AGREEMENT          (this agreement, any charge code)
 *   3. CLIENT_SERVICE     (this client + this charge code)
 *   4. CLIENT             (this client, any charge code)
 *   5. SERVICE            (this charge code, any client)
 *   6. GLOBAL             (default)
 *
 * Within a scope, a rule whose timeBand matches the work (e.g. AFTER_HOURS) is
 * preferred over an ANY-band rule, so time-of-day pricing overrides the base.
 * A multiplier-only rule scales the next resolvable rate, so you can express
 * "after hours is 1.5×" once without restating every base rate.
 */

export type RateScope =
  | "AGREEMENT_SERVICE"
  | "AGREEMENT"
  | "CLIENT_SERVICE"
  | "CLIENT"
  | "SERVICE"
  | "GLOBAL";

export type TimeBand = "ANY" | "DAY" | "AFTER_HOURS" | "WEEKEND" | "HOLIDAY";

export interface RateRuleLike {
  scope: RateScope;
  clientId?: string | null;
  agreementId?: string | null;
  chargeCodeId?: string | null;
  timeBand: TimeBand;
  fixedRate?: number | null;
  multiplier?: number | null;
  costRate?: number | null;
  active: boolean;
}

export interface RateResolutionInput {
  rules: RateRuleLike[];
  clientId: string;
  chargeCodeId: string;
  agreementId?: string | null;
  /** The band the work falls in, from the business calendar. */
  timeBand: TimeBand;
  /** Fallbacks used only when no rule supplies a fixed rate. */
  techBillRate?: number | null;
  agreementStandardRate?: number | null;
  /** Charge-code default multiplier (e.g. 1.5 for after-hours). */
  chargeCodeMultiplier?: number | null;
}

export interface RateResolution {
  rate: number | null;
  costRate: number | null;
  source:
    | "fixed" // a rule set an explicit hourly rate
    | "multiplier" // a multiplier applied to a base rate
    | "agreement" // the agreement's standard rate
    | "tech" // the technician's bill rate
    | "unresolved";
  scope: RateScope | null;
}

const SCOPE_PRECEDENCE: RateScope[] = [
  "AGREEMENT_SERVICE",
  "AGREEMENT",
  "CLIENT_SERVICE",
  "CLIENT",
  "SERVICE",
  "GLOBAL",
];

function matches(rule: RateRuleLike, input: RateResolutionInput): boolean {
  if (!rule.active) return false;
  // The band must either be explicitly for this work or band-agnostic.
  if (rule.timeBand !== "ANY" && rule.timeBand !== input.timeBand) return false;
  switch (rule.scope) {
    case "AGREEMENT_SERVICE":
      return (
        !!input.agreementId &&
        rule.agreementId === input.agreementId &&
        rule.chargeCodeId === input.chargeCodeId
      );
    case "AGREEMENT":
      return !!input.agreementId && rule.agreementId === input.agreementId;
    case "CLIENT_SERVICE":
      return rule.clientId === input.clientId && rule.chargeCodeId === input.chargeCodeId;
    case "CLIENT":
      return rule.clientId === input.clientId;
    case "SERVICE":
      return rule.chargeCodeId === input.chargeCodeId;
    case "GLOBAL":
      return true;
  }
}

/**
 * Candidate rules for a scope, band-specific first so a DAY/AFTER_HOURS rule
 * wins over an ANY rule at the same specificity.
 */
function rulesForScope(
  scope: RateScope,
  input: RateResolutionInput,
): RateRuleLike[] {
  const all = input.rules.filter((r) => r.scope === scope && matches(r, input));
  return [
    ...all.filter((r) => r.timeBand === input.timeBand && r.timeBand !== "ANY"),
    ...all.filter((r) => r.timeBand === "ANY"),
  ];
}

export function resolveRate(input: RateResolutionInput): RateResolution {
  // First pass: the most specific fixed rate wins outright. Collect any
  // multipliers seen at more specific scopes so they can scale a base rate.
  const multipliers: number[] = [];
  let costRate: number | null = null;

  for (const scope of SCOPE_PRECEDENCE) {
    for (const rule of rulesForScope(scope, input)) {
      if (costRate == null && rule.costRate != null) costRate = round2(rule.costRate);
      if (rule.fixedRate != null) {
        const base = rule.fixedRate;
        const rate = multipliers.reduce((acc, m) => acc * m, base);
        return {
          rate: round2(rate),
          costRate,
          source: multipliers.length > 0 ? "multiplier" : "fixed",
          scope,
        };
      }
      if (rule.multiplier != null) {
        // Remember it and keep looking for a base rate to scale.
        multipliers.push(rule.multiplier);
      }
    }
  }

  // No rule supplied a fixed rate — fall back, applying any multipliers found.
  const bandMultiplier =
    input.timeBand !== "ANY" && input.timeBand !== "DAY" && input.chargeCodeMultiplier != null
      ? input.chargeCodeMultiplier
      : null;
  const allMultipliers = bandMultiplier != null ? [...multipliers, bandMultiplier] : multipliers;
  const scale = (base: number) => round2(allMultipliers.reduce((acc, m) => acc * m, base));

  if (input.agreementStandardRate != null) {
    return {
      rate: scale(input.agreementStandardRate),
      costRate,
      source: allMultipliers.length > 0 ? "multiplier" : "agreement",
      scope: null,
    };
  }
  if (input.techBillRate != null) {
    return {
      rate: scale(input.techBillRate),
      costRate,
      source: allMultipliers.length > 0 ? "multiplier" : "tech",
      scope: null,
    };
  }
  return { rate: null, costRate, source: "unresolved", scope: null };
}

/** Billable amount for a time entry: hours × rate, rounded to cents. */
export function computeAmount(hours: number, rate: number | null): number | null {
  if (rate == null || !Number.isFinite(hours)) return null;
  return round2(hours * rate);
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
