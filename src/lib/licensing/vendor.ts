/**
 * Classify a TD SYNNEX subscription as Microsoft 365 vs. another vendor.
 *
 * TD SYNNEX Stellr resells more than Microsoft (e.g. Cisco/Meraki/Webex/Duo).
 * Wolf365 is a Microsoft 365 billing tool, so non-M365 lines are excluded from
 * the dashboards, client lists, renewals/expiry, and margin reports — and a
 * client whose licensing is entirely non-M365 drops off the M365 client list.
 *
 * Vendor is the authoritative signal (persisted on the subscription, backfilled
 * from the raw payload). When it's a recognized vendor we trust it; an
 * unrecognized/blank vendor falls back to product-name/SKU keywords. We only
 * ever EXCLUDE on a positive non-M365 signal, so unknown lines stay visible
 * (M365 is the overwhelming majority of the synced data). Pure + unit-tested.
 */

const MICROSOFT = /micro\s*soft|msft/i;
const NON_M365_VENDOR = /cisco|meraki|webex|duo|umbrella|thousandeyes|appdynamics/i;
const NON_M365_PRODUCT =
  /\b(cisco|meraki|webex|duo|umbrella|thousandeyes|appdynamics|catalyst|firepower|anyconnect)\b/i;

export function isM365Subscription(sub: {
  vendor?: string | null;
  productName?: string | null;
  productSku?: string | null;
}): boolean {
  const vendor = (sub.vendor ?? "").trim();
  if (vendor) {
    if (MICROSOFT.test(vendor)) return true;
    if (NON_M365_VENDOR.test(vendor)) return false;
    // Unrecognized vendor: don't assume — fall through to product signals.
  }
  const text = `${sub.productName ?? ""} ${sub.productSku ?? ""}`;
  if (NON_M365_PRODUCT.test(text)) return false;
  if (MICROSOFT.test(text)) return true;
  // No non-M365 signal anywhere → treat as M365.
  return true;
}
