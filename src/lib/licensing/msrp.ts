/**
 * Extract the per-unit MSRP (manufacturer suggested retail price) from a synced
 * TD SYNNEX subscription's raw payload. MSRP isn't a first-class column, but the
 * full raw JSON is stored, so we pull it opportunistically: check the known key
 * names, then fall back to a case-insensitive scan for an msrp/list/retail price
 * key. Returns null when no plausible value is present. Pure + unit-tested.
 */

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

const CANDIDATE_KEYS = [
  "msrp",
  "MSRP",
  "msrpPrice",
  "listPrice",
  "suggestedRetailPrice",
  "estimatedRetailPrice",
  "retailPrice",
  "suggestedPrice",
];

export function extractMsrp(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  for (const key of CANDIDATE_KEYS) {
    const n = toNumber(obj[key]);
    if (n != null) return n;
  }

  // Fallback: any key that looks like an MSRP / list / retail unit price.
  for (const [key, value] of Object.entries(obj)) {
    const k = key.toLowerCase();
    if (k.includes("msrp") || k.includes("retailprice") || k === "listprice") {
      const n = toNumber(value);
      if (n != null) return n;
    }
  }
  return null;
}
