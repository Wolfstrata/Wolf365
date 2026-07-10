"use client";

import Link from "next/link";
import { SortableTable, type SortColumn } from "@/components/ui/sortable-table";
import { ArchiveToggle } from "@/components/licensing/archive-toggle";
import type { ArchivedLicenseRow } from "@/lib/reports/queries";

export function ArchivedTable({
  rows,
  canArchive,
}: {
  rows: ArchivedLicenseRow[];
  canArchive: boolean;
}) {
  const columns: SortColumn<ArchivedLicenseRow>[] = [
    {
      key: "client",
      label: "Client",
      sortValue: (r) => r.client.toLowerCase(),
      render: (r) =>
        r.clientId ? (
          <Link href={`/clients/${r.clientId}`} className="text-primary hover:underline">
            {r.client}
          </Link>
        ) : (
          r.client
        ),
    },
    {
      key: "sku",
      label: "SKU",
      sortValue: (r) => r.sku,
      render: (r) => <span className="font-mono text-xs text-muted-foreground">{r.sku}</span>,
    },
    { key: "product", label: "Product", sortValue: (r) => r.product.toLowerCase(), render: (r) => r.product },
    { key: "quantity", label: "Qty", numeric: true, sortValue: (r) => r.quantity, render: (r) => r.quantity },
    {
      key: "expiryDate",
      label: "Expired",
      sortValue: (r) => r.expiryDate,
      render: (r) => <span className="text-orange-600 dark:text-orange-400">{r.expiryDate}</span>,
    },
    { key: "status", label: "Status", sortValue: (r) => r.status.toLowerCase(), render: (r) => r.status },
    {
      key: "restore",
      label: "Restore",
      sortable: false,
      render: (r) => (
        <ArchiveToggle subscriptionId={r.subscriptionId} archived={true} canArchive={canArchive} />
      ),
    },
  ];
  return <SortableTable columns={columns} rows={rows} rowKey={(r) => r.subscriptionId} initialSort={{ key: "client", dir: "asc" }} />;
}
