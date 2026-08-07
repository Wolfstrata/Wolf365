"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Star } from "lucide-react";
import type { SfTicketPriority } from "@prisma/client";
import { SortableTable, type SortColumn } from "@/components/ui/sortable-table";
import { LocalTime } from "@/components/ui/local-time";
import { PRIORITY_LABELS, PRIORITY_STYLES } from "@/lib/silverfang/constants";
import { formatHours } from "@/lib/silverfang/time";
import { queueSortKey } from "@/lib/silverfang/ticket-order";
import {
  moveTicketsToBoardAction,
  moveTicketsToProjectAction,
  type SfActionResult,
} from "../actions";
import { withReturnTo } from "@/lib/silverfang/return-to";

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

export interface BulkMoveOptions {
  boards: { id: string; name: string }[];
  projects: { id: string; name: string; clientName: string; phases: { id: string; name: string }[] }[];
}

export function TicketsTable({
  rows,
  returnTo,
  bulk,
}: {
  rows: TicketRow[];
  /**
   * Where a ticket opened from this table should return to. Set it on an embedded
   * table (a client, a project) so drilling in and coming back lands on the page
   * you were reading, not the global queue.
   */
  returnTo?: string;
  /** Pass to enable multi-select and the move bar. Omit for a read-only table. */
  bulk?: BulkMoveOptions;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // "Select all" means every row currently shown — i.e. after the filters, not
  // every ticket in the database. Saying so in the UI matters: a bulk move that
  // silently reached beyond what you can see would be alarming.
  const selectAll = () => setSelected(new Set(rows.map((r) => r.id)));
  const clearAll = () => setSelected(new Set());

  // Rows can change under a selection when filters change; drop ids that are gone
  // so the count never claims more than is actually selected.
  const selectedIds = rows.filter((r) => selected.has(r.id)).map((r) => r.id);
  const columns: SortColumn<TicketRow>[] = [
    ...(bulk
      ? [
          {
            key: "select",
            label: "",
            // Not sortable: sorting by selection would reorder the table under the
            // hand that is ticking boxes.
            sortValue: () => 0,
            render: (r: TicketRow) => (
              <input
                type="checkbox"
                checked={selected.has(r.id)}
                onChange={() => toggle(r.id)}
                aria-label={`Select ticket ${r.number}`}
                className="h-4 w-4"
              />
            ),
          } satisfies SortColumn<TicketRow>,
        ]
      : []),
    {
      key: "number",
      label: "#",
      numeric: true,
      sortValue: (r) => r.number,
      // Kept as a real link so keyboard and middle-click behave, even though the
      // whole row now navigates here too.
      render: (r) => (
        <Link
          href={withReturnTo(`/silverfang/tickets/${r.id}`, returnTo)}
          className="font-medium text-primary hover:underline"
        >
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
    <div className="space-y-3">
      {bulk && (
        <BulkMoveBar
          options={bulk}
          selectedIds={selectedIds}
          total={rows.length}
          onSelectAll={selectAll}
          onClear={clearAll}
        />
      )}
      <SortableTable
        columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      initialSort={{ key: "priority", dir: "asc" }}
      rowHref={(r) => withReturnTo(`/silverfang/tickets/${r.id}`, returnTo)}
      rowClassName={(r) =>
        r.slaBreached && !r.statusIsClosed
          ? "bg-danger/5"
          : r.slaAtRisk && !r.statusIsClosed
            ? "bg-warning/5"
            : undefined
      }
        emptyMessage="No tickets match these filters."
      />
    </div>
  );
}

/**
 * Select-all / clear, and the two move forms.
 *
 * Rendered above the table rather than as a floating bar, so it cannot cover rows
 * on a short list. Both moves post the selected ids as repeated hidden fields,
 * which is how a checkbox set naturally arrives at a server action.
 */
function BulkMoveBar({
  options,
  selectedIds,
  total,
  onSelectAll,
  onClear,
}: {
  options: BulkMoveOptions;
  selectedIds: string[];
  total: number;
  onSelectAll: () => void;
  onClear: () => void;
}) {
  const [boardState, boardAction, boardPending] = useActionState<SfActionResult | null, FormData>(
    moveTicketsToBoardAction,
    null,
  );
  const [projectState, projectAction, projectPending] = useActionState<
    SfActionResult | null,
    FormData
  >(moveTicketsToProjectAction, null);
  const [projectId, setProjectId] = useState("");

  const count = selectedIds.length;
  const phases = options.projects.find((p) => p.id === projectId)?.phases ?? [];
  const result = boardState ?? projectState;

  return (
    <div className="space-y-2 rounded-md border bg-card p-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className={count > 0 ? "font-medium" : "text-muted-foreground"}>
          {count} of {total} selected
        </span>
        <button
          type="button"
          onClick={onSelectAll}
          className="rounded-md border px-2 py-1 text-xs font-medium transition hover:bg-accent"
        >
          Select all shown
        </button>
        {count > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="rounded-md border px-2 py-1 text-xs font-medium transition hover:bg-accent"
          >
            Clear
          </button>
        )}
        {/* Said out loud, because a bulk action that reached past the current
            filters would be an unpleasant surprise. */}
        <span className="text-xs text-muted-foreground">
          &ldquo;All shown&rdquo; means the rows below, after filters — never the whole database.
        </span>
      </div>

      {count > 0 && (
        <div className="flex flex-wrap items-end gap-4 border-t pt-2">
          <form action={boardAction} className="flex flex-wrap items-end gap-2">
            {selectedIds.map((id) => (
              <input key={id} type="hidden" name="ticketIds" value={id} />
            ))}
            <label className="text-xs font-medium">
              Move to board
              <select
                name="boardId"
                required
                defaultValue=""
                className="mt-1 block w-44 rounded-md border bg-background px-2 py-1.5 text-sm"
              >
                <option value="">Choose…</option>
                {options.boards.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={boardPending || projectPending}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
            >
              {boardPending ? "Moving…" : `Move ${count}`}
            </button>
          </form>

          <form action={projectAction} className="flex flex-wrap items-end gap-2">
            {selectedIds.map((id) => (
              <input key={id} type="hidden" name="ticketIds" value={id} />
            ))}
            <label className="text-xs font-medium">
              Move to project
              <select
                name="projectId"
                required
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="mt-1 block w-56 rounded-md border bg-background px-2 py-1.5 text-sm"
              >
                <option value="">Choose…</option>
                {options.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.clientName} — {p.name}
                  </option>
                ))}
              </select>
            </label>
            {phases.length > 0 && (
              <label className="text-xs font-medium">
                Phase
                <select
                  name="projectPhaseId"
                  defaultValue=""
                  className="mt-1 block w-40 rounded-md border bg-background px-2 py-1.5 text-sm"
                >
                  <option value="">No phase</option>
                  {phases.map((ph) => (
                    <option key={ph.id} value={ph.id}>
                      {ph.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              type="submit"
              disabled={boardPending || projectPending || !projectId}
              className="rounded-md border px-3 py-1.5 text-sm font-medium transition hover:bg-accent disabled:opacity-60"
            >
              {projectPending ? "Moving…" : `Move ${count}`}
            </button>
          </form>
        </div>
      )}

      {result && (
        <p className={`text-xs ${result.ok ? "text-success" : "text-danger"}`}>{result.message}</p>
      )}
      {count > 0 && (
        <p className="text-xs text-muted-foreground">
          A ticket can only join a project belonging to its own client — others are skipped and
          named. Moving boards remaps each ticket&rsquo;s status to the equivalent on the new
          board; a closed ticket is never reopened to make a move fit.
        </p>
      )}
    </div>
  );
}
