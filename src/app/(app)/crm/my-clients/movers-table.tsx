"use client";

import { formatCurrency } from "@/lib/utils";
import { SortableTable, type SortColumn } from "@/components/ui/sortable-table";
import type { SpendMover } from "@/lib/reports/dso";

/**
 * Sortable year-over-year spend-mover table (Expanding / Contracting) for the My
 * Clients view. Sort by any header; a totals line beneath sums the two year
 * columns and the change.
 */
export function MoversTable({
  rows,
  priorYear,
  compareYear,
  kind,
}: {
  rows: SpendMover[];
  priorYear: number;
  compareYear: number;
  kind: "up" | "down";
}) {
  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  const totalPrior = round2(rows.reduce((s, r) => s + r.spendPrior, 0));
  const totalCurrent = round2(rows.reduce((s, r) => s + r.spendCurrent, 0));
  const totalChange = round2(rows.reduce((s, r) => s + r.change, 0));
  const changeTone = kind === "up" ? "text-success" : "text-danger";

  const columns: SortColumn<SpendMover>[] = [
    {
      key: "customer",
      label: kind === "up" ? "Expanding" : "Contracting",
      sortValue: (r) => r.customer,
      render: (r) => r.customer,
    },
    {
      key: "spendPrior",
      label: String(priorYear),
      numeric: true,
      sortValue: (r) => r.spendPrior,
      render: (r) => formatCurrency(r.spendPrior),
    },
    {
      key: "spendCurrent",
      label: String(compareYear),
      numeric: true,
      sortValue: (r) => r.spendCurrent,
      render: (r) => formatCurrency(r.spendCurrent),
    },
    {
      key: "change",
      label: "Change",
      numeric: true,
      sortValue: (r) => r.change,
      render: (r) => (
        <span className={changeTone}>
          {r.change > 0 ? "+" : ""}
          {formatCurrency(r.change)}
          {r.pctChange != null ? ` (${r.pctChange > 0 ? "+" : ""}${r.pctChange}%)` : ""}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-2">
      <SortableTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.customer}
        initialSort={{ key: "change", dir: kind === "up" ? "desc" : "asc" }}
        emptyMessage="None"
      />
      {rows.length > 0 && (
        <p className="px-1 text-xs text-muted-foreground">
          Total — {priorYear}:{" "}
          <span className="font-medium tabular-nums text-foreground">{formatCurrency(totalPrior)}</span>{" "}
          · {compareYear}:{" "}
          <span className="font-medium tabular-nums text-foreground">{formatCurrency(totalCurrent)}</span>{" "}
          · Change:{" "}
          <span className={`font-medium tabular-nums ${changeTone}`}>
            {totalChange > 0 ? "+" : ""}
            {formatCurrency(totalChange)}
          </span>
        </p>
      )}
    </div>
  );
}
