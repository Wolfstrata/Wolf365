import { notFound } from "next/navigation";
import { Database } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, EmptyState } from "@/components/ui/primitives";
import {
  DataTable,
  type DataColumn,
  type DataRow,
} from "@/components/ui/data-table";
import { isSourceSlug, SOURCE_LABELS, SOURCE_BLURB } from "@/lib/connector-sources";
import { formatSortableDateTime } from "@/lib/utils";

async function loadSource(
  source: string,
  timeZone: string | null | undefined,
): Promise<{ columns: DataColumn[]; rows: DataRow[] }> {
  /** Zone-aware, lexically-sortable timestamp for the "Last synced" column. */
  const synced = (date: Date) => formatSortableDateTime(date, timeZone);
  switch (source) {
    case "td-synnex": {
      const list = await prisma.tdSynnexCustomer.findMany({
        orderBy: { name: "asc" },
        include: { _count: { select: { subscriptions: true } } },
      });
      const columns: DataColumn[] = [
        { key: "name", label: "Name" },
        { key: "domain", label: "Domain" },
        { key: "tenant", label: "MS Tenant" },
        { key: "subs", label: "Subscriptions", numeric: true },
        { key: "active", label: "Active" },
        { key: "synced", label: "Last synced" },
      ];
      const rows: DataRow[] = list.map((c) => ({
        id: c.id,
        href: `/synced/td-synnex/${c.id}`,
        cells: {
          name: c.name,
          domain: c.domain ?? "—",
          tenant: c.microsoftTenantId ?? "—",
          subs: c._count.subscriptions,
          active: c.active ? "Active" : "Inactive",
          synced: synced(c.lastSyncedAt),
        },
      }));
      return { columns, rows };
    }
    case "qbo": {
      const list = await prisma.qboCustomer.findMany({ orderBy: { displayName: "asc" } });
      const columns: DataColumn[] = [
        { key: "display", label: "Display name" },
        { key: "company", label: "Company" },
        { key: "email", label: "Billing email" },
        { key: "currency", label: "Currency" },
        { key: "tax", label: "Tax status" },
        { key: "active", label: "Active" },
        { key: "synced", label: "Last synced" },
      ];
      const rows: DataRow[] = list.map((c) => ({
        id: c.id,
        href: `/synced/qbo/${c.id}`,
        cells: {
          display: c.displayName,
          company: c.companyName ?? "—",
          email: c.billingEmail ?? "—",
          currency: c.currency ?? "—",
          tax: c.taxStatus ?? (c.taxable == null ? "Unknown" : c.taxable ? "Taxable" : "Non-taxable"),
          active: c.active ? "Active" : "Inactive",
          synced: synced(c.lastSyncedAt),
        },
      }));
      return { columns, rows };
    }
    case "superops": {
      const list = await prisma.superOpsClient.findMany({ orderBy: { name: "asc" } });
      const columns: DataColumn[] = [
        { key: "name", label: "Name" },
        { key: "superOpsId", label: "SuperOps ID" },
        { key: "synced", label: "Last synced" },
      ];
      const rows: DataRow[] = list.map((c) => ({
        id: c.id,
        href: `/synced/superops/${c.id}`,
        cells: { name: c.name, superOpsId: c.superOpsId, synced: synced(c.lastSyncedAt) },
      }));
      return { columns, rows };
    }
    case "hudu": {
      const list = await prisma.huduCompany.findMany({ orderBy: { name: "asc" } });
      const columns: DataColumn[] = [
        { key: "name", label: "Name" },
        { key: "huduId", label: "Hudu ID" },
        { key: "synced", label: "Last synced" },
      ];
      const rows: DataRow[] = list.map((c) => ({
        id: c.id,
        href: `/synced/hudu/${c.id}`,
        cells: { name: c.name, huduId: c.huduId, synced: synced(c.lastSyncedAt) },
      }));
      return { columns, rows };
    }
    default:
      return { columns: [], rows: [] };
  }
}

export default async function SyncedSourcePage({
  params,
}: {
  params: Promise<{ source: string }>;
}) {
  const user = await requirePermission("clients:read");
  const { source } = await params;
  if (!isSourceSlug(source)) notFound();

  const { columns, rows } = await loadSource(source, user.timezone);

  return (
    <div>
      <PageHeader title={SOURCE_LABELS[source]} description={SOURCE_BLURB[source]} />
      <div className="p-4 sm:p-8">
        {rows.length === 0 ? (
          <EmptyState
            icon={<Database className="h-8 w-8" />}
            title="No records synced"
            description="Run a sync for this connector, then refresh to validate the data here."
          />
        ) : (
          <DataTable columns={columns} rows={rows} searchPlaceholder="Filter by any column…" />
        )}
      </div>
    </div>
  );
}
