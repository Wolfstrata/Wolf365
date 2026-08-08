import Link from "next/link";
import { CheckCircle2, CircleAlert } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card } from "@/components/ui/primitives";
import { PawTip } from "@/components/ui/paw-tip";
import { LocalTime } from "@/components/ui/local-time";
import {
  coverageComplete,
  migrationCoverage,
  migrationPolicy,
} from "@/lib/silverfang/migration-policy";
import { CutoverForm, NoteImportForm, NoteSyncForm } from "./cutover-form";

export const dynamic = "force-dynamic";

/**
 * The SuperOps → SilverFang migration, and the switch that ends it.
 *
 * The question this page answers is "am I safe to cancel the subscription?", and
 * that is a question about coverage rather than about whether the buttons have
 * been pressed. So it compares what Wolf365 has mirrored against what it has
 * imported, line by line, and is explicit about the one thing it cannot know:
 * whether the mirror itself is complete.
 */
export default async function MigrationPage() {
  // Administrator only. A SilverFang administrator runs the service desk; turning
  // a connector off for the whole install — and with it every sync and import —
  // is not part of running the service desk.
  await requirePermission("connectors:configure");
  const [policy, coverage] = await Promise.all([migrationPolicy(), migrationCoverage()]);
  const complete = coverageComplete(coverage);

  const rows = [
    { label: "Clients linked", mirrored: null, imported: null, gap: coverage.unlinkedClients,
      gapLabel: "SuperOps clients with no Wolf365 client" },
    { label: "Tickets", mirrored: coverage.superOpsTickets, imported: coverage.importedTickets },
    { label: "Time entries", mirrored: coverage.superOpsWorklogs, imported: coverage.importedTimeEntries },
    { label: "Conversations", mirrored: coverage.superOpsNotes, imported: coverage.importedNotes },
    { label: "Contacts", mirrored: coverage.superOpsContacts, imported: coverage.importedContacts },
  ];

  const outstanding: string[] = [];
  if (coverage.unlinkedClients > 0) {
    outstanding.push(
      `${coverage.unlinkedClients} SuperOps client(s) are not linked to a Wolf365 client, so nothing of theirs can import.`,
    );
  }
  for (const r of rows) {
    if (r.mirrored == null || r.imported == null) continue;
    if (r.imported < r.mirrored) {
      outstanding.push(`${r.label}: ${r.mirrored - r.imported} mirrored but not imported.`);
    }
  }

  return (
    <div>
      <PageHeader
        help={<PawTip topic="migration" align="right" />}
        title="SuperOps migration"
        description="Bring the history across, then switch SuperOps off and make SilverFang the source of truth."
      />
      <div className="space-y-4 p-4 sm:p-8">
        <Card>
          <p className="text-sm">
            Status:{" "}
            {policy.superOpsEnabled ? (
              <span className="font-medium text-success">SuperOps is on</span>
            ) : (
              <span className="font-medium text-warning">SuperOps is off</span>
            )}
            {policy.cutoverAt && (
              <>
                {" — switched off "}
                <LocalTime value={policy.cutoverAt.toISOString()} />
                {policy.updatedByEmail ? ` by ${policy.updatedByEmail}` : ""}
              </>
            )}
            .
          </p>
          {policy.notes && (
            <p className="mt-1 text-xs text-muted-foreground">{policy.notes}</p>
          )}
        </Card>

        <Card>
          <h2 className="mb-1 text-sm font-semibold">Coverage</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            What Wolf365 has mirrored from SuperOps, against what has been imported into
            SilverFang. Both numbers come from this database.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-1 pr-4 font-medium">What</th>
                  <th className="py-1 pr-4 text-right font-medium">Mirrored</th>
                  <th className="py-1 pr-4 text-right font-medium">Imported</th>
                  <th className="py-1 pr-4 font-medium">State</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const ok =
                    r.gap != null
                      ? r.gap === 0
                      : (r.imported ?? 0) >= (r.mirrored ?? 0);
                  return (
                    <tr key={r.label} className="border-t">
                      <td className="py-1.5 pr-4 font-medium">{r.label}</td>
                      <td className="py-1.5 pr-4 text-right tabular-nums">
                        {r.mirrored ?? "—"}
                      </td>
                      <td className="py-1.5 pr-4 text-right tabular-nums">
                        {r.imported ?? "—"}
                      </td>
                      <td className="py-1.5 pr-4">
                        {ok ? (
                          <span className="inline-flex items-center gap-1 text-success">
                            <CheckCircle2 className="h-3.5 w-3.5" /> All across
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-warning">
                            <CircleAlert className="h-3.5 w-3.5" />
                            {r.gap != null ? `${r.gap} ${r.gapLabel}` : "Outstanding"}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            What this <span className="font-medium">cannot</span> tell you is whether the mirror
            itself is complete — that is, whether the connector has pulled every ticket SuperOps
            holds. The ticket sync is resumable and reports &ldquo;Backfill complete&rdquo; when
            it has reached the end; check that on{" "}
            <Link href="/synced/superops" className="text-primary hover:underline">
              Connector Data
            </Link>{" "}
            before trusting these totals.
          </p>
        </Card>

        <Card>
          <h2 className="mb-1 text-sm font-semibold">Conversations</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Ticket notes and replies, imported onto the tickets already here. Run the ticket
            import first. Anything SuperOps did not clearly mark as client-visible becomes an
            internal note — a leaked internal note cannot be taken back, so unknown means private.
          </p>
          <div className="space-y-3">
            <div>
              <p className="mb-1.5 text-xs font-medium">Step 1 — mirror from SuperOps</p>
              <NoteSyncForm />
            </div>
            <div className="border-t pt-3">
              <p className="mb-1.5 text-xs font-medium">Step 2 — import onto the tickets</p>
              <NoteImportForm />
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            The mirror reads conversations already embedded in the synced ticket data first,
            which costs no extra API call, and falls back to a per-ticket conversation query
            discovered by introspecting your SuperOps schema. If your tenant exposes neither, it
            says so — that is different from your tickets having no history, and worth knowing
            before you cancel.
          </p>
        </Card>

        <Card>
          <h2 className="mb-1 text-sm font-semibold">Cutover</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            One switch for the whole install. Off stops the scheduled sync, the manual syncs and
            every import path — SilverFang becomes the source of truth.
          </p>
          <CutoverForm
            enabled={policy.superOpsEnabled}
            complete={complete}
            outstanding={outstanding}
          />
        </Card>
      </div>
    </div>
  );
}
