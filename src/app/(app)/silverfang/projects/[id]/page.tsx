import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { PageHeader, Card, StatItem } from "@/components/ui/primitives";
import { formatCurrency } from "@/lib/utils";
import { formatHours } from "@/lib/silverfang/time";
import { changeLogFor } from "@/lib/silverfang/change-log";
import { PROJECT_STATUS_LABELS } from "@/lib/silverfang/constants";
import { getTicketRows } from "@/lib/silverfang/queries";
import { TicketsTable } from "../../tickets/tickets-table";
import { ChangeTrail, ChangeTrailHeading } from "../../change-trail";
import { ProjectForm } from "../project-form";
import { TaskBoard, type TaskRow } from "./task-board";

export const dynamic = "force-dynamic";

function dateInput(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  if (!can(user.role, "projects:read")) notFound();
  const { id } = await params;

  const project = await prisma.sfProject.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, name: true } },
      agreement: { select: { id: true, name: true } },
      manager: { select: { name: true, email: true } },
      template: { select: { id: true, name: true } },
      tasks: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        include: {
          assignee: { select: { name: true, email: true } },
          _count: { select: { timeEntries: true, tickets: true } },
        },
      },
      _count: { select: { tickets: true } },
    },
  });
  if (!project) notFound();

  const [clients, agreements, users, tickets, trail] = await Promise.all([
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
    getTicketRows({ view: "all" }, 200).then((rows) => rows.filter((r) => r.clientId === project.clientId)),
    changeLogFor("SfProject", id),
  ]);

  const canManage = can(user.role, "projects:manage");
  const taskRows: TaskRow[] = project.tasks.map((t) => ({
    id: t.id,
    phase: t.phase,
    name: t.name,
    status: t.status,
    assigneeId: t.assigneeId,
    assignee: t.assignee?.name ?? t.assignee?.email ?? null,
    estimatedHours: t.estimatedHours != null ? Number(t.estimatedHours) : null,
    actualHours: Number(t.actualHours),
    dueDate: dateInput(t.dueDate),
    sortOrder: t.sortOrder,
    hasTime: t._count.timeEntries > 0 || t._count.tickets > 0,
  }));

  const loggedAgg = await prisma.sfTimeEntry.aggregate({
    where: { projectTask: { projectId: id } },
    _sum: { hours: true, amount: true },
  });
  const loggedHours = loggedAgg._sum.hours != null ? Number(loggedAgg._sum.hours) : 0;
  const loggedValue = loggedAgg._sum.amount != null ? Number(loggedAgg._sum.amount) : 0;
  const estimated = project.estimatedHours != null ? Number(project.estimatedHours) : null;
  const budget = project.budgetAmount != null ? Number(project.budgetAmount) : null;

  return (
    <div>
      <PageHeader
        title={project.name}
        description={`${project.client.name} · ${PROJECT_STATUS_LABELS[project.status]}`}
      />
      <div className="space-y-6 p-4 sm:p-8">
        <div className="flex flex-wrap items-center gap-4">
          <Link
            href="/silverfang/projects"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Projects
          </Link>
          <Link
            href={`/silverfang/clients/${project.client.id}`}
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" /> {project.client.name}
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

        <Card>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <StatItem label="Tasks" value={project.tasks.length} />
            <StatItem
              label="Complete"
              value={project.tasks.filter((t) => t.status === "COMPLETED").length}
            />
            <StatItem label="Manager" value={project.manager?.name ?? project.manager?.email ?? "—"} />
            <StatItem
              label="Time logged"
              value={
                <span className={estimated != null && loggedHours > estimated ? "text-warning" : ""}>
                  {formatHours(loggedHours)}
                  {estimated != null ? ` / ${formatHours(estimated)}` : ""}
                </span>
              }
            />
            <StatItem
              label="Value"
              value={
                <span className={budget != null && loggedValue > budget ? "text-warning" : ""}>
                  {formatCurrency(loggedValue)}
                  {budget != null ? ` / ${formatCurrency(budget)}` : ""}
                </span>
              }
            />
            <StatItem label="From template" value={project.template?.name ?? "—"} />
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-semibold">Tasks</h2>
          <TaskBoard
            projectId={project.id}
            tasks={taskRows}
            users={users}
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
                estimatedHours: estimated != null ? String(estimated) : "",
                budgetAmount: budget != null ? String(budget) : "",
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
            <TicketsTable rows={tickets} />
          )}
        </Card>

        <Card>
          <ChangeTrailHeading count={trail.length} />
          <ChangeTrail rows={trail} />
        </Card>
      </div>
    </div>
  );
}
