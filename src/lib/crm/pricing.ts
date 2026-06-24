import type { CrmLine } from "@prisma/client";

/**
 * CRM deal pricing — pure, unit-tested. Opportunities are entered as monthly
 * figures; total contract value and sales commission are derived from the
 * monthly amount and the agreement term.
 */

/** Total contract value = monthly amount × 12 × term years. */
export function totalContractValue(
  monthlyAmount: number | null | undefined,
  termYears: number,
): number {
  const m = monthlyAmount ?? 0;
  return Math.round(m * 12 * termYears * 100) / 100;
}

/**
 * Commission months by agreement term for the commission-bearing lines
 * (Managed Services and Managed NOC):
 *   1 year  → 1 month of MRR
 *   2 years → 1.5 months
 *   3 years → 2 months
 */
export const COMMISSION_MONTHS: Record<number, number> = { 1: 1, 2: 1.5, 3: 2 };

/** Lines that pay a commission. Microsoft 365 does not. */
export function lineHasCommission(line: CrmLine): boolean {
  return line === "MANAGED_SERVICES" || line === "MANAGED_NOC";
}

/**
 * Commission = monthly MRR × commission-months for the term. Returns 0 for
 * lines that don't pay commission (e.g. M365) or unknown terms.
 */
export function commissionAmount(
  line: CrmLine,
  termYears: number,
  monthlyAmount: number | null | undefined,
): number {
  if (!lineHasCommission(line)) return 0;
  const months = COMMISSION_MONTHS[termYears] ?? 0;
  return Math.round((monthlyAmount ?? 0) * months * 100) / 100;
}
