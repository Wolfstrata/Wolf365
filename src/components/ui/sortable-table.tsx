"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronsUpDown, ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Generic click-to-sort table for richly-rendered listings (links, badges,
 * action buttons). Mirrors the CRM opportunities-table UX: lucide chevron
 * indicators, smart default direction, nulls sorted last. Each column supplies
 * both a `sortValue` accessor and a `render` for the cell, so cells can hold any
 * markup while still sorting on a plain value.
 */
export interface SortColumn<Row> {
  key: string;
  label: string;
  /** Right-align + tabular-nums for numeric columns. */
  numeric?: boolean;
  /** Set false for action columns (e.g. an archive toggle) — no sort control. */
  sortable?: boolean;
  /** Value used for comparison; null/undefined sorts last. */
  sortValue?: (row: Row) => number | string | null | undefined;
  render: (row: Row) => ReactNode;
}

function compare<Row>(
  a: Row,
  b: Row,
  col: SortColumn<Row>,
): number {
  const av = col.sortValue ? col.sortValue(a) : null;
  const bv = col.sortValue ? col.sortValue(b) : null;
  if (av == null && bv == null) return 0;
  if (av == null) return 1; // nulls last
  if (bv == null) return -1;
  if (typeof av === "number" && typeof bv === "number") return av - bv;
  return String(av).localeCompare(String(bv));
}

export function SortableTable<Row>({
  columns,
  rows,
  rowKey,
  initialSort,
  rowClassName,
  emptyMessage = "Nothing to show.",
}: {
  columns: SortColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row, index: number) => string;
  /** Column key to sort by initially, and its direction. */
  initialSort?: { key: string; dir: "asc" | "desc" };
  rowClassName?: (row: Row) => string | undefined;
  emptyMessage?: string;
}) {
  const [sortKey, setSortKey] = useState<string | null>(initialSort?.key ?? null);
  const [dir, setDir] = useState<"asc" | "desc">(initialSort?.dir ?? "asc");

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const col = columns.find((c) => c.key === sortKey);
    if (!col) return rows;
    const out = [...rows].sort((a, b) => compare(a, b, col));
    return dir === "asc" ? out : out.reverse();
  }, [rows, columns, sortKey, dir]);

  function toggle(col: SortColumn<Row>) {
    if (col.sortable === false) return;
    if (col.key === sortKey) {
      setDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(col.key);
      // Text columns default A→Z; numeric columns default high→low.
      setDir(col.numeric ? "desc" : "asc");
    }
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
          <tr>
            {columns.map((c) => {
              const sortable = c.sortable !== false;
              const active = c.key === sortKey;
              const Icon = !active ? ChevronsUpDown : dir === "asc" ? ChevronUp : ChevronDown;
              return (
                <th
                  key={c.key}
                  className={cn("px-4 py-2 font-medium", c.numeric && "text-right")}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => toggle(c)}
                      className={cn(
                        "inline-flex items-center gap-1 hover:text-foreground",
                        c.numeric && "flex-row-reverse",
                        active && "text-foreground",
                      )}
                    >
                      {c.label}
                      <Icon className="h-3 w-3" />
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-6 text-center text-muted-foreground">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            sorted.map((row, i) => (
              <tr key={rowKey(row, i)} className={cn("border-t hover:bg-accent/40", rowClassName?.(row))}>
                {columns.map((c) => (
                  <td key={c.key} className={cn("px-4 py-2 align-top", c.numeric && "text-right tabular-nums")}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
