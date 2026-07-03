"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { setLeadStatusAction, LEAD_STATUSES } from "./actions";

export interface LeadRow {
  id: string;
  name: string;
  company: string;
  title: string;
  email: string;
  phone: string;
  source: string;
  status: string;
  created: string; // readable, lexically sortable
}

const STATUS_TONES: Record<string, string> = {
  NEW: "bg-primary/15 text-primary",
  CONTACTED: "bg-warning/15 text-warning",
  QUALIFIED: "bg-success/15 text-success",
  DISQUALIFIED: "bg-muted text-muted-foreground",
  CONVERTED: "bg-success/15 text-success",
};

/** Filterable leads list with inline status management. */
export function LeadsTable({ rows, canWrite }: { rows: LeadRow[]; canWrite: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (!needle) return true;
      return [r.name, r.company, r.title, r.email, r.phone, r.source]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [rows, query, statusFilter]);

  function changeStatus(id: string, status: string) {
    startTransition(async () => {
      await setLeadStatusAction(id, status);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter leads…"
            className="w-72 rounded-md border bg-background py-1.5 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">All statuses</option>
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.charAt(0) + s.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          {visible.length} of {rows.length}
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Company</th>
              <th className="px-4 py-2 font-medium">Title</th>
              <th className="px-4 py-2 font-medium">Email</th>
              <th className="px-4 py-2 font-medium">Phone</th>
              <th className="px-4 py-2 font-medium">Source</th>
              <th className="px-4 py-2 font-medium">Created</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id} className="border-t align-middle hover:bg-accent/40">
                <td className="px-4 py-2 font-medium">{r.name || "—"}</td>
                <td className="px-4 py-2">{r.company || "—"}</td>
                <td className="px-4 py-2">{r.title || "—"}</td>
                <td className="px-4 py-2">
                  {r.email ? (
                    <a href={`mailto:${r.email}`} className="text-primary hover:underline">
                      {r.email}
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-2 whitespace-nowrap">{r.phone || "—"}</td>
                <td className="px-4 py-2">{r.source}</td>
                <td className="px-4 py-2 whitespace-nowrap">{r.created}</td>
                <td className="px-4 py-2">
                  {canWrite ? (
                    <select
                      value={r.status}
                      disabled={pending}
                      onChange={(e) => changeStatus(r.id, e.target.value)}
                      className={cn(
                        "rounded-md border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring",
                        pending && "opacity-60",
                      )}
                    >
                      {LEAD_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s.charAt(0) + s.slice(1).toLowerCase()}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                        STATUS_TONES[r.status] ?? "bg-muted text-muted-foreground",
                      )}
                    >
                      {r.status.charAt(0) + r.status.slice(1).toLowerCase()}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
