/**
 * Pure classifier for which QuickBooks bills belong in the Suppliers & Expenses /
 * DPO report. The report covers supplier bills and ordinary expenses but must
 * EXCLUDE payroll, taxes, loans, credit cards and credit lines (per the brief).
 *
 * Exclusion is keyword-based across the vendor name, the bill's expense-account
 * category and its memo — whichever QBO happens to populate. Matching is
 * case-insensitive and dependency-free so it stays unit-testable.
 */

/** Keyword groups we exclude. Word-ish matching keeps "taxi" ≠ "tax", etc. */
const EXCLUDE_PATTERNS: RegExp[] = [
  // Payroll / wages
  /\bpayroll\b/i,
  /\bwages?\b/i,
  /\bsalar(?:y|ies)\b/i,
  /\bgusto\b/i,
  /\badp\b/i,
  // Taxes
  /\btax(?:es|ation)?\b/i,
  /\bgst\b/i,
  /\bhst\b/i,
  /\bpst\b/i,
  /\bqst\b/i,
  /\bvat\b/i,
  /\bcra\b/i,
  /\birs\b/i,
  // Loans / financing
  /\bloans?\b/i,
  /\bmortgages?\b/i,
  /\binterest\b/i,
  // Credit cards / lines
  /\bcredit\s*cards?\b/i,
  /\bline\s*of\s*credit\b/i,
  /\bcredit\s*lines?\b/i,
  /\bvisa\b/i,
  /\bmastercard\b/i,
  /\bamex\b/i,
  /\bamerican\s+express\b/i,
];

/**
 * True when a bill should be EXCLUDED (payroll/tax/loan/credit) from the
 * Suppliers & Expenses / DPO report. Inspects vendor, category and memo.
 */
export function isExcludedBill(
  vendor?: string | null,
  category?: string | null,
  memo?: string | null,
): boolean {
  const haystack = [vendor, category, memo]
    .filter((s): s is string => Boolean(s && s.trim()))
    .join(" • ");
  if (!haystack) return false;
  return EXCLUDE_PATTERNS.some((re) => re.test(haystack));
}
