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
import { previewTicketImport } from "@/lib/silverfang/ticket-import-service";
import {
  SuperOpsAccountSyncButton,
  SuperOpsTicketSyncButton,
} from "../../synced/[source]/superops-sync";
import { ImportSuperOpsButton } from "../clients/import-button";
import { TicketImportForm, WorklogImportForm } from "../tickets/import/import-form";
import { CutoverForm, NoteImportForm, NoteSyncForm } from "./cutover-form";
import { Step, StageHeading } from "./runbook";

export const dynamic = "force-dynamic";

/**
 * The SuperOps → SilverFang migration: every step in the order it has to happen,
 * the coverage that says whether it worked, and the switch that ends it.
 *
 * The question this page answers is "am I safe to cancel the subscription?", and
 * that is a question about coverage rather than about whether the buttons have
 * been pressed. So it compares what Wolf365 has mirrored against what it has
 * imported, line by line, and is explicit about the one thing it cannot know:
 * whether the mirror itself is complete.
 *
 * The steps come first because the coverage is meaningless until they have been
 * run, and they are here rather than only on their own screens because the order
 * is load-bearing — a worklog cannot import onto a ticket that is not here yet.
 * Each step renders the very same component as the screen it also lives on.
 */
export default async function MigrationPage() {
  // Administrator only. A SilverFang administrator runs the service desk; turning
  // a connector off for the whole install — and with it every sync and import —
  // is not part of running the service desk.
  await requirePermission("connectors:configure");
  const [policy, coverage, ticketPreview] = await Promise.all([
    migrationPolicy(),
    migrationCoverage(),
    previewTicketImport(),
  ]);
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

        {!policy.superOpsEnabled && (
          <Card>
            <p className="text-sm text-warning">
              SuperOps is switched off, so every step below is refused. Turn it back on in
              Cutover if you need to bring more history across.
            </p>
          </Card>
        )}

        <Card>
          <StageHeading
            label="Stage 1 of 2"
            title="Mirror SuperOps into Wolf365"
            detail="A faithful read-only copy, before anything is interpreted. This is what makes the migration survive your subscription ending: the mapping can be corrected and re-imported later without going back to an API that is gone."
          />
          <Step
            n={1}
            title="Account data"
            detail="Clients, sites, contacts, assets, contracts and invoices. Runs to completion in one go."
            where="Connector Data"
            href="/synced/superops"
          >
            <SuperOpsAccountSyncButton />
          </Step>
          <Step
            n={2}
            title="Tickets and worklogs"
            detail="Bounded and resumable — 500 tickets and 1000 worklogs per run, then it checkpoints. Keep pressing until it says “Backfill complete”; that message is the only reliable sign the mirror is whole. The daily sync also runs one chunk, so you can leave it to grind instead."
            where="Connector Data"
            href="/synced/superops"
          >
            <SuperOpsTicketSyncButton />
          </Step>
          <Step
            n={3}
            title="Conversations"
            detail="Reads history already embedded in the synced ticket data first, which costs no extra API call, then falls back to a per-ticket query discovered by introspecting your SuperOps schema. If your tenant exposes neither it says so — that is different from your tickets having no history, and worth knowing before you cancel."
          >
            <NoteSyncForm />
          </Step>
        </Card>

        <Card>
          <StageHeading
            label="Stage 2 of 2"
            title="Import into SilverFang"
            detail="Turns the mirror into records you can work, log time against and bill. Every step is keyed on its SuperOps id, so re-running finds the same record rather than duplicating it — but the order matters, and each step here depends on the one above it."
          />
          <Step
            n={4}
            title="Clients and contacts"
            detail={
              coverage.unlinkedClients > 0
                ? `First, always: ${coverage.unlinkedClients} SuperOps client(s) have no Wolf365 client linked, and nothing of theirs can import until they do.`
                : "First, always. A ticket whose SuperOps client is not linked to a Wolf365 client has nowhere to be filed. Every client is currently linked."
            }
            where="Clients"
            href="/silverfang/clients"
          >
            <ImportSuperOpsButton className="space-y-2" />
          </Step>
          <Step
            n={5}
            title="Tickets"
            detail={`${ticketPreview.available} mirrored · ${ticketPreview.toCreate} not here yet · ${ticketPreview.existingOpen} already imported · ${ticketPreview.existingClosed} closed here${
              ticketPreview.noClient > 0
                ? ` · ${ticketPreview.noClient} with no linked client, which step 4 fixes`
                : ""
            }.`}
            where="Import tickets"
            href="/silverfang/tickets/import"
          >
            {ticketPreview.noBoard ? (
              <p className="text-sm text-warning">
                No active board with statuses exists, so nothing can be created. Run{" "}
                <Link href="/silverfang/setup" className="underline">
                  SilverFang Setup
                </Link>{" "}
                first.
              </p>
            ) : ticketPreview.available === 0 ? (
              <p className="text-sm text-muted-foreground">
                No SuperOps tickets are mirrored yet — run step 2 first.
              </p>
            ) : (
              <TicketImportForm
                toCreate={ticketPreview.toCreate}
                existingOpen={ticketPreview.existingOpen}
                existingClosed={ticketPreview.existingClosed}
                disabled={!policy.superOpsEnabled}
              />
            )}
          </Step>
          <Step
            n={6}
            title="Worklogs as time entries"
            detail="After the tickets, because a worklog can only land on a ticket that is already here. Entries arrive as drafts — approving is what makes time billable, and an import does not make that decision for you. A worklog whose technician matches no Wolf365 user is counted and skipped, never logged against whoever pressed the button."
            where="Import tickets"
            href="/silverfang/tickets/import"
          >
            <WorklogImportForm />
          </Step>
          <Step
            n={7}
            title="Conversations as ticket notes"
            detail="Last, because a note needs its ticket. Anything SuperOps did not clearly mark client-visible becomes an internal note — a leaked internal note cannot be taken back, so unknown means private. Worth spot-checking a few tickets afterwards."
          >
            <NoteImportForm />
          </Step>
        </Card>

        <Card>
          <StageHeading
            label="Then check it worked"
            title="Coverage"
            detail="What Wolf365 has mirrored from SuperOps, against what has been imported into SilverFang. Both numbers come from this database."
          />
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
            it has reached the end; check that on step 2 above, or on{" "}
            <Link href="/synced/superops" className="text-primary hover:underline">
              Connector Data
            </Link>
            , before trusting these totals.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            While you are still running both systems, repeat stage 1 then stage 2 on whatever
            cadence suits you — every step finds the same records rather than duplicating them.
          </p>
        </Card>

        <Card>
          <StageHeading
            label="When coverage is clean"
            title="Cutover"
            detail="One switch for the whole install. Off stops the scheduled sync, the manual syncs and every import path — SilverFang becomes the source of truth."
          />
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
