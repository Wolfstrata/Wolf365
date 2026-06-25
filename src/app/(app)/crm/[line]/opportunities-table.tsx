"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronUp, ChevronDown, ChevronsUpDown, Lock, LockOpen } from "lucide-react";
import type { CrmStage } from "@prisma/client";
import { formatCurrency, formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { setOpportunityLockAction } from "../actions";

export interface OpportunityRow {
  id: string;
  name: string;
  account: string;
  owner: string;
  stage: CrmStage;
  stageLabel: string;
  stageOrder: number;
  tcv: number | null;
  mrr: number | null;
  marginPct: number | null;
  termYears: number;
  billingLabel: string;
  closeDate: string; // ISO
  createdAt: string; // ISO
  probability: number;
  isOpen: boolean;
  locked: boolean;
}

type SortKey =
  | "name"
  | "account"
  | "stageOrder"
  | "tcv"
  | "mrr"
  | "marginPct"
  | "termYears"
  | "closeDate"
  | "probability"
  | "createdAt";

type Dir = "asc" | "desc";

const STAGE_STYLES: Record<string, string> = {
  CLOSED_WON: "text-success",
  CLOSED_LOST: "text-danger",
};

interface Column {
  key: SortKey;
  label: string;
  numeric?: boolean;
  /** Value used for sorting. */
  sort: (r: OpportunityRow) => number | string;
}

const COLUMNS: Column[] = [
  { key: "name", label: "Opportunity", sort: (r) => r.name.toLowerCase() },
  { key: "account", label: "Account", sort: (r) => r.account.toLowerCase() },
  { key: "stageOrder", label: "Stage", sort: (r) => r.stageOrder },
  { key: "tcv", label: "TCV", numeric: true, sort: (r) => r.tcv ?? -1 },
  { key: "mrr", label: "MRR / mo", numeric: true, sort: (r) => r.mrr ?? -1 },
  { key: "marginPct", label: "Margin", numeric: true, sort: (r) => r.marginPct ?? -1 },
  { key: "termYears", label: "Term", numeric: true, sort: (r) => r.termYears },
  { key: "closeDate", label: "Close", sort: (r) => r.closeDate },
  { key: "probability", label: "Prob.", numeric: true, sort: (r) => r.probability },
  { key: "createdAt", label: "Created", sort: (r) => r.createdAt },
];

export function OpportunitiesTable({
  rows,
  canWrite,
}: {
  rows: OpportunityRow[];
  canWrite: boolean;
}) {
  // Default: newest opportunity first.
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [dir, setDir] = useState<Dir>("desc");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function toggleLock(id: string, currentlyLocked: boolean) {
    setPendingId(id);
    startTransition(async () => {
      await setOpportunityLockAction(id, !currentlyLocked);
      router.refresh();
      setPendingId(null);
    });
  }

  function toggle(key: SortKey) {
    if (key === sortKey) {
      setDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Text columns default A→Z; numeric/date default high→recent first.
      const col = COLUMNS.find((c) => c.key === key);
      setDir(col && !col.numeric && key !== "closeDate" && key !== "createdAt" ? "asc" : "desc");
    }
  }

  const sorted = [...rows].sort((a, b) => {
    const col = COLUMNS.find((c) => c.key === sortKey)!;
    const av = col.sort(a);
    const bv = col.sort(b);
    let cmp: number;
    if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
    else cmp = String(av).localeCompare(String(bv));
    return dir === "asc" ? cmp : -cmp;
  });

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium" aria-label="Sync lock" />
            {COLUMNS.map((c) => {
              const active = c.key === sortKey;
              const Icon = !active ? ChevronsUpDown : dir === "asc" ? ChevronUp : ChevronDown;
              return (
                <th key={c.key} className="px-4 py-2 font-medium">
                  <button
                    type="button"
                    onClick={() => toggle(c.key)}
                    className={cn(
                      "inline-flex items-center gap-1 hover:text-foreground",
                      active && "text-foreground",
                    )}
                  >
                    {c.label}
                    <Icon className="h-3 w-3" />
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((o) => {
            const LockIcon = o.locked ? Lock : LockOpen;
            const busy = isPending && pendingId === o.id;
            const title = o.locked
              ? "Locked — Salesforce won't overwrite this. Click to allow sync."
              : "Unlocked — Salesforce can update this. Click to lock.";
            return (
            <tr key={o.id} className="border-t hover:bg-accent/40">
              <td className="px-3 py-2">
                <button
                  type="button"
                  onClick={() => toggleLock(o.id, o.locked)}
                  disabled={!canWrite || busy}
                  title={title}
                  aria-label={title}
                  aria-pressed={o.locked}
                  className={cn(
                    "inline-flex items-center justify-center rounded p-1 transition",
                    o.locked ? "text-warning" : "text-muted-foreground",
                    canWrite ? "hover:bg-accent hover:text-foreground" : "cursor-default",
                    busy && "opacity-50",
                  )}
                >
                  <LockIcon className="h-4 w-4" />
                </button>
              </td>
              <td className="px-4 py-2 font-medium">
                <Link href={`/crm/edit/${o.id}`} className="hover:underline">
                  {o.name}
                </Link>
                <div className="text-xs text-muted-foreground">{o.owner}</div>
              </td>
              <td className="px-4 py-2">{o.account}</td>
              <td className="px-4 py-2">
                <span className={STAGE_STYLES[o.stage] ?? ""}>{o.stageLabel}</span>
              </td>
              <td className="px-4 py-2 tabular-nums">
                {o.tcv != null ? formatCurrency(o.tcv) : "—"}
              </td>
              <td className="px-4 py-2 tabular-nums">
                {o.mrr != null ? formatCurrency(o.mrr) : "—"}
              </td>
              <td className="px-4 py-2 tabular-nums">
                {o.marginPct != null ? `${o.marginPct.toFixed(1)}%` : "—"}
              </td>
              <td className="px-4 py-2 tabular-nums">
                {o.termYears} yr{o.termYears > 1 ? "s" : ""}
              </td>
              <td className="px-4 py-2 whitespace-nowrap">{formatDate(o.closeDate)}</td>
              <td className="px-4 py-2 tabular-nums">
                {o.isOpen ? `${o.probability}%` : "—"}
              </td>
              <td className="px-4 py-2 whitespace-nowrap">{formatDate(o.createdAt)}</td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
