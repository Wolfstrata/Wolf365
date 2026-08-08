import Link from "next/link";
import { Ticket } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card, StatItem, EmptyState } from "@/components/ui/primitives";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { PawTip } from "@/components/ui/paw-tip";
import { previewTicketImport } from "@/lib/silverfang/ticket-import-service";
import { TicketImportForm, WorklogImportForm } from "./import-form";

export const dynamic = "force-dynamic";

/**
 * Import SuperOps tickets into SilverFang.
 *
 * A preview and then the question, in that order: "overwrite 240 tickets?" is not
 * answerable until you can see how many 240 is and what it excludes.
 */
export default async function TicketImportPage() {
  await requirePermission("silverfang:configure");
  const preview = await previewTicketImport();

  return (
    <div>
      <PageHeader
        help={<PawTip topic="ticketImport" align="right" />}
        title="Import tickets from SuperOps"
        description="Turn synced SuperOps tickets into SilverFang tickets you can work, log time against and bill."
      />
      <div className="space-y-4 p-4 sm:p-8">
        <Breadcrumbs
          items={[
            { label: "Tickets", href: "/silverfang/tickets" },
            { label: "Import from SuperOps" },
          ]}
        />

        {preview.available === 0 ? (
          <Card>
            <EmptyState
              icon={<Ticket className="h-8 w-8" />}
              title="No SuperOps tickets are stored yet"
              description="The connector mirrors SuperOps tickets into Wolf365 first; this page then turns them into SilverFang tickets. Run the SuperOps ticket sync from Connector Data, then come back."
            />
          </Card>
        ) : (
          <>
            <Card>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                <StatItem label="SuperOps tickets" value={preview.available} />
                <StatItem
                  label="Not here yet"
                  value={<span className="text-primary">{preview.toCreate}</span>}
                />
                <StatItem label="Already imported" value={preview.existingOpen} />
                <StatItem label="Closed here" value={preview.existingClosed} />
                <StatItem
                  label="Client not linked"
                  value={
                    preview.noClient > 0 ? (
                      <span className="text-warning">{preview.noClient}</span>
                    ) : (
                      0
                    )
                  }
                />
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Matched by SuperOps ticket id, so re-running finds the same ticket rather than
                duplicating it. Imported tickets land on the Service Desk board, with the priority
                and status mapped across and the technician matched by name or address when that is
                unambiguous. A managed client&rsquo;s ticket also picks up their managed agreement,
                so imported work is not unrated.
              </p>
              {preview.noClient > 0 && (
                <p className="mt-2 text-xs text-warning">
                  {preview.noClient} ticket(s) belong to a SuperOps client with no Wolf365 client
                  linked, so there is nowhere to file them. Run{" "}
                  <Link href="/silverfang/clients" className="underline">
                    Import from SuperOps
                  </Link>{" "}
                  on the Clients page first.
                </p>
              )}
            </Card>

            <Card>
              <h2 className="mb-3 text-sm font-semibold">Step 1 — tickets</h2>
              {preview.noBoard ? (
                <p className="text-sm text-warning">
                  No active board with statuses exists, so nothing can be created. Run SilverFang
                  Setup first.
                </p>
              ) : (
                <TicketImportForm
                  toCreate={preview.toCreate}
                  existingOpen={preview.existingOpen}
                  existingClosed={preview.existingClosed}
                />
              )}
            </Card>

            <Card>
              <h2 className="mb-1 text-sm font-semibold">Step 2 — worklogs</h2>
              <p className="mb-3 text-xs text-muted-foreground">
                SuperOps worklogs become SilverFang time entries on the tickets above. Run it
                after the ticket import, because a worklog can only land on a ticket that is
                already here. Keyed on the worklog id, so running it twice adds nothing —
                duplicated hours would inflate utilisation, draw down a prepaid block twice and
                reach an invoice.
              </p>
              <WorklogImportForm />
              <p className="mt-3 text-xs text-muted-foreground">
                Entries arrive as <span className="font-medium">drafts</span>. Approving is what
                makes time billable, and an import does not make that decision for you. A worklog
                whose technician matches no Wolf365 user is counted and skipped rather than logged
                against whoever pressed the button.
              </p>
            </Card>

            <p className="text-xs text-muted-foreground">
              Mapped across from SuperOps: subject, description, priority, status, requester,
              category and sub-category, channel, technician, and the created and resolved dates.
              Ticket <span className="font-medium">notes and conversations</span> are not imported —
              the connector does not mirror them, so there is nothing to copy.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
