import type { ExceptionType } from "@prisma/client";

/**
 * Discrepancy detection between a client's QuickBooks Online record and its
 * TD SYNNEX StreamOne Stellr record.
 *
 * Kept pure and decoupled from Prisma (operates on plain snapshots) so it is
 * fully unit-testable and reusable by both the client profile view and any
 * batch reconciliation job. Each finding maps to an ExceptionType so callers
 * can persist them to the exception queue verbatim.
 */

export interface QboSnapshot {
  displayName?: string | null;
  companyName?: string | null;
  billingEmail?: string | null;
  billingAddress?: AddressLike | null;
  currency?: string | null;
  taxable?: boolean | null;
  active?: boolean | null;
}

export interface TdSnapshot {
  name?: string | null;
  domain?: string | null;
  serviceAddress?: AddressLike | null;
  currency?: string | null;
  active?: boolean | null;
}

/** Loose address shape — accepts QBO BillAddr-style or simple objects. */
export interface AddressLike {
  Line1?: string | null;
  line1?: string | null;
  City?: string | null;
  city?: string | null;
  PostalCode?: string | null;
  postalCode?: string | null;
  CountrySubDivisionCode?: string | null;
  region?: string | null;
}

export type DiscrepancySeverity = "info" | "warning" | "error";

export interface Discrepancy {
  type: ExceptionType;
  severity: DiscrepancySeverity;
  message: string;
}

export interface DetectInput {
  qbo?: QboSnapshot | null;
  td?: TdSnapshot | null;
}

export function detectDiscrepancies(input: DetectInput): Discrepancy[] {
  const { qbo, td } = input;
  const out: Discrepancy[] = [];

  // A QBO-only customer is normal (plenty of QuickBooks customers have no M365),
  // so it is NOT an exception. A TD SYNNEX customer with no QBO record IS worth
  // flagging — there's licensing but nowhere to bill it.
  if (td && !qbo) {
    out.push({
      type: "CLIENT_ONLY_IN_TDSYNNEX",
      severity: "warning",
      message: "Customer exists in TD SYNNEX but has no linked QuickBooks record.",
    });
  }

  if (qbo && !hasEmail(qbo.billingEmail)) {
    out.push({
      type: "MISSING_BILLING_EMAIL",
      severity: "warning",
      message: "QuickBooks customer has no billing email; invoices may not deliver.",
    });
  }

  if (qbo && qbo.taxable == null) {
    out.push({
      type: "TAX_MISMATCH",
      severity: "info",
      message: "QuickBooks tax status is not set; verify taxability before billing.",
    });
  }

  // Cross-source comparisons require both records. Names and addresses are
  // compared fuzzily — a typo, a legal-suffix difference, a postal-code space,
  // or "Avenue" vs "Ave" is the same customer, not a discrepancy.
  if (qbo && td) {
    if (!namesMatch(qbo.companyName ?? qbo.displayName, td.name)) {
      out.push({
        type: "NAME_MISMATCH",
        severity: "warning",
        message: `Name mismatch: QBO "${qbo.companyName ?? qbo.displayName}" vs TD SYNNEX "${td.name}".`,
      });
    }

    if (!addressesMatch(qbo.billingAddress, td.serviceAddress)) {
      out.push({
        type: "ADDRESS_MISMATCH",
        severity: "info",
        message: "Billing/service address differs between QuickBooks and TD SYNNEX.",
      });
    }

    if (qbo.active != null && td.active != null && qbo.active !== td.active) {
      out.push({
        type: "ACTIVE_STATUS_MISMATCH",
        severity: "warning",
        message: `Active status mismatch: QBO ${qbo.active ? "active" : "inactive"}, TD SYNNEX ${td.active ? "active" : "inactive"}.`,
      });
    }

    if (
      qbo.currency &&
      td.currency &&
      qbo.currency.toUpperCase() !== td.currency.toUpperCase()
    ) {
      out.push({
        type: "CURRENCY_MISMATCH",
        severity: "error",
        message: `Currency mismatch: QBO ${qbo.currency} vs TD SYNNEX ${td.currency}.`,
      });
    }
  }

  return out;
}

const COMPANY_SUFFIXES = /\b(inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|gmbh|plc)\b/g;

/** Normalize a company name for comparison: lowercase, drop punctuation and
 * common legal suffixes, collapse whitespace. */
export function normalizeName(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/[.,&]/g, " ")
    .replace(COMPANY_SUFFIXES, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Levenshtein edit distance. */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i += 1) {
    const curr = [i];
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    prev = curr;
  }
  return prev[n]!;
}

/** Similarity in [0,1]: 1 = identical, degrades with edits. Empty vs empty = 1. */
function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - editDistance(a, b) / max;
}

/**
 * Whether two company names are effectively the same. Tolerant of legal-suffix
 * differences (handled by normalizeName), containment, and small typos
 * ("Institute" vs "Instiue"). Missing on either side = not a mismatch.
 */
export function namesMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return true;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  return similarity(na, nb) >= 0.85;
}

// Long → short forms so "Avenue"/"Ave" and "Manitoba"/"MB" collapse to the same.
const PROVINCE_ABBREV: [RegExp, string][] = (
  [
    ["newfoundland and labrador", "nl"],
    ["prince edward island", "pe"],
    ["british columbia", "bc"],
    ["northwest territories", "nt"],
    ["nova scotia", "ns"],
    ["new brunswick", "nb"],
    ["saskatchewan", "sk"],
    ["manitoba", "mb"],
    ["ontario", "on"],
    ["quebec", "qc"],
    ["alberta", "ab"],
    ["yukon", "yt"],
    ["nunavut", "nu"],
  ] as [string, string][]
).map(([long, short]) => [new RegExp(`\\b${long}\\b`, "g"), short]);

const STREET_ABBREV: [RegExp, string][] = (
  [
    ["avenue", "ave"],
    ["street", "st"],
    ["road", "rd"],
    ["drive", "dr"],
    ["boulevard", "blvd"],
    ["crescent", "cres"],
    ["court", "ct"],
    ["place", "pl"],
    ["lane", "ln"],
    ["highway", "hwy"],
    ["parkway", "pkwy"],
    ["terrace", "terr"],
    ["square", "sq"],
    ["trail", "trl"],
    ["suite", "ste"],
    ["unit", "unit"],
  ] as [string, string][]
).map(([long, short]) => [new RegExp(`\\b${long}\\b`, "g"), short]);

/** Collapse an address to a comparable signature: fold province/street
 * abbreviations, lowercase, and strip ALL non-alphanumerics (so "R3M 3V8" ==
 * "R3M3V8" and "Ave"/"Avenue" line up). */
function addressSignature(addr: AddressLike | null | undefined): string {
  if (!addr) return "";
  let s = [
    addr.Line1 ?? addr.line1,
    addr.City ?? addr.city,
    addr.CountrySubDivisionCode ?? addr.region,
    addr.PostalCode ?? addr.postalCode,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  for (const [re, short] of PROVINCE_ABBREV) s = s.replace(re, short);
  for (const [re, short] of STREET_ABBREV) s = s.replace(re, short);
  return s.replace(/[^a-z0-9]/g, "");
}

/** Whether two addresses are effectively the same (abbreviations, postal-code
 * spacing, and minor typos tolerated). Missing on either side = not a mismatch. */
export function addressesMatch(
  a: AddressLike | null | undefined,
  b: AddressLike | null | undefined,
): boolean {
  const sa = addressSignature(a);
  const sb = addressSignature(b);
  if (!sa || !sb) return true;
  if (sa === sb) return true;
  return similarity(sa, sb) >= 0.9;
}

function hasEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && /\S+@\S+\.\S+/.test(email);
}
