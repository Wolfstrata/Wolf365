"use client";

import { useMemo, useState } from "react";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { renewalWindow, type RenewalBucket } from "@/lib/licensing/renewal";
import { ArchiveToggle } from "@/components/licensing/archive-toggle";

export interface M365LicensingRow {
  id: string;
  sku: string | null;
  product: string | null;
  contractNo: string | null;
  billingType: string | null;
  oneTime: boolean;
  /** Month-to-month commitment — rolls over, so no renewal to flag. */
  monthToMonth: boolean;
  /** Term has lapsed (past end date or expired status). */
  expired: boolean;
  quantity: number;
  unitCost: number | null;
  extendedCost: number | null;
  customerPrice: number | null;
  extendedPrice: number | null;
  marginPerUnit: number | null;
  underCost: boolean;
  /** Margin change vs last month (per unit); null when no prior snapshot. */
  marginDelta: number | null;
  /** "bad" = under cost or margin dropped; "good" = margin improved. */
  attention: "good" | "bad" | null;
  mrr: number;
  term: string | null;
  renewalDate: string | null; // ISO
  status: string | null;
  reducible: boolean | null;
  currency: string;
}

const RENEWAL_BADGE: Record<RenewalBucket, string> = {
  30: "bg-danger/15 text-danger",
  60: "bg-warning/15 text-warning",
  90: "bg-accent text-accent-foreground",
};

type SortKey =
  | "product"
  | "contractNo"
  | "billingType"
  | "quantity"
  | "unitCost"
  | "extendedCost"
  | "customerPrice"
  | "extendedPrice"
  | "marginPerUnit"
  | "mrr"
  | "renewalDate"
  | "status";

interface Column {
  key: SortKey | null;
  label: string;
  numeric?: boolean;
}

const COLUMNS: Column[] = [
  { key: "product", label: "SKU / Product" },
  { key: "contractNo", label: "Contract #" },
  { key: "billingType", label: "Billing" },
  { key: "quantity", label: "Qty", numeric: true },
  { key: "unitCost", label: "Unit cost", numeric: true },
  { key: "extendedCost", label: "Ext. cost", numeric: true },
  { key: "customerPrice", label: "Cust. price / MSRP", numeric: true },
  { key: "extendedPrice", label: "Ext. price", numeric: true },
  { key: "marginPerUnit", label: "Margin", numeric: true },
  { key: "mrr", label: "MRR / mo", numeric: true },
  { key: "renewalDate", label: "Renewal" },
  { key: "status", label: "Status" },
];

function cmp(a: M365LicensingRow, b: M365LicensingRow, key: SortKey): number {
  const av = a[key];
  const bv = b[key];
  if (av == null && bv == null) return 0;
  if (av == null) return 1; // nulls last
  if (bv == null) return -1;
  if (typeof av === "number" && typeof bv === "number") return av - bv;
  return String(av).localeCompare(String(bv));
}

export function M365LicensingTable({
  rows,
  canArchive = false,
}: {
  rows: M365LicensingRow[];
  canArchive?: boolean;
}) {
  const [hideOneTime, setHideOneTime] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const oneTimeCount = useMemo(() => rows.filter((r) => r.oneTime).length, [rows]);
  const underCostCount = useMemo(() => rows.filter((r) => r.underCost).length, [rows]);
  const now = useMemo(() => new Date(), []);

  const view = useMemo(() => {
    let out = hideOneTime ? rows.filter((r) => !r.oneTime) : rows.slice();
    if (sortKey) {
      out = out.slice().sort((a, b) => {
        const c = cmp(a, b, sortKey);
        return sortDir === "asc" ? c : -c;
      });
    }
    return out;
  }, [rows, hideOneTime, sortKey, sortDir]);

  function toggleSort(key: SortKey | null) {
    if (!key) return;
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs">
        <label className="inline-flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={hideOneTime}
            onChange={(e) => setHideOneTime(e.target.checked)}
            className="h-4 w-4"
          />
          Hide one-time items{oneTimeCount > 0 ? ` (${oneTimeCount})` : ""}
        </label>
        {underCostCount > 0 && (
          <span className="rounded-full bg-danger/15 px-2 py-0.5 font-medium text-danger">
            {underCostCount} below cost
          </span>
        )}
        <span className="text-muted-foreground">Click a column header to sort.</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="py-1 pr-3 font-medium">Archive</th>
              {COLUMNS.map((c) => (
                <th
                  key={c.label}
                  onClick={() => toggleSort(c.key)}
                  className={`py-1 pr-4 font-medium ${c.key ? "cursor-pointer select-none hover:text-foreground" : ""} ${c.numeric ? "text-right" : ""}`}
                >
                  {c.label}
                  {sortKey === c.key && c.key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                </th>
              ))}
              <th className="py-1 pr-4 font-medium">Reducible</th>
            </tr>
          </thead>
          <tbody>
            {view.map((r) => {
              const win =
                r.renewalDate && !r.monthToMonth
                  ? renewalWindow(new Date(r.renewalDate), now)
                  : null;
              return (
                <tr
                  key={r.id}
                  className={`border-t align-top ${
                    r.expired
                      ? "bg-orange-500/15"
                      : r.attention === "bad"
                        ? "bg-danger/5"
                        : r.attention === "good"
                          ? "bg-warning/5"
                          : ""
                  }`}
                >
                  <td className="py-1.5 pr-3">
                    {r.expired ? (
                      <ArchiveToggle subscriptionId={r.id} archived={false} canArchive={canArchive} />
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </td>
                  <td className="py-1.5 pr-4">
                    <div className="font-mono text-xs text-muted-foreground">{r.sku ?? "—"}</div>
                    <div>{r.product ?? "—"}</div>
                  </td>
                  <td className="py-1.5 pr-4 tabular-nums text-muted-foreground">{r.contractNo ?? "—"}</td>
                  <td className="py-1.5 pr-4">
                    {r.billingType ?? "—"}
                    {r.oneTime && (
                      <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        one-time
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">{r.quantity}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">
                    {r.unitCost != null ? formatCurrency(r.unitCost, r.currency) : "—"}
                  </td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">
                    {r.extendedCost != null ? formatCurrency(r.extendedCost, r.currency) : "—"}
                  </td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">
                    {r.customerPrice != null ? formatCurrency(r.customerPrice, r.currency) : "—"}
                  </td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">
                    {r.extendedPrice != null ? formatCurrency(r.extendedPrice, r.currency) : "—"}
                  </td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">
                    {r.marginPerUnit != null ? (
                      <span className={r.underCost ? "font-medium text-danger" : ""}>
                        {formatCurrency(r.marginPerUnit, r.currency)}
                        {r.underCost && (
                          <span className="ml-1 rounded-full bg-danger/15 px-1.5 py-0.5 text-[10px] font-medium text-danger">
                            below cost
                          </span>
                        )}
                        {!r.underCost && r.marginDelta != null && r.marginDelta !== 0 && (
                          <span
                            className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                              r.marginDelta > 0
                                ? "bg-warning/15 text-warning"
                                : "bg-danger/15 text-danger"
                            }`}
                            title="Change vs last month"
                          >
                            {r.marginDelta > 0 ? "▲" : "▼"} {formatCurrency(Math.abs(r.marginDelta), r.currency)} vs last mo
                          </span>
                        )}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">
                    {formatCurrency(r.mrr, r.currency)}
                  </td>
                  <td className="py-1.5 pr-4 whitespace-nowrap">
                    {r.expired ? (
                      <span className="font-semibold text-orange-600 dark:text-orange-400">
                        {r.renewalDate ? formatDateTime(new Date(r.renewalDate)) : "—"}
                        <span className="ml-2 rounded-full bg-orange-500 px-2 py-0.5 text-xs font-medium text-white">
                          Expired
                        </span>
                      </span>
                    ) : (
                      <>
                        {r.monthToMonth ? (
                          <span className="text-muted-foreground">Monthly</span>
                        ) : r.renewalDate ? (
                          formatDateTime(new Date(r.renewalDate))
                        ) : (
                          "—"
                        )}
                        {win && (
                          <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${RENEWAL_BADGE[win.bucket]}`}>
                            in {win.daysUntil}d
                          </span>
                        )}
                      </>
                    )}
                  </td>
                  <td className="py-1.5 pr-4">{r.status ?? "—"}</td>
                  <td className="py-1.5 pr-4">
                    {r.reducible === false ? (
                      <span className="text-warning">NCE locked</span>
                    ) : r.reducible === true ? (
                      "Yes"
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {view.length === 0 && (
        <p className="py-4 text-sm text-muted-foreground">No items match the current filter.</p>
      )}
    </div>
  );
}
