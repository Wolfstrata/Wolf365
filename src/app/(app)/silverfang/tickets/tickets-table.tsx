"use client";

import Link from "next/link";
import { Star } from "lucide-react";
import type { SfTicketPriority } from "@prisma/client";
import { SortableTable, type SortColumn } from "@/components/ui/sortable-table";
import { LocalTime } from "@/components/ui/local-time";
import { PRIORITY_LABELS, PRIORITY_STYLES } from "@/lib/silverfang/constants";
import { formatHours } from "@/lib/silverfang/time";
import { queueSortKey } from "@/lib/silverfang/ticket-order";

export interface TicketRow {
  id: string;
  number: number;
  summary: string;
  client: string;
  clientId: string;
  contact: string | null;
  /** The requester or their company is flagged VIP — shown, and drives the order. */
  vip: boolean;
  board: string;
  status: string;
  statusIsClosed: boolean;
  priority: SfTicketPriority;
  assignee: string | null;
  actualHours: number;
  openedAt: string; // ISO
  /** Creation instant, which is what the ordering tie-breaks on. */
  createdAt: string; // ISO
  /** SLA state, precomputed server-side from business hours. */
  slaBreached: boolean;
  slaAtRisk: boolean;
  slaDueAt: string | null; // ISO
}

/** Compact SLA indicator: breach and at-risk are the states worth surfacing. */
function SlaCell({ row }: { row: TicketRow }) {
  if (row.statusIsClosed) return <span className="text-muted-foreground">—</span>;
  if (row.slaDueAt == null) return <span className="text-muted-foreground">No SLA</span>;
  const cls = row.slaBreached
    ? "bg-danger/15 text-danger"
    : row.slaAtRisk
      ? "bg-warning/15 text-warning"
      : "text-muted-foreground";
  const label = row.slaBreached ? "Breached" : row.slaAtRisk ? "At risk" : "On track";
  return (
    <span className="whitespace-nowrap">
      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
      <span className="ml-2 text-xs text-muted-foreground">
        <LocalTime value={row.slaDueAt} />
      </span>
    </span>
  );
}

export function TicketsTable({ rows }: { rows: TicketRow[] }) {
  const columns: SortColumn<TicketRow>[] = [
    {
      key: "number",
      label: "#",
      numeric: true,
      sortValue: (r) => r.number,
      // Kept as a real link so keyboard and middle-click behave, even though the
      // whole row now navigates here too.
      render: (r) => (
        <Link href={`/silverfang/tickets/${r.id}`} className="font-medium text-primary hover:underline">
          {r.number}
        </Link>
      ),
    },
    {
      key: "summary",
      label: "Summary",
      sortValue: (r) => r.summary.toLowerCase(),
      render: (r) => <span className="font-medium">{r.summary}</span>,
    },
    {
      key: "client",
      label: "Client",
      sortValue: (r) => r.client.toLowerCase(),
      render: (r) => (
        <div>
          <Link href={`/silverfang/clients/${r.clientId}`} className="text-primary hover:underline">
            {r.client}
          </Link>
          {r.contact && <div className="text-xs text-muted-foreground">{r.contact}</div>}
        </div>
      ),
    },
    {
      key: "priority",
      label: "Priority",
      // Sorts by the full queue rule, not the bare priority: this is the column
      // that means "work order", and priority alone would leave the VIP and age
      // tiebreaks to whatever order the rows arrived in.
      sortValue: (r) => queueSortKey(r),
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_STYLES[r.priority]}`}
          >
            {PRIORITY_LABELS[r.priority]}
          </span>
          {r.vip && (
            <span
              title="VIP requester — sorts above others at the same priority"
              className="inline-flex items-center gap-0.5 rounded-full bg-warning/20 px-1.5 py-0.5 text-[10px] font-medium text-warning"
            >
              <Star className="h-3 w-3" />
              VIP
            </span>
          )}
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      sortValue: (r) => r.status.toLowerCase(),
      render: (r) => (
        <span className={r.statusIsClosed ? "text-muted-foreground" : ""}>{r.status}</span>
      ),
    },
    { key: "board", label: "Board", sortValue: (r) => r.board.toLowerCase(), render: (r) => r.board },
    {
      key: "assignee",
      label: "Assignee",
      sortValue: (r) => (r.assignee ?? "").toLowerCase(),
      render: (r) => r.assignee ?? <span className="text-muted-foreground">Unassigned</span>,
    },
    {
      key: "actualHours",
      label: "Time",
      numeric: true,
      sortValue: (r) => r.actualHours,
      render: (r) => formatHours(r.actualHours),
    },
    {
      key: "sla",
      label: "SLA",
      sortable: false,
      render: (r) => <SlaCell row={r} />,
    },
    {
      key: "openedAt",
      label: "Opened",
      sortValue: (r) => r.openedAt,
      render: (r) => <LocalTime value={r.openedAt} dateOnly />,
    },
  ];

  return (
    <SortableTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      initialSort={{ key: "priority", dir: "asc" }}
      rowHref={(r) => `/silverfang/tickets/${r.id}`}
      rowClassName={(r) =>
        r.slaBreached && !r.statusIsClosed
          ? "bg-danger/5"
          : r.slaAtRisk && !r.statusIsClosed
            ? "bg-warning/5"
            : undefined
      }
      emptyMessage="No tickets match these filters."
    />
  );
}
