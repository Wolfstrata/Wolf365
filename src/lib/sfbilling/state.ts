import type { SfBillingRunStatus } from "@prisma/client";

/**
 * SilverFang billing run state machine.
 *
 * Mirrors the M365 run machine deliberately: the review discipline is the part
 * worth sharing between pipelines, even though the sources differ. The rule that
 * matters is that PUSHED is terminal and only APPROVED (or a PARTIALLY_FAILED
 * retry) can reach it — an invoice must never leave on a draft.
 */
const TRANSITIONS: Record<SfBillingRunStatus, SfBillingRunStatus[]> = {
  DRAFT: ["REVIEWED", "CANCELLED"],
  REVIEWED: ["APPROVED", "DRAFT", "CANCELLED"],
  APPROVED: ["PUSHED", "PARTIALLY_FAILED", "REVIEWED", "CANCELLED"],
  // A partially failed push can be retried or abandoned.
  PARTIALLY_FAILED: ["PUSHED", "APPROVED", "CANCELLED"],
  PUSHED: [], // terminal
  CANCELLED: [], // terminal
};

export function canTransition(from: SfBillingRunStatus, to: SfBillingRunStatus): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export function assertTransition(from: SfBillingRunStatus, to: SfBillingRunStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal SilverFang billing run transition: ${from} -> ${to}`);
  }
}

export function isTerminal(status: SfBillingRunStatus): boolean {
  return (TRANSITIONS[status] ?? []).length === 0;
}

/** Only these statuses may push. Lines are editable only in DRAFT. */
export function canPush(status: SfBillingRunStatus): boolean {
  return status === "APPROVED" || status === "PARTIALLY_FAILED";
}

export function linesEditable(status: SfBillingRunStatus): boolean {
  return status === "DRAFT";
}
