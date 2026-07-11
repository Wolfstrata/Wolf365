"use client";

import Link from "next/link";
import { formatCurrency } from "@/lib/utils";
import { SortableTable, type SortColumn } from "@/components/ui/sortable-table";
import { ArchiveToggle } from "@/components/licensing/archive-toggle";
import type {
  MarginRow,
  LeakageRow,
  OverbillingRow,
  RenewalReportRow,
  MarginExceptionRow,
  ExpiredLicenseRow,
} from "@/lib/reports/queries";

const RENEWAL_BADGE: Record<number, string> = {
  30: "bg-danger/15 text-danger",
  60: "bg-warning/15 text-warning",
  90: "bg-accent text-accent-foreground",
};

/** Client name cell — links to the client profile when we know the client id. */
function clientCell(client: string, clientId: string | null) {
  return clientId ? (
    <Link href={`/clients/${clientId}`} className="text-primary hover:underline">
      {client}
    </Link>
  ) : (
    client
  );
}

export function MarginTableView({ rows }: { rows: MarginRow[] }) {
  const columns: SortColumn<MarginRow>[] = [
    { key: "client", label: "Client", sortValue: (r) => r.client.toLowerCase(), render: (r) => r.client },
    { key: "description", label: "Description", sortValue: (r) => r.description.toLowerCase(), render: (r) => r.description },
    { key: "revenue", label: "Revenue", numeric: true, sortValue: (r) => r.revenue, render: (r) => formatCurrency(r.revenue) },
    { key: "estimatedCost", label: "Est. cost", numeric: true, sortValue: (r) => r.estimatedCost, render: (r) => formatCurrency(r.estimatedCost) },
    { key: "margin", label: "Margin", numeric: true, sortValue: (r) => r.margin, render: (r) => formatCurrency(r.margin) },
    { key: "marginPct", label: "Margin %", numeric: true, sortValue: (r) => r.marginPct, render: (r) => `${r.marginPct}%` },
  ];
  return <SortableTable columns={columns} rows={rows} rowKey={(_, i) => String(i)} />;
}

export function LeakageTableView({ rows }: { rows: LeakageRow[] }) {
  const columns: SortColumn<LeakageRow>[] = [
    { key: "client", label: "Client", sortValue: (r) => r.client.toLowerCase(), render: (r) => r.client },
    { key: "sku", label: "SKU", sortValue: (r) => r.sku, render: (r) => r.sku },
    { key: "product", label: "Product", sortValue: (r) => r.product.toLowerCase(), render: (r) => r.product },
    { key: "quantity", label: "Qty", numeric: true, sortValue: (r) => r.quantity, render: (r) => r.quantity },
    { key: "estimatedMonthlyCost", label: "Est. monthly cost", numeric: true, sortValue: (r) => r.estimatedMonthlyCost, render: (r) => formatCurrency(r.estimatedMonthlyCost) },
  ];
  return <SortableTable columns={columns} rows={rows} rowKey={(_, i) => String(i)} />;
}

export function OverbillingTableView({ rows }: { rows: OverbillingRow[] }) {
  const columns: SortColumn<OverbillingRow>[] = [
    { key: "client", label: "Client", sortValue: (r) => r.client.toLowerCase(), render: (r) => r.client },
    { key: "description", label: "Description", sortValue: (r) => r.description.toLowerCase(), render: (r) => r.description },
    { key: "total", label: "Total", numeric: true, sortValue: (r) => r.total, render: (r) => formatCurrency(r.total) },
    { key: "reason", label: "Reason", sortValue: (r) => r.reason.toLowerCase(), render: (r) => r.reason },
  ];
  return <SortableTable columns={columns} rows={rows} rowKey={(_, i) => String(i)} />;
}

export function RenewalsTableView({ rows }: { rows: RenewalReportRow[] }) {
  const columns: SortColumn<RenewalReportRow>[] = [
    { key: "client", label: "Client", sortValue: (r) => r.client.toLowerCase(), render: (r) => clientCell(r.client, r.clientId) },
    { key: "sku", label: "SKU", sortValue: (r) => r.sku, render: (r) => r.sku },
    { key: "product", label: "Product", sortValue: (r) => r.product.toLowerCase(), render: (r) => r.product },
    { key: "quantity", label: "Qty", numeric: true, sortValue: (r) => r.quantity, render: (r) => r.quantity },
    { key: "renewalDate", label: "Renews", sortValue: (r) => r.renewalDate, render: (r) => r.renewalDate },
    {
      key: "daysUntil",
      label: "In",
      sortValue: (r) => r.daysUntil,
      render: (r) => (
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${RENEWAL_BADGE[r.bucket]}`}>
          {r.daysUntil}d
        </span>
      ),
    },
  ];
  return <SortableTable columns={columns} rows={rows} rowKey={(_, i) => String(i)} initialSort={{ key: "daysUntil", dir: "asc" }} />;
}

export function MarginExceptionsTableView({ rows }: { rows: MarginExceptionRow[] }) {
  const columns: SortColumn<MarginExceptionRow>[] = [
    { key: "client", label: "Client", sortValue: (r) => r.client.toLowerCase(), render: (r) => clientCell(r.client, r.clientId) },
    { key: "sku", label: "SKU", sortValue: (r) => r.sku, render: (r) => r.sku },
    { key: "product", label: "Product", sortValue: (r) => r.product.toLowerCase(), render: (r) => r.product },
    { key: "quantity", label: "Qty", numeric: true, sortValue: (r) => r.quantity, render: (r) => r.quantity },
    { key: "unitCost", label: "Unit cost", numeric: true, sortValue: (r) => r.unitCost, render: (r) => formatCurrency(r.unitCost) },
    { key: "customerPrice", label: "Cust. price / MSRP", numeric: true, sortValue: (r) => r.customerPrice, render: (r) => formatCurrency(r.customerPrice) },
    {
      key: "marginPerUnit",
      label: "Margin",
      numeric: true,
      sortValue: (r) => r.marginPerUnit,
      render: (r) => <span className="font-medium text-danger">{formatCurrency(r.marginPerUnit)}</span>,
    },
  ];
  return <SortableTable columns={columns} rows={rows} rowKey={(_, i) => String(i)} initialSort={{ key: "marginPerUnit", dir: "asc" }} />;
}

export function ExpiredTableView({
  rows,
  canArchive,
}: {
  rows: ExpiredLicenseRow[];
  canArchive: boolean;
}) {
  const columns: SortColumn<ExpiredLicenseRow>[] = [
    {
      key: "archive",
      label: "Archive",
      sortable: false,
      render: (r) => (
        <ArchiveToggle subscriptionId={r.subscriptionId} archived={false} canArchive={canArchive} />
      ),
    },
    { key: "client", label: "Client", sortValue: (r) => r.client.toLowerCase(), render: (r) => clientCell(r.client, r.clientId) },
    { key: "sku", label: "SKU", sortValue: (r) => r.sku, render: (r) => r.sku },
    { key: "product", label: "Product", sortValue: (r) => r.product.toLowerCase(), render: (r) => r.product },
    { key: "quantity", label: "Qty", numeric: true, sortValue: (r) => r.quantity, render: (r) => r.quantity },
    {
      key: "expiryDate",
      label: "Expired",
      sortValue: (r) => r.daysAgo,
      render: (r) => (
        <span className="font-medium text-orange-600 dark:text-orange-400">
          {r.expiryDate}
          {r.daysAgo != null && (
            <span className="ml-1 text-xs text-muted-foreground">({r.daysAgo}d ago)</span>
          )}
        </span>
      ),
    },
    { key: "status", label: "Status", sortValue: (r) => r.status.toLowerCase(), render: (r) => r.status },
  ];
  return <SortableTable columns={columns} rows={rows} rowKey={(r) => r.subscriptionId} />;
}
