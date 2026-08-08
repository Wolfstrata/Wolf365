import { History } from "lucide-react";
import { PawTip } from "@/components/ui/paw-tip";
import { LocalTime } from "@/components/ui/local-time";
import type { ChangeLogRow } from "@/lib/silverfang/change-log";

/** Field names rendered as something a person would say. */
const FIELD_LABELS: Record<string, string> = {
  clientId: "client",
  firstName: "first name",
  lastName: "last name",
  isPrimary: "primary contact",
  allowClientEmail: "allow email to client",
  defaultBoardId: "default board",
  defaultAgreementId: "default agreement",
  accountManager: "account manager",
  sendAsAddress: "reply-from address",
  fallbackClientId: "unrecognised-sender client",
  defaultPriority: "default priority",
  ignoreBefore: "mail cutoff",
  outboundEnabled: "outbound email",
  active: "active",
  vip: "VIP",
};

function label(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

function value(v: string | null): string {
  if (v === null) return "empty";
  if (v === "true") return "on";
  if (v === "false") return "off";
  return v;
}

/**
 * Field-level history for one record: who changed what, from what, when.
 * Append-only, so it still shows edits made before a value was changed back.
 */
export function ChangeTrail({
  rows,
  emptyHint,
}: {
  rows: ChangeLogRow[];
  emptyHint?: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {emptyHint ?? "No changes have been recorded yet."}
      </p>
    );
  }

  return (
    <ul className="space-y-2 text-sm">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-xs text-muted-foreground">
            <LocalTime value={r.createdAt.toISOString()} />
          </span>
          {r.operation === "CREATE" ? (
            <span className="text-success">Created</span>
          ) : r.operation === "DELETE" ? (
            <span className="text-danger">Deleted</span>
          ) : (
            <span>
              <span className="font-medium">{label(r.field)}</span>{" "}
              <span className="text-muted-foreground">
                {value(r.oldValue)} → {value(r.newValue)}
              </span>
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            · {r.actorEmail ?? "system"}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Card heading used alongside the trail. */
export function ChangeTrailHeading({ count }: { count: number }) {
  return (
    <h2 className="mb-3 inline-flex items-center gap-2 text-sm font-semibold">
      <History className="h-4 w-4" /> Change history ({count}) <PawTip topic="changeTrail" />
    </h2>
  );
}
