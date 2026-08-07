import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { PageHeader, Card, StatItem } from "@/components/ui/primitives";
import { PawTip } from "@/components/ui/paw-tip";
import { formatCurrency } from "@/lib/utils";
import { formatHours } from "@/lib/silverfang/time";
import { changeLogFor } from "@/lib/silverfang/change-log";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { safeReturnTo } from "@/lib/silverfang/return-to";
import { PROJECT_STATUS_LABELS } from "@/lib/silverfang/constants";
import {
  depositStatus,
  effectiveContractedHours,
  hoursUsage,
  hoursVisibleToClient,
  nextBillingDate,
  projectTotal,
  remainderAfterDeposit,
} from "@/lib/silverfang/project-billing";
import { getTicketRows } from "@/lib/silverfang/queries";
import { sortTickets } from "@/lib/silverfang/ticket-order";
import { TicketsTable } from "../../tickets/tickets-table";
import { ChangeTrail, ChangeTrailHeading } from "../../change-trail";
import { ProjectForm } from "../project-form";
import { DepositCard } from "./deposit-card";
import { PhaseBoard, type PhaseRow } from "./phase-board";
import { TaskBoard, type TaskRow } from "./task-board";
import { SaveAsTemplate } from "./save-as-template";

export const dynamic = "force-dynamic";

function dateInput(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

const num = (v: { toString(): string } | null | undefined): number | null =>
  v != null ? Number(v) : null;

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  if (!can(user.role, "projects:read")) notFound();
  const [{ id }, sp] = await Promise.all([params, searchParams]);

  const project = await prisma.sfProject.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, name: true } },
      agreement: { select: { id: true, name: true } },
      manager: { select: { name: true, email: true } },
      template: { select: { id: true, name: true } },
      phases: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        include: {
          tickets: {
            // Priority and age in SQL; the VIP tiebreak is applied below by the
            // shared comparator, so a phase's tickets read in the same order as
            // every other ticket list in the app.
            orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
            select: {
              id: true,
              number: true,
              summary: true,
              actualHours: true,
              priority: true,
              createdAt: true,
              status: { select: { name: true } },
              contact: { select: { vip: true } },
              client: { select: { sfClientProfile: { select: { vip: true } } } },
            },
          },
          _count: { select: { tasks: true } },
        },
      },
      tasks: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        include: {
          assignee: { select: { name: true, email: true } },
          projectPhase: { select: { id: true, name: true } },
          _count: { select: { timeEntries: true, tickets: true } },
        },
      },
      _count: { select: { tickets: true } },
    },
  });
  if (!project) notFound();

  const [clients, agreements, users, tickets, trail, phaseTime] = await Promise.all([
    prisma.client.findMany({
      where: { archived: false },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
      take: 2000,
    }),
    prisma.sfAgreement.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, client: { select: { name: true } } },
      take: 500,
    }),
    prisma.user.findMany({
      where: { disabled: false },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true },
    }),
    // Filtered in SQL, not after the fact: fetching a global window and then
    // discarding rows meant a client whose tickets fell outside the first 200
    // showed none at all.
    getTicketRows({ clientId: project.clientId, view: "all" }, 200),
    changeLogFor("SfProject", id),
    // Hours logged straight against a phase of *this* project.
    prisma.sfTimeEntry.groupBy({
      by: ["projectPhaseId"],
      where: { projectPhase: { projectId: id } },
      _sum: { hours: true },
    }),
  ]);

  const canManage = can(user.role, "projects:manage");
  // The client page is the natural parent; an explicit target wins over it.
  const backTo = safeReturnTo(sp.returnTo) ?? `/silverfang/clients/${project.client.id}`;

  // Time logged per phase: entries carrying the phase directly, plus those that
  // reach it through a phase ticket or a phase task.
  const phaseIds = project.phases.map((p) => p.id);
  const [byPhaseTicket, byPhaseTask] = await Promise.all([
    phaseIds.length > 0
      ? prisma.sfTimeEntry.findMany({
          where: { ticket: { projectPhaseId: { in: phaseIds } } },
          select: { hours: true, ticket: { select: { projectPhaseId: true } } },
        })
      : Promise.resolve([]),
    phaseIds.length > 0
      ? prisma.sfTimeEntry.findMany({
          where: { projectTask: { projectPhaseId: { in: phaseIds } } },
          select: { hours: true, projectTask: { select: { projectPhaseId: true } } },
        })
      : Promise.resolve([]),
  ]);

  const loggedByPhase = new Map<string, number>();
  const addPhaseHours = (phaseId: string | null | undefined, hours: unknown) => {
    if (!phaseId) return;
    loggedByPhase.set(phaseId, (loggedByPhase.get(phaseId) ?? 0) + Number(hours ?? 0));
  };
  for (const row of phaseTime) addPhaseHours(row.projectPhaseId, row._sum.hours);
  for (const row of byPhaseTicket) addPhaseHours(row.ticket?.projectPhaseId, row.hours);
  for (const row of byPhaseTask) addPhaseHours(row.projectTask?.projectPhaseId, row.hours);

  const phaseRows: PhaseRow[] = project.phases.map((p) => ({
    id: p.id,
    name: p.name,
    status: p.status,
    hours: num(p.hours),
    notes: p.notes,
    sortOrder: p.sortOrder,
    loggedHours: loggedByPhase.get(p.id) ?? 0,
    taskCount: p._count.tasks,
    tickets: sortTickets(
      p.tickets.map((t) => ({
        id: t.id,
        number: t.number,
        summary: t.summary,
        status: t.status.name,
        hours: Number(t.actualHours),
        priority: t.priority,
        createdAt: t.createdAt,
        vip: t.contact?.vip === true || t.client.sfClientProfile?.vip === true,
      })),
    ),
  }));

  const taskRows: TaskRow[] = project.tasks.map((t) => ({
    id: t.id,
    projectPhaseId: t.projectPhaseId,
    phaseName: t.projectPhase?.name ?? null,
    phase: t.phase,
    name: t.name,
    status: t.status,
    assigneeId: t.assigneeId,
    assignee: t.assignee?.name ?? t.assignee?.email ?? null,
    estimatedHours: num(t.estimatedHours),
    actualHours: Number(t.actualHours),
    dueDate: dateInput(t.dueDate),
    sortOrder: t.sortOrder,
    hasTime: t._count.timeEntries > 0 || t._count.tickets > 0,
  }));

  const loggedAgg = await prisma.sfTimeEntry.aggregate({
    where: {
      OR: [
        { projectTask: { projectId: id } },
        { ticket: { projectId: id } },
        { projectPhase: { projectId: id } },
      ],
    },
    _sum: { hours: true, amount: true },
  });
  const loggedHours = Number(loggedAgg._sum.hours ?? 0);
  const loggedValue = Number(loggedAgg._sum.amount ?? 0);

  const contracted = num(project.contractedHours);
  const estimated = num(project.estimatedHours);
  const budget = num(project.budgetAmount);
  const fixedFee = num(project.fixedFeeAmount);

  // Phases are the detail the contracted total is built from, so they win.
  const effectiveHours = effectiveContractedHours(
    contracted,
    phaseRows.map((p) => ({ hours: p.hours })),
  );
  const usage = hoursUsage(loggedHours, effectiveHours);
  const showHours = hoursVisibleToClient(project.billingType);
  const total = projectTotal({
    billingType: project.billingType,
    fixedFeeAmount: fixedFee,
    budgetAmount: budget,
  });
  const deposit = depositStatus(total, {
    percent: num(project.depositPercent),
    amount: num(project.depositAmount),
    invoicedAt: project.depositInvoicedAt,
  });
  const nextBilling =
    project.billingType === "FIXED_FEE"
      ? nextBillingDate({
          startDate: project.startDate,
          lastBilledAt: null,
          intervalDays: project.billingIntervalDays,
        })
      : null;

  return (
    <div>
      <PageHeader
        help={<PawTip topic="projects" />}
        title={project.name}
        description={`${project.client.name} · ${PROJECT_STATUS_LABELS[project.status]} · ${
          project.billingType === "FIXED_FEE" ? "Fixed fee" : "Time and materials"
        }`}
      />
      <div className="space-y-6 p-4 sm:p-8">
        <div className="flex flex-wrap items-center gap-4">
          <Breadcrumbs
            items={[
              { label: "Clients", href: "/silverfang/clients" },
              { label: project.client.name, href: backTo },
              { label: project.name },
            ]}
          />
          <Link
            href="/silverfang/projects"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> All projects
          </Link>
          {project.agreement && (
            <Link
              href={`/silverfang/agreements/${project.agreement.id}`}
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" /> {project.agreement.name}
            </Link>
          )}
        </div>

        {/* Carried through the create redirect: something a template could not
            stamp out, said here rather than left for someone to notice. */}
        {sp.notice && (
          <Card>
            <p className="text-sm text-warning">{sp.notice}</p>
          </Card>
        )}

        <Card>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <StatItem label="Phases" value={phaseRows.length} />
            <StatItem
              label="Tasks"
              value={`${project.tasks.filter((t) => t.status === "COMPLETED").length} / ${project.tasks.length}`}
            />
            <StatItem label="Manager" value={project.manager?.name ?? project.manager?.email ?? "—"} />
            <StatItem
              label="Time logged"
              value={
                <span className={usage.overage > 0 ? "text-danger" : ""}>
                  {formatHours(usage.logged)}
                  {usage.contracted != null
                    ? ` / ${formatHours(usage.contracted)} sold`
                    : estimated != null
                      ? ` / ${formatHours(estimated)} est.`
                      : ""}
                </span>
              }
            />
            <StatItem
              label={project.billingType === "FIXED_FEE" ? "Fixed fee" : "Value"}
              value={
                project.billingType === "FIXED_FEE" ? (
                  <span>
                    {fixedFee != null ? formatCurrency(fixedFee) : "—"}
                    <span className="text-xs text-muted-foreground">
                      {" "}
                      / {project.billingIntervalDays}d
                    </span>
                  </span>
                ) : (
                  <span className={budget != null && loggedValue > budget ? "text-warning" : ""}>
                    {formatCurrency(loggedValue)}
                    {budget != null ? ` / ${formatCurrency(budget)}` : ""}
                  </span>
                )
              }
            />
            <StatItem
              label={project.billingType === "FIXED_FEE" ? "Next billing" : "From template"}
              value={
                project.billingType === "FIXED_FEE"
                  ? (nextBilling?.toISOString().slice(0, 10) ?? "set a start date")
                  : (project.template?.name ?? "—")
              }
            />
          </div>
        </Card>

        {project.billingType === "FIXED_FEE" && (
          <Card>
            <p className="text-xs">
              <span className="font-medium">Fixed fee.</span> Hours below are tracked exactly as on
              a time-and-materials project, but they are internal — the client is billed{" "}
              {fixedFee != null ? formatCurrency(fixedFee) : "the fee"} every{" "}
              {project.billingIntervalDays} days and never sees the hours.
            </p>
          </Card>
        )}

        {usage.contracted != null && usage.contracted > 0 && (
          <Card>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full ${
                  usage.overage > 0
                    ? "bg-danger"
                    : (usage.ratio ?? 0) > 0.9
                      ? "bg-warning"
                      : "bg-primary"
                }`}
                style={{ width: `${(usage.ratio ?? 0) * 100}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatHours(usage.logged)} of {formatHours(usage.contracted)} contracted hours used
              {phaseRows.length > 0 ? " (summed from the phases)" : ""}.
              {usage.overage > 0 &&
                ` ${formatHours(usage.overage)} over — bill as overage or raise a change request.`}
            </p>
          </Card>
        )}

        {deposit.percent != null && (
          <Card>
            <h2 className="mb-2 text-sm font-semibold">Deposit</h2>
            <DepositCard
              projectId={project.id}
              percent={deposit.percent}
              expected={deposit.expected}
              invoiced={deposit.invoiced}
              invoicedAt={
                deposit.invoicedAt ? deposit.invoicedAt.toISOString().slice(0, 10) : null
              }
              drifted={deposit.drifted}
              remainder={remainderAfterDeposit(total, deposit.invoiced)}
              canManage={canManage}
            />
          </Card>
        )}

        <Card>
          <h2 className="mb-3 text-sm font-semibold">Phases</h2>
          <PhaseBoard
            projectId={project.id}
            clientId={project.clientId}
            phases={phaseRows}
            contractedHours={contracted}
            showHours={showHours || canManage}
            canManage={canManage}
          />
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-semibold">Tasks</h2>
          <TaskBoard
            projectId={project.id}
            tasks={taskRows}
            users={users}
            phases={phaseRows.map((p) => ({ id: p.id, name: p.name }))}
            canManage={canManage}
          />
        </Card>

        <Card>
          <h2 className="mb-4 text-sm font-semibold">Project</h2>
          {canManage ? (
            <ProjectForm
              values={{
                id: project.id,
                clientId: project.clientId,
                agreementId: project.agreementId ?? "",
                name: project.name,
                description: project.description ?? "",
                status: project.status,
                managerId: project.managerId ?? "",
                startDate: dateInput(project.startDate),
                dueDate: dateInput(project.dueDate),
                contractedHours: contracted != null ? String(contracted) : "",
                estimatedHours: estimated != null ? String(estimated) : "",
                budgetAmount: budget != null ? String(budget) : "",
                billingType: project.billingType,
                fixedFeeAmount: fixedFee != null ? String(fixedFee) : "",
                billingIntervalDays: String(project.billingIntervalDays),
                depositPercent:
                  deposit.percent != null ? String(deposit.percent) : "",
                depositInvoiced: project.depositInvoicedAt != null,
              }}
              clients={clients}
              agreements={agreements.map((a) => ({
                id: a.id,
                label: `${a.client.name} — ${a.name}`,
              }))}
              users={users}
              templates={[]}
              submitLabel="Save project"
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              {project.description ?? "No description."}
            </p>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-semibold">Client tickets ({tickets.length})</h2>
          {tickets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tickets for this client yet.</p>
          ) : (
            <TicketsTable rows={tickets} returnTo={`/silverfang/projects/${project.id}`} />
          )}
        </Card>

        {canManage && (
          <Card>
            <details>
              <summary className="cursor-pointer text-sm font-semibold">
                Save as template{" "}
                <span className="font-normal text-muted-foreground">
                  · reuse this project&rsquo;s phases and tickets, without the client
                </span>
              </summary>
              <div className="mt-4">
                <SaveAsTemplate projectId={project.id} suggestedName={project.name} />
              </div>
            </details>
          </Card>
        )}

        <Card>
          <ChangeTrailHeading count={trail.length} />
          <ChangeTrail rows={trail} />
        </Card>
      </div>
    </div>
  );
}
