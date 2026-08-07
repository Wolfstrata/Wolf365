import Link from "next/link";
import { CircleCheck, CircleSlash, TriangleAlert } from "lucide-react";
import { LocalTime } from "@/components/ui/local-time";
import { describeDecision, type DecisionKind } from "@/lib/silverfang/ingest-outcomes";

export interface MailEventRow {
  id: string;
  decision: string;
  detail: string | null;
  fromAddress: string | null;
  subject: string | null;
  mailbox: string | null;
  ticketId: string | null;
  ticketNumber: number | null;
  at: Date;
}

const ICONS: Record<DecisionKind, typeof CircleCheck> = {
  filed: CircleCheck,
  ignored: CircleSlash,
  problem: TriangleAlert,
};

const TONES: Record<DecisionKind, string> = {
  filed: "text-success",
  ignored: "text-muted-foreground",
  problem: "text-warning",
};

/**
 * What happened to recent inbound mail.
 *
 * Every message gets a row, including the ones that were correctly ignored,
 * because "why did nothing happen?" is the question this answers. A deliberate
 * skip and a configuration gap look different on purpose — the first needs no
 * action, the second says what to do.
 */
export function MailEvents({
  events,
  problems,
  showAll,
}: {
  events: MailEventRow[];
  problems: number;
  showAll: boolean;
}) {
  if (events.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {showAll
          ? "No inbound mail has been processed in the last 30 days."
          : "Nothing needed attention in the last 30 days."}{" "}
        {!showAll && (
          <Link href="?mail=all" className="underline">
            Show everything
          </Link>
        )}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <Link
          href="?mail=problems"
          className={`rounded-md border px-2 py-1 ${!showAll ? "bg-accent font-medium" : ""}`}
        >
          Needs attention{problems > 0 ? ` (${problems})` : ""}
        </Link>
        <Link
          href="?mail=all"
          className={`rounded-md border px-2 py-1 ${showAll ? "bg-accent font-medium" : ""}`}
        >
          Everything
        </Link>
        <span className="text-muted-foreground">Kept for 30 days.</span>
      </div>

      <ul className="divide-y">
        {events.map((e) => {
          const info = describeDecision(e.decision);
          const Icon = ICONS[info.kind];
          return (
            <li key={e.id} className="py-2.5 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${TONES[info.kind]}`} />
                <span className={`font-medium ${TONES[info.kind]}`}>{info.label}</span>
                <span className="text-muted-foreground">·</span>
                {/* The sender is the actionable part of an unmatched message: it is
                    who to add as a contact. */}
                <span className="font-mono text-xs">{e.fromAddress ?? "(no sender)"}</span>
                {e.ticketNumber != null && e.ticketId && (
                  <Link
                    href={`/silverfang/tickets/${e.ticketId}`}
                    className="text-xs underline"
                  >
                    #{e.ticketNumber}
                  </Link>
                )}
                <span className="ml-auto text-xs text-muted-foreground">
                  <LocalTime value={e.at} />
                </span>
              </div>
              {e.subject && (
                <p className="mt-0.5 truncate pl-6 text-xs text-muted-foreground">{e.subject}</p>
              )}
              <p className="mt-0.5 pl-6 text-xs text-muted-foreground">{info.explanation}</p>
              {e.detail && (
                <p className="mt-0.5 pl-6 text-xs text-muted-foreground">{e.detail}</p>
              )}
              {info.remedy && (
                <p className="mt-1 pl-6 text-xs">
                  <span className="font-medium">To fix: </span>
                  {info.remedy}
                </p>
              )}
              {e.mailbox && (
                <p className="mt-0.5 pl-6 text-xs text-muted-foreground">via {e.mailbox}</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
