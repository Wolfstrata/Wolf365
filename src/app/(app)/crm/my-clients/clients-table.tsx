"use client";

import { formatCurrency } from "@/lib/utils";
import { SortableTable, type SortColumn } from "@/components/ui/sortable-table";

/** Serializable row for the My Clients roster (built server-side). */
export interface MyClientTableRow {
  account: string;
  grossRevenue: number;
  grossMargin: number;
  avgMarginPct: number | null;
  totalSpend: number;
  daysSinceLastPurchase: number | null;
  /** Whole days since the last email/Teams/calendar touchpoint; null when unknown. */
  daysSinceLastTouchpoint: number | null;
}

const dash = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-US"));

export function MyClientsTable({
  rows,
  touchpointsLive,
}: {
  rows: MyClientTableRow[];
  touchpointsLive: boolean;
}) {
  const columns: SortColumn<MyClientTableRow>[] = [
    {
      key: "account",
      label: "Name",
      sortValue: (r) => r.account,
      render: (r) => <span className="font-medium">{r.account}</span>,
    },
    {
      key: "grossMargin",
      label: "Gross margin",
      numeric: true,
      sortValue: (r) => r.grossMargin,
      render: (r) => formatCurrency(r.grossMargin),
    },
    {
      key: "grossRevenue",
      label: "Gross revenue",
      numeric: true,
      sortValue: (r) => r.grossRevenue,
      render: (r) => formatCurrency(r.grossRevenue),
    },
    {
      key: "avgMarginPct",
      label: "Avg margin",
      numeric: true,
      sortValue: (r) => r.avgMarginPct,
      render: (r) => (r.avgMarginPct == null ? "—" : `${r.avgMarginPct}%`),
    },
    {
      key: "totalSpend",
      label: "Total spend",
      numeric: true,
      sortValue: (r) => r.totalSpend,
      render: (r) => formatCurrency(r.totalSpend),
    },
    {
      key: "daysSinceLastPurchase",
      label: "Days since last purchase",
      numeric: true,
      sortValue: (r) => r.daysSinceLastPurchase,
      render: (r) => dash(r.daysSinceLastPurchase),
    },
    {
      key: "daysSinceLastTouchpoint",
      label: "Days since last touchpoint",
      numeric: true,
      sortValue: (r) => r.daysSinceLastTouchpoint,
      render: (r) =>
        touchpointsLive ? (
          dash(r.daysSinceLastTouchpoint)
        ) : (
          <span className="text-muted-foreground" title="Connect Microsoft 365 to populate touchpoints">
            —
          </span>
        ),
    },
  ];

  return (
    <SortableTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.account}
      initialSort={{ key: "grossRevenue", dir: "desc" }}
      emptyMessage="No clients yet — win an opportunity to see it here."
    />
  );
}
