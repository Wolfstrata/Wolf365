/**
 * Project quantity and billing arithmetic — pure, so the numbers on a project
 * page, an invoice draft and a test all come from the same place.
 *
 * Two billing types, one hours ledger. Time and materials bills the hours it
 * worked and shows them to the client. Fixed fee bills a flat amount each
 * interval and tracks hours *identically* — but those hours are internal, and
 * `hoursVisibleToClient` is the single answer to "may this number be shown?".
 * Nothing client-facing should read hours without asking it first.
 */

export type ProjectBillingType = "TIME_AND_MATERIALS" | "FIXED_FEE";

export interface PhaseHoursInput {
  /** Hours sold for the phase. `null` means unquantified, not zero. */
  hours: number | null;
}

export interface DepositState {
  percent: number | null;
  amount: number | null;
  invoicedAt: Date | null;
}

/** Round money to cents, avoiding the 0.005 float edge. */
export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Round hours to the quarter-hour precision the rest of SilverFang uses. */
export function roundHours(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

/**
 * Sum the hours sold across phases. Phases with no hours contribute nothing —
 * they are unquantified, so counting them as zero would be the same answer for
 * a different reason and hide the gap. `null` when no phase is quantified at
 * all, so a caller can tell "nobody has sized this" from "it sums to zero".
 */
export function phaseHoursTotal(phases: PhaseHoursInput[]): number | null {
  const quantified = phases.filter((p) => p.hours != null);
  if (quantified.length === 0) return null;
  return roundHours(quantified.reduce((sum, p) => sum + (p.hours ?? 0), 0));
}

/** How many phases have hours, and how many do not — shown so gaps are visible. */
export function phaseHoursCoverage(phases: PhaseHoursInput[]): {
  quantified: number;
  unquantified: number;
} {
  const quantified = phases.filter((p) => p.hours != null).length;
  return { quantified, unquantified: phases.length - quantified };
}

/**
 * Does the phase breakdown agree with the project's contracted total? Reported
 * rather than enforced: a mismatch is usually mid-edit, and refusing the save
 * would make a project impossible to reshape. Tolerance is one hundredth of an
 * hour — below the granularity anyone sells time in.
 */
export function phaseHoursReconcile(
  contracted: number | null,
  phases: PhaseHoursInput[],
): { total: number | null; matches: boolean; difference: number | null } {
  const total = phaseHoursTotal(phases);
  if (contracted == null || total == null) {
    return { total, matches: true, difference: null };
  }
  const difference = roundHours(total - contracted);
  return { total, matches: Math.abs(difference) < 0.01, difference };
}

/**
 * The hours a project is measured against: the phase sum when the project is
 * phased, otherwise the contracted figure typed on the project. Phases win
 * because they are the detail the total is built from.
 */
export function effectiveContractedHours(
  contracted: number | null,
  phases: PhaseHoursInput[],
): number | null {
  return phaseHoursTotal(phases) ?? contracted;
}

/**
 * Whether hours may be shown to the client. FIXED_FEE never shows hours — the
 * client bought an outcome for a price, and exposing the hours behind it both
 * breaks the deal's premise and invites a renegotiation of a settled number.
 */
export function hoursVisibleToClient(billingType: ProjectBillingType): boolean {
  return billingType === "TIME_AND_MATERIALS";
}

/**
 * The billable total a deposit is a percentage of: the fixed fee for FIXED_FEE,
 * otherwise the project's budget. Returns `null` when there is no figure to take
 * a percentage of — a deposit on an unknown total is not a number, and guessing
 * one would put an invented amount on an invoice.
 */
export function projectTotal(input: {
  billingType: ProjectBillingType;
  fixedFeeAmount: number | null;
  budgetAmount: number | null;
}): number | null {
  const total = input.billingType === "FIXED_FEE" ? input.fixedFeeAmount : input.budgetAmount;
  return total != null && total > 0 ? roundMoney(total) : null;
}

/** The deposit a percentage of a total works out to, or `null` if either is unknown. */
export function depositAmountFor(total: number | null, percent: number | null): number | null {
  if (total == null || percent == null) return null;
  if (percent <= 0) return null;
  return roundMoney((total * percent) / 100);
}

/**
 * What the deposit is worth right now. `invoiced` is the amount that actually
 * went out — never recomputed from the current total, because a later change to
 * the project's value must not silently rewrite an invoice already sent.
 */
export function depositStatus(
  total: number | null,
  deposit: DepositState,
): {
  percent: number | null;
  /** What the deposit should be, given today's total. */
  expected: number | null;
  /** What was actually invoiced, once it has been. */
  invoiced: number | null;
  invoicedAt: Date | null;
  outstanding: number | null;
  /** The invoiced deposit no longer matches the total it was taken from. */
  drifted: boolean;
} {
  const expected = deposit.amount ?? depositAmountFor(total, deposit.percent);
  const sent = deposit.invoicedAt != null;
  const invoiced = sent ? deposit.amount : null;
  const recomputed = depositAmountFor(total, deposit.percent);
  return {
    percent: deposit.percent,
    expected,
    invoiced,
    invoicedAt: deposit.invoicedAt,
    outstanding: sent ? null : expected,
    drifted:
      sent && invoiced != null && recomputed != null && Math.abs(invoiced - recomputed) >= 0.01,
  };
}

/**
 * What is left to bill after the deposit is applied. The deposit is a payment
 * against the total, not an extra charge, so it comes off the remainder.
 */
export function remainderAfterDeposit(
  total: number | null,
  depositInvoiced: number | null,
): number | null {
  if (total == null) return null;
  return roundMoney(Math.max(0, total - (depositInvoiced ?? 0)));
}

/**
 * The next fixed-fee billing date: `intervalDays` after the last invoice, or
 * after the start when nothing has been billed yet. `null` when neither date
 * exists, because a schedule with no anchor has no next date.
 */
export function nextBillingDate(input: {
  startDate: Date | null;
  lastBilledAt: Date | null;
  intervalDays: number;
}): Date | null {
  const anchor = input.lastBilledAt ?? input.startDate;
  if (!anchor) return null;
  const days = Number.isFinite(input.intervalDays) && input.intervalDays > 0 ? input.intervalDays : 30;
  return new Date(anchor.getTime() + days * 86_400_000);
}

/** Fixed-fee periods elapsed between two dates — how many invoices are due. */
export function billingPeriodsElapsed(input: {
  startDate: Date | null;
  asOf: Date;
  intervalDays: number;
}): number {
  if (!input.startDate) return 0;
  const days = Number.isFinite(input.intervalDays) && input.intervalDays > 0 ? input.intervalDays : 30;
  const elapsed = (input.asOf.getTime() - input.startDate.getTime()) / 86_400_000;
  if (elapsed < 0) return 0;
  return Math.floor(elapsed / days) + 1;
}

/**
 * Hours use against the contracted quantity. `overage` is reported rather than
 * clamped: hours worked beyond what was sold are real and someone has to decide
 * whether to bill or absorb them, which they cannot do if the number is hidden.
 */
export function hoursUsage(
  logged: number,
  contracted: number | null,
): {
  logged: number;
  contracted: number | null;
  remaining: number | null;
  overage: number;
  /** 0–1, clamped for a progress bar. `null` with nothing to measure against. */
  ratio: number | null;
} {
  const used = roundHours(logged);
  if (contracted == null || contracted <= 0) {
    return { logged: used, contracted, remaining: null, overage: 0, ratio: null };
  }
  return {
    logged: used,
    contracted,
    remaining: roundHours(Math.max(0, contracted - used)),
    overage: roundHours(Math.max(0, used - contracted)),
    ratio: Math.min(1, used / contracted),
  };
}

/** Default phase names for a new project: "Phase 1" … "Phase n". Renamable after. */
export function defaultPhaseNames(count: number): string[] {
  const n = Math.max(0, Math.min(50, Math.floor(count)));
  return Array.from({ length: n }, (_, i) => `Phase ${i + 1}`);
}

/**
 * Split contracted hours evenly across new phases, giving any remainder to the
 * first phase so the parts still sum exactly to the whole. An uneven split that
 * adds up beats an even one that does not.
 */
export function splitHoursAcrossPhases(total: number | null, count: number): (number | null)[] {
  const n = Math.max(0, Math.floor(count));
  if (n === 0) return [];
  if (total == null || total <= 0) return Array.from({ length: n }, () => null);
  const each = roundHours(Math.floor((total / n) * 100) / 100);
  const parts = Array.from({ length: n }, () => each);
  parts[0] = roundHours(total - each * (n - 1));
  return parts;
}
