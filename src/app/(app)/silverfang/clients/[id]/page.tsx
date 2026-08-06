import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, MailX, Plus, Star } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { PageHeader, Card, StatItem } from "@/components/ui/primitives";
import { LocalTime } from "@/components/ui/local-time";
import { formatCurrency } from "@/lib/utils";
import { formatHours } from "@/lib/silverfang/time";
import { availableHours } from "@/lib/silverfang/block-time";
import { contactDisplayName } from "@/lib/silverfang/contacts";
import { clientEmailAllowed } from "@/lib/silverfang/email-policy";
import { getTicketRows } from "@/lib/silverfang/queries";
import {
  AGREEMENT_STATUS_LABELS,
  AGREEMENT_TYPE_LABELS,
  PROJECT_STATUS_LABELS,
} from "@/lib/silverfang/constants";
import { TicketsTable } from "../../tickets/tickets-table";
import { ClientProfileForm } from "./profile-form";
import { HuduCard } from "./hudu-card";
import { ChangeTrail, ChangeTrailHeading } from "../../change-trail";
import { changeLogFor } from "@/lib/silverfang/change-log";

export const dynamic = "force-dynamic";

/** One client through the SilverFang lens: profile, contacts, tickets, agreements, projects. */
export default async function SilverFangClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  if (!can(user.role, "tickets:read")) notFound();
  const { id } = await params;

  const client = await prisma.client.findUnique({
    where: { id },
    include: {
      sfClientProfile: true,
      superOpsMatch: { select: { id: true, name: true } },
      sfContacts: { orderBy: [{ isPrimary: "desc" }, { firstName: "asc" }] },
      sfAgreements: {
        orderBy: [{ status: "asc" }, { name: "asc" }],
        include: { blocks: { include: { draws: { select: { hours: true } } } } },
      },
      sfProjects: { orderBy: [{ status: "asc" }, { name: "asc" }] },
      _count: { select: { sfTickets: true } },
    },
  });
  if (!client) notFound();

  const [tickets, openCount, hoursAgg, boards, activeAgreements, trail] =
    await Promise.all([
    getTicketRows({ clientId: id, view: "all" }, 50),
    prisma.sfTicket.count({ where: { clientId: id, status: { isClosed: false } } }),
    prisma.sfTimeEntry.aggregate({
      where: { ticket: { clientId: id } },
      _sum: { hours: true, amount: true },
    }),
    prisma.sfBoard.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true },
    }),
    prisma.sfAgreement.findMany({
      where: { clientId: id, status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    changeLogFor("SfClientProfile", id),
  ]);

  const canConfigure = can(user.role, "silverfang:configure");
  const canWrite = can(user.role, "tickets:write");
  const now = new Date();
  const totalHours = hoursAgg._sum.hours != null ? Number(hoursAgg._sum.hours) : 0;
  const totalRevenue = hoursAgg._sum.amount != null ? Number(hoursAgg._sum.amount) : 0;

  return (
    <div>
      <PageHeader
        title={client.name}
        description="SilverFang client"
        actions={
          <div className="flex items-center gap-3">
            {!clientEmailAllowed(client.sfClientProfile) && (
              <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-medium text-warning">
                <MailX className="h-3.5 w-3.5" /> Email off
              </span>
            )}
            {client.sfClientProfile?.vip && (
              <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-medium text-warning">
                <Star className="h-3.5 w-3.5" /> VIP
              </span>
            )}
            {canWrite && (
              <Link
                href={`/silverfang/tickets/new?client=${client.id}`}
                className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
              >
                New ticket
              </Link>
            )}
          </div>
        }
      />
      <div className="space-y-6 p-4 sm:p-8">
        <div className="flex flex-wrap items-center gap-4">
          <Link
            href="/silverfang/clients"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Clients
          </Link>
          <Link
            href={`/clients/${client.id}`}
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Wolf365 client profile
          </Link>
          {client.superOpsMatch && (
            <Link
              href={`/synced/superops/${client.superOpsMatch.id}`}
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" /> SuperOps record
            </Link>
          )}
        </div>

        {/* Rollup */}
        <Card>
          <h2 className="mb-3 text-sm font-semibold">Service summary</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <StatItem label="Open tickets" value={openCount} />
            <StatItem label="Total tickets" value={client._count.sfTickets} />
            <StatItem label="Contacts" value={client.sfContacts.length} />
            <StatItem label="Agreements" value={client.sfAgreements.length} />
            <StatItem label="Projects" value={client.sfProjects.length} />
            <StatItem
              label="Time logged"
              value={`${formatHours(totalHours)}${totalRevenue > 0 ? ` · ${formatCurrency(totalRevenue)}` : ""}`}
            />
          </div>
        </Card>

        {/* Profile */}
        <Card>
          <h2 className="mb-1 text-sm font-semibold">SilverFang profile</h2>
          <p className="mb-4 text-xs text-muted-foreground">
            Service-delivery settings for this client. Defaults apply to new tickets.
          </p>
          {canConfigure ? (
            <ClientProfileForm
              clientId={client.id}
              values={{
                accountManager: client.sfClientProfile?.accountManager ?? "",
                defaultBoardId: client.sfClientProfile?.defaultBoardId ?? "",
                defaultAgreementId: client.sfClientProfile?.defaultAgreementId ?? "",
                allowClientEmail: clientEmailAllowed(client.sfClientProfile),
                vip: client.sfClientProfile?.vip ?? false,
                notes: client.sfClientProfile?.notes ?? "",
              }}
              boards={boards}
              agreements={activeAgreements}
            />
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatItem
                label="Account manager"
                value={client.sfClientProfile?.accountManager ?? "—"}
              />
              <StatItem
                label="Email to client"
                value={
                  clientEmailAllowed(client.sfClientProfile) ? (
                    <span className="text-success">Allowed</span>
                  ) : (
                    <span className="text-warning">Off</span>
                  )
                }
              />
              <StatItem label="VIP" value={client.sfClientProfile?.vip ? "Yes" : "No"} />
              <StatItem label="Notes" value={client.sfClientProfile?.notes ?? "—"} />
            </div>
          )}
        </Card>

        {/* Change history */}
        <Card>
          <ChangeTrailHeading count={trail.length} />
          <ChangeTrail
            rows={trail}
            emptyHint="No profile changes recorded yet — including whether this client may be emailed."
          />
        </Card>

        {/* Contacts */}
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Contacts ({client.sfContacts.length})</h2>
            {canWrite && (
              <Link
                href={`/silverfang/contacts/new?client=${client.id}`}
                className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition hover:bg-accent"
              >
                <Plus className="h-4 w-4" /> Add contact
              </Link>
            )}
          </div>
          {client.sfContacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No contacts yet.{" "}
              {canWrite
                ? "Add one above, or use “Import from SuperOps” on the Clients page."
                : "Ask a SilverFang administrator to add or import them."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-4 font-medium">Name</th>
                    <th className="py-1 pr-4 font-medium">Email</th>
                    <th className="py-1 pr-4 font-medium">Phone</th>
                    <th className="py-1 pr-4 font-medium">Title</th>
                    <th className="py-1 pr-4 font-medium">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {client.sfContacts.map((c) => (
                    <tr key={c.id} className="border-t align-top">
                      <td className="py-1.5 pr-4">
                        <Link
                          href={`/silverfang/contacts/${c.id}`}
                          className="text-primary hover:underline"
                        >
                          {contactDisplayName(c)}
                        </Link>
                        {c.isPrimary && (
                          <span className="ml-2 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium text-accent-foreground">
                            primary
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 pr-4">
                        {c.email ?? <span className="text-warning">no email</span>}
                      </td>
                      <td className="py-1.5 pr-4">{c.phone ?? c.mobile ?? "—"}</td>
                      <td className="py-1.5 pr-4">{c.title ?? "—"}</td>
                      <td className="py-1.5 pr-4 text-muted-foreground">
                        {c.sourceSystem ?? "Manual"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* What Hudu already knows — renders nothing when no Hudu company is linked. */}
        <HuduCard clientId={client.id} />

        {/* Tickets */}
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">
              Tickets ({client._count.sfTickets}
              {tickets.length < client._count.sfTickets ? `, showing ${tickets.length}` : ""})
            </h2>
            <Link
              href={`/silverfang/tickets?view=all&client=${client.id}`}
              className="text-sm text-primary hover:underline"
            >
              All tickets for this client →
            </Link>
          </div>
          {tickets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tickets for this client yet.</p>
          ) : (
            <TicketsTable rows={tickets} />
          )}
        </Card>

        {/* Agreements */}
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">
              Agreements ({client.sfAgreements.length})
            </h2>
            {canConfigure && (
              <Link
                href={`/silverfang/agreements/new?client=${client.id}`}
                className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition hover:bg-accent"
              >
                <Plus className="h-4 w-4" /> Add agreement
              </Link>
            )}
          </div>
          {client.sfAgreements.length === 0 ? (
            <p className="text-sm text-muted-foreground">No agreements for this client.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-4 font-medium">Name</th>
                    <th className="py-1 pr-4 font-medium">Type</th>
                    <th className="py-1 pr-4 font-medium">Status</th>
                    <th className="py-1 pr-4 text-right font-medium">Monthly</th>
                    <th className="py-1 pr-4 text-right font-medium">Block balance</th>
                  </tr>
                </thead>
                <tbody>
                  {client.sfAgreements.map((a) => {
                    const blocks = a.blocks.map((b) => ({
                      id: b.id,
                      purchasedHours: Number(b.purchasedHours),
                      purchasedAt: b.purchasedAt,
                      expiresAt: b.expiresAt,
                      hoursUsed: b.draws.reduce((acc, d) => acc + Number(d.hours), 0),
                    }));
                    return (
                      <tr key={a.id} className="border-t align-top">
                        <td className="py-1.5 pr-4 font-medium">
                          <Link
                            href={`/silverfang/agreements/${a.id}`}
                            className="text-primary hover:underline"
                          >
                            {a.name}
                          </Link>
                        </td>
                        <td className="py-1.5 pr-4">{AGREEMENT_TYPE_LABELS[a.type]}</td>
                        <td className="py-1.5 pr-4">{AGREEMENT_STATUS_LABELS[a.status]}</td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">
                          {a.monthlyAmount != null ? formatCurrency(Number(a.monthlyAmount)) : "—"}
                        </td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">
                          {a.type === "BLOCK_TIME" ? formatHours(availableHours(blocks, now)) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Projects */}
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Projects ({client.sfProjects.length})</h2>
            {canConfigure && (
              <Link
                href={`/silverfang/projects/new?client=${client.id}`}
                className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition hover:bg-accent"
              >
                <Plus className="h-4 w-4" /> Add project
              </Link>
            )}
          </div>
          {client.sfProjects.length === 0 ? (
            <p className="text-sm text-muted-foreground">No projects for this client.</p>
          ) : (
            <ul className="divide-y text-sm">
              {client.sfProjects.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                  <Link
                    href={`/silverfang/projects/${p.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {p.name}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {PROJECT_STATUS_LABELS[p.status]}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {p.billingType === "FIXED_FEE" ? "fixed fee" : "time and materials"}
                  </span>
                  {/* Hours are safe to show here: this is an internal view, and the
                      fixed-fee rule is about what reaches the client. */}
                  {p.contractedHours != null && (
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {formatHours(Number(p.contractedHours))} sold
                    </span>
                  )}
                  {p.dueDate && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      due <LocalTime value={p.dueDate.toISOString()} dateOnly />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
