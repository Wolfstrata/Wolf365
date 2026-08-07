import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card } from "@/components/ui/primitives";
import { safeReturnTo } from "@/lib/silverfang/return-to";
import { ProjectForm } from "../project-form";

export const dynamic = "force-dynamic";

/** `?client=<id>` preselects the client. */
export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requirePermission("projects:manage");
  const [sp, clients, agreements, users, templates] = await Promise.all([
    searchParams,
    prisma.client.findMany({
      where: { archived: false },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
      take: 2000,
    }),
    prisma.sfAgreement.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, clientId: true, client: { select: { name: true } } },
      take: 500,
    }),
    prisma.user.findMany({
      where: { disabled: false },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true },
    }),
    prisma.sfProjectTemplate.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        _count: { select: { phases: true, tasks: true, tickets: true } },
      },
    }),
  ]);
  const clientId = sp.client && clients.some((c) => c.id === sp.client) ? sp.client : "";
  // Arriving from an agreement page: preselect that agreement, but only when it
  // really belongs to the chosen client, so a stale link cannot bill a project
  // against somebody else's agreement.
  const agreementId =
    sp.agreement && agreements.some((a) => a.id === sp.agreement && a.clientId === clientId)
      ? sp.agreement
      : "";
  const backTo =
    safeReturnTo(sp.returnTo) ??
    (clientId ? `/silverfang/clients/${clientId}` : "/silverfang/projects");

  return (
    <div>
      <PageHeader title="New project" description="Scoped work with a task list." />
      <div className="space-y-4 p-4 sm:p-8">
        {/* Back to whoever opened this — usually a client page — rather than
            always to the module list. */}
        <Link
          href={backTo}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <Card>
          <ProjectForm
            values={{
              clientId,
              agreementId,
              name: "",
              description: "",
              status: "PLANNED",
              managerId: "",
              startDate: new Date().toISOString().slice(0, 10),
              dueDate: "",
              contractedHours: "",
              estimatedHours: "",
              budgetAmount: "",
              billingType: "TIME_AND_MATERIALS",
              fixedFeeAmount: "",
              billingIntervalDays: "30",
              depositPercent: "",
            }}
            clients={clients}
            agreements={agreements.map((a) => ({
              id: a.id,
              label: `${a.client.name} — ${a.name}`,
            }))}
            users={users}
            templates={templates.map((t) => ({
              id: t.id,
              name: t.name,
              phaseCount: t._count.phases,
              taskCount: t._count.tasks,
              ticketCount: t._count.tickets,
            }))}
            submitLabel="Create project"
          />
        </Card>
      </div>
    </div>
  );
}
