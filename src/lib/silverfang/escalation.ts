/**
 * When to warn that an SLA target is about to be missed.
 *
 * The breach sweep already flags targets that have passed, but a breach alert is
 * an obituary — by the time it fires, the thing it warns about has happened. This
 * is the part that can still be acted on: the target is inside its warning
 * threshold and nobody has been told yet.
 *
 * Pure, because the interesting behaviour is idempotency. Something running every
 * fifteen minutes that re-warns on every pass trains people to ignore it, which is
 * worse than not warning at all.
 */

export type EscalationTarget = "RESPONSE" | "RESOLUTION";

/** The subset of an evaluated SLA target this decision needs. */
export interface EscalationState {
  breached: boolean;
  atRisk: boolean;
  remainingMinutes: number | null;
}

/**
 * Whether to raise an at-risk warning now.
 *
 * False once already warned, and false once breached — a breach has its own alert,
 * and sending both for the same target says the same thing twice.
 */
export function shouldWarnAtRisk(
  state: EscalationState,
  alreadyWarnedAt: Date | null | undefined,
): boolean {
  if (alreadyWarnedAt) return false;
  if (state.breached) return false;
  if (state.remainingMinutes == null) return false;
  return state.atRisk;
}

/** Minutes as something a person reads without doing arithmetic. */
export function minutesLabel(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"}`;
  const hours = Math.floor(m / 60);
  const rest = m % 60;
  const hoursPart = `${hours} hour${hours === 1 ? "" : "s"}`;
  return rest === 0 ? hoursPart : `${hoursPart} ${rest} minute${rest === 1 ? "" : "s"}`;
}

/**
 * The note stored on the SLA event. Says which target and how long is left in
 * business minutes, since that is the clock the target is measured on — wall-clock
 * time would make a Friday-afternoon warning look wrong on Monday.
 */
export function atRiskNote(target: EscalationTarget, remainingMinutes: number): string {
  const what = target === "RESPONSE" ? "Response" : "Resolution";
  return `${what} target at risk — ${minutesLabel(remainingMinutes)} of business time left`;
}
