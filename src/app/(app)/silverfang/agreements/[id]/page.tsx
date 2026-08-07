import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Plus, ShieldCheck, TriangleAlert } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { PageHeader, Card, StatItem } from "@/components/ui/primitives";
import { PawTip } from "@/components/ui/paw-tip";
import { LocalTime } from "@/components/ui/local-time";
import { formatCurrency } from "@/lib/utils";
import { formatHours } from "@/lib/silverfang/time";
import { availableHours, blockBalance } from "@/lib/silverfang/block-time";
import { changeLogFor } from "@/lib/silverfang/change-log";
import { renewalPreview } from "@/lib/silverfang/renewal";
import { AGREEMENT_STATUS_LABELS, AGREEMENT_TYPE_LABELS } from "@/lib/silverfang/constants";
import { getTicketRows } from "@/lib/silverfang/queries";
import { safeReturnTo, withReturnTo } from "@/lib/silverfang/return-to";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { TicketsTable } from "../../tickets/tickets-table";
import { ChangeTrail, ChangeTrailHeading } from "../../change-trail";
import { AgreementForm } from "../agreement-form";
import { AuthorizedTechsForm } from "../../authorized-techs-form";
import { saveAgreementTechsAction } from "../../agreement-actions";
import { checkAuthorized, restrictionLabel } from "@/lib/silverfang/authorized-techs";
import { BlockForm } from "./block-form";
import { DeleteAgreementButton } from "./delete-button";
import { RenewalCard } from "./renewal-card";

export const dynamic = "force-dynamic";

function dateInput(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "";
}
function numInput(v: unknown): string {
  return v == null ? "" : String(Number(v));
}

export default async function AgreementDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  if (!can(user.role, "agreements:read")) notFound();
  const [{ id }, sp] = await Promise.all([params, searchParams]);

  const agreement = await prisma.sfAgreement.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, name: true } },
      blocks: {
        orderBy: { purchasedAt: "asc" },
        include: { draws: { select: { hours: true } } },
      },
      authorizedTechs: {
        select: { userId: true, user: { select: { name: true, email: true } } },
      },
      _count: { select: { tickets: true, projects: true, timeEntries: true } },
    },
  });
  if (!agreement) notFound();

  const [clients, tickets, trail, hoursAgg] = await Promise.all([
    prisma.client.findMany({
      where: { archived: false },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
      take: 2000,
    }),
    // Filtered in SQL — the previous version fetched the 50 newest tickets across
    // every client and then kept this client's, so a quiet client showed none.
    getTicketRows({ clientId: agreement.clientId, view: "all" }, 50),
    changeLogFor("SfAgreement", id),
    prisma.sfTimeEntry.aggregate({
      where: { agreementId: id },
      _sum: { hours: true, amount: true },
    }),
  ]);

  const canManage = can(user.role, "agreements:manage");
  // The client page is the natural parent; an explicit target from wherever this
  // was opened wins over it.
  const backTo = safeReturnTo(sp.returnTo) ?? `/silverfang/clients/${agreement.client.id}`;
  const now = new Date();
  const blocks = agreement.blocks.map((b) => ({
    id: b.id,
    purchasedHours: Number(b.purchasedHours),
    purchasedAt: b.purchasedAt,
    expiresAt: b.expiresAt,
    hoursUsed: b.draws.reduce((acc, d) => acc + Number(d.hours), 0),
  }));
  const balance = availableHours(blocks, now);
  const purchased = blocks.reduce((a, b) => a + b.purchasedHours, 0);
  const used = blocks.reduce((a, b) => a + b.hoursUsed, 0);
  const loggedHours = hoursAgg._sum.hours != null ? Number(hoursAgg._sum.hours) : 0;
  const loggedValue = hoursAgg._sum.amount != null ? Number(hoursAgg._sum.amount) : 0;
  const isBlockTime = agreement.type === "BLOCK_TIME";

  const renewal = renewalPreview(
    {
      autoRenew: agreement.autoRenew,
      renewalIncreasePercent: Number(agreement.renewalIncreasePercent),
      startDate: agreement.startDate,
      endDate: agreement.endDate,
      lastRenewedAt: agreement.lastRenewedAt,
      billingFrequency: agreement.billingFrequency,
      monthlyAmount: agreement.monthlyAmount != null ? Number(agreement.monthlyAmount) : null,
      overageRate: agreement.overageRate != null ? Number(agreement.overageRate) : null,
      standardRate: agreement.standardRate != null ? Number(agreement.standardRate) : null,
    },
    now,
  );
  const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  // Where the context-carrying buttons come back to.
  const here = `/silverfang/agreements/${agreement.id}`;

  // Authorised technicians. Empty means everyone — see `authorized-techs.ts`.
  const authorizedIds = agreement.authorizedTechs.map((t) => t.userId);
  const authorization = checkAuthorized(
    { kind: "agreement", name: agreement.name, authorizedUserIds: authorizedIds },
    user.id,
  );
  // Editing is gated by the same list the server enforces, so the form is not
  // offered and then refused.
  const canEdit = canManage && authorization.allowed;
  const canConfigure = can(user.role, "silverfang:configure");
  const techUsers = canConfigure
    ? await prisma.user.findMany({
        where: { disabled: false },
        orderBy: { name: "asc" },
        select: { id: true, name: true, email: true },
      })
    : [];

  return (
    <div>
      <PageHeader
        help={<PawTip topic="agreements" />}
        title={agreement.name}
        description={`${agreement.client.name} · ${AGREEMENT_TYPE_LABELS[agreement.type]} · ${AGREEMENT_STATUS_LABELS[agreement.status]}`}
        actions={
          // Both carry the client and this agreement, so neither has to be picked
          // again — being on this page already says which client and which
          // agreement the work is for.
          <div className="flex flex-wrap items-center gap-2">
            {can(user.role, "tickets:write") && (
              <Link
                href={withReturnTo(
                  `/silverfang/tickets/new?client=${agreement.clientId}&agreement=${agreement.id}`,
                  here,
                )}
                className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition hover:bg-accent"
              >
                <Plus className="h-4 w-4" /> New ticket
              </Link>
            )}
            {can(user.role, "projects:manage") && (
              <Link
                href={withReturnTo(
                  `/silverfang/projects/new?client=${agreement.clientId}&agreement=${agreement.id}`,
                  here,
                )}
                className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition hover:bg-accent"
              >
                <Plus className="h-4 w-4" /> New project
              </Link>
            )}
          </div>
        }
      />
      <div className="space-y-6 p-4 sm:p-8">
        <div className="flex flex-wrap items-center gap-4">
          <Breadcrumbs
            items={[
              { label: "Clients", href: "/silverfang/clients" },
              { label: agreement.client.name, href: backTo },
              { label: agreement.name },
            ]}
          />
          <Link
            href="/silverfang/agreements"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> All agreements
          </Link>
        </div>

        <Card>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <StatItem label="Tickets" value={agreement._count.tickets} />
            <StatItem label="Projects" value={agreement._count.projects} />
            <StatItem label="Time logged" value={formatHours(loggedHours)} />
            <StatItem label="Value logged" value={formatCurrency(loggedValue)} />
            {isBlockTime ? (
              <>
                <StatItem label="Purchased" value={formatHours(purchased)} />
                <StatItem
                  label="Remaining"
                  value={
                    <span className={balance <= 0 ? "text-danger" : ""}>
                      {formatHours(balance)}
                    </span>
                  }
                />
              </>
            ) : (
              <>
                <StatItem
                  label="Recurring"
                  value={
                    agreement.monthlyAmount != null
                      ? formatCurrency(Number(agreement.monthlyAmount))
                      : "—"
                  }
                />
                <StatItem
                  label="Included hours"
                  value={
                    agreement.includedHours != null
                      ? formatHours(Number(agreement.includedHours))
                      : "—"
                  }
                />
              </>
            )}
          </div>
          {isBlockTime && purchased > 0 && (
            <div className="mt-4">
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full ${used / purchased > 0.9 ? "bg-danger" : "bg-primary"}`}
                  style={{ width: `${Math.min(100, (used / purchased) * 100)}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatHours(used)} of {formatHours(purchased)} drawn.
                {balance <= 0 && " No prepaid hours remain — further time bills as overage."}
              </p>
            </div>
          )}
        </Card>

        {agreement.autoRenew && (
          <Card>
            <h2 className="mb-3 text-sm font-semibold">Renewal</h2>
            <RenewalCard
              agreementId={agreement.id}
              percent={renewal.percent}
              renewsOn={iso(renewal.renewsOn)}
              newEndDate={iso(renewal.newEndDate)}
              termMonths={renewal.termMonths}
              daysUntil={renewal.daysUntil}
              due={renewal.due}
              alreadyRenewed={renewal.alreadyRenewed}
              changes={renewal.changes}
              annualDelta={renewal.annualDelta}
              canManage={canManage}
            />
          </Card>
        )}

        {authorization.restricted && (
          <Card>
            <p className="text-sm">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  authorization.allowed
                    ? "bg-success/15 text-success"
                    : "bg-warning/15 text-warning"
                }`}
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                {restrictionLabel(authorization)}
              </span>{" "}
              {authorization.allowed
                ? `Time on this agreement is limited to ${authorizedIds.length} named technician(s), and you are one of them.`
                : authorization.reason}
            </p>
          </Card>
        )}

        <Card>
          <h2 className="mb-4 text-sm font-semibold">Agreement</h2>
          {canEdit ? (
            <AgreementForm
              values={{
                id: agreement.id,
                clientId: agreement.clientId,
                name: agreement.name,
                type: agreement.type,
                status: agreement.status,
                startDate: dateInput(agreement.startDate),
                endDate: dateInput(agreement.endDate),
                autoRenew: agreement.autoRenew,
                renewalIncreasePercent: numInput(agreement.renewalIncreasePercent),
                billingFrequency: agreement.billingFrequency ?? "MONTHLY",
                monthlyAmount: numInput(agreement.monthlyAmount),
                includedHours: numInput(agreement.includedHours),
                overageRate: numInput(agreement.overageRate),
                standardRate: numInput(agreement.standardRate),
                notes: agreement.notes ?? "",
              }}
              clients={clients}
              submitLabel="Save agreement"
            />
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatItem label="Type" value={AGREEMENT_TYPE_LABELS[agreement.type]} />
              <StatItem label="Status" value={AGREEMENT_STATUS_LABELS[agreement.status]} />
              <StatItem
                label="Standard rate"
                value={
                  agreement.standardRate != null
                    ? formatCurrency(Number(agreement.standardRate))
                    : "—"
                }
              />
              <StatItem label="Notes" value={agreement.notes ?? "—"} />
            </div>
          )}
        </Card>

        {canConfigure && (
          <Card>
            <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
              Authorised technicians <PawTip topic="authorizedTechs" />
            </h2>
            <p className="mb-3 text-xs text-muted-foreground">
              Who may log time against this agreement. Editing this list is never itself
              restricted — otherwise leaving yourself off would lock the agreement permanently.
            </p>
            <AuthorizedTechsForm
              scope="agreement"
              targetId={agreement.id}
              users={techUsers}
              selectedIds={authorizedIds}
              saveAction={saveAgreementTechsAction}
            />
          </Card>
        )}

        {isBlockTime && (
          <Card>
            <h2 className="mb-3 text-sm font-semibold">
              Prepaid hour blocks ({agreement.blocks.length})
            </h2>
            {agreement.blocks.length === 0 ? (
              <p className="mb-4 text-sm text-muted-foreground">
                No blocks yet, so there are no prepaid hours to draw from — time logged against
                this agreement will be entirely overage.
              </p>
            ) : (
              <div className="mb-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-4 font-medium">Purchased</th>
                      <th className="py-1 pr-4 font-medium">Expires</th>
                      <th className="py-1 pr-4 text-right font-medium">Hours</th>
                      <th className="py-1 pr-4 text-right font-medium">Used</th>
                      <th className="py-1 pr-4 text-right font-medium">Remaining</th>
                      <th className="py-1 pr-4 text-right font-medium">Amount</th>
                      <th className="py-1 pr-4 font-medium">PO</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agreement.blocks.map((b) => {
                      const bal = blockBalance(
                        {
                          id: b.id,
                          purchasedHours: Number(b.purchasedHours),
                          purchasedAt: b.purchasedAt,
                          expiresAt: b.expiresAt,
                          hoursUsed: b.draws.reduce((a, d) => a + Number(d.hours), 0),
                        },
                        now,
                      );
                      return (
                        <tr key={b.id} className="border-t align-top">
                          <td className="py-1.5 pr-4 whitespace-nowrap">
                            <LocalTime value={b.purchasedAt.toISOString()} dateOnly />
                          </td>
                          <td className="py-1.5 pr-4 whitespace-nowrap">
                            {b.expiresAt ? (
                              <span className={bal.expired ? "text-danger" : ""}>
                                <LocalTime value={b.expiresAt.toISOString()} dateOnly />
                                {bal.expired && " (expired)"}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="py-1.5 pr-4 text-right tabular-nums">
                            {formatHours(bal.purchasedHours)}
                          </td>
                          <td className="py-1.5 pr-4 text-right tabular-nums">
                            {formatHours(bal.hoursUsed)}
                          </td>
                          <td className="py-1.5 pr-4 text-right tabular-nums">
                            {formatHours(bal.hoursRemaining)}
                          </td>
                          <td className="py-1.5 pr-4 text-right tabular-nums">
                            {b.amount != null ? formatCurrency(Number(b.amount)) : "—"}
                          </td>
                          <td className="py-1.5 pr-4 text-muted-foreground">
                            {b.poNumber ?? "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {canManage && (
              <div className="border-t pt-4">
                <BlockForm agreementId={agreement.id} />
              </div>
            )}
          </Card>
        )}

        <Card>
          <h2 className="mb-3 text-sm font-semibold">
            Client tickets ({tickets.length})
          </h2>
          {tickets.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No tickets for this client yet.
            </p>
          ) : (
            <TicketsTable rows={tickets} returnTo={`/silverfang/agreements/${agreement.id}`} />
          )}
        </Card>

        <Card>
          <ChangeTrailHeading count={trail.length} />
          <ChangeTrail rows={trail} />
        </Card>

        {canManage && (
          <Card>
            <h2 className="mb-2 inline-flex items-center gap-2 text-sm font-semibold">
              <TriangleAlert className="h-4 w-4 text-danger" /> Danger zone
            </h2>
            <p className="mb-3 text-xs text-muted-foreground">
              Deleting an agreement is refused once tickets, time or projects reference it —
              removing it would strip that history of what paid for the work. Set the status to
              Cancelled instead.
            </p>
            <DeleteAgreementButton id={agreement.id} />
          </Card>
        )}
      </div>
    </div>
  );
}
