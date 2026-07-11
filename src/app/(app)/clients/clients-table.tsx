"use client";

import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { SortableTable, type SortColumn } from "@/components/ui/sortable-table";

export interface ClientListRow {
  id: string;
  name: string;
  hasTd: boolean;
  /** Non-archived, active-status, non-expired subscriptions. */
  liveCount: number;
  stellrId: string | null;
  subsCount: number;
  activeCount: number;
  monthlyMargin: number;
  marginPct: number;
  currency: string;
  hasQbo: boolean;
  active: boolean;
  negative: boolean;
}

export function ClientsTable({ rows }: { rows: ClientListRow[] }) {
  const columns: SortColumn<ClientListRow>[] = [
    {
      key: "name",
      label: "Client",
      sortValue: (r) => r.name.toLowerCase(),
      render: (r) => (
        <Link href={`/clients/${r.id}`} className="flex items-center gap-1.5 font-medium hover:underline">
          {r.negative && <TriangleAlert className="h-4 w-4 shrink-0 text-danger" />}
          {r.name}
        </Link>
      ),
    },
    {
      key: "stellrId",
      label: "TD SYNNEX #",
      sortValue: (r) => r.stellrId,
      render: (r) => (
        <span className="font-mono text-xs text-muted-foreground">{r.stellrId ?? "—"}</span>
      ),
    },
    {
      key: "subsCount",
      label: "Subscriptions",
      numeric: true,
      sortValue: (r) => (r.hasTd ? r.subsCount : null),
      render: (r) => (r.hasTd ? r.subsCount : "—"),
    },
    {
      key: "monthlyMargin",
      label: "Monthly margin",
      numeric: true,
      sortValue: (r) => (r.activeCount > 0 ? r.monthlyMargin : null),
      render: (r) =>
        r.activeCount > 0 ? (
          <span className={r.negative ? "font-medium text-danger" : ""}>
            {formatCurrency(r.monthlyMargin, r.currency)}
            <span className="ml-1 text-xs text-muted-foreground">({r.marginPct}%)</span>
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "qbo",
      label: "QBO",
      sortValue: (r) => (r.hasQbo ? 1 : 0),
      render: (r) =>
        r.hasQbo ? (
          <span className="text-success">Linked</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "status",
      label: "Status",
      sortValue: (r) => (r.active ? "Active" : "Inactive"),
      render: (r) =>
        r.active ? (
          <span className="text-muted-foreground">Active</span>
        ) : (
          <span className="text-warning">Inactive</span>
        ),
    },
  ];

  return (
    <SortableTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      initialSort={{ key: "name", dir: "asc" }}
      rowClassName={(r) => (r.negative ? "bg-danger/5" : undefined)}
    />
  );
}
