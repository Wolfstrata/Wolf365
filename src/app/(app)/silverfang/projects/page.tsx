import Link from "next/link";
import { FolderKanban, Plus, ShieldCheck } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { PageHeader, Card, EmptyState } from "@/components/ui/primitives";
import { PawTip } from "@/components/ui/paw-tip";
import { LocalTime } from "@/components/ui/local-time";
import { formatHours } from "@/lib/silverfang/time";
import { PROJECT_STATUS_LABELS } from "@/lib/silverfang/constants";
import { checkAuthorized, restrictionLabel } from "@/lib/silverfang/authorized-techs";

export const dynamic = "force-dynamic";

/** Projects and their tickets, optionally created from a template. */
export default async function ProjectsPage() {
  const user = await requirePermission("projects:read");
  const canManage = can(user.role, "projects:manage");

  const [projects, templates] = await Promise.all([
    prisma.sfProject.findMany({
      where: { client: { archived: false } },
      orderBy: [{ status: "asc" }, { dueDate: "asc" }],
      include: {
        client: { select: { id: true, name: true } },
        manager: { select: { name: true, email: true } },
        authorizedTechs: { select: { userId: true } },
        _count: { select: { tickets: true } },
      },
    }),
    prisma.sfProjectTemplate.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      include: { _count: { select: { phases: true, tickets: true } } },
    }),
  ]);

  return (
    <div>
      <PageHeader
        help={<PawTip topic="projects" />} title="Projects" description="Project work, tickets and templates."
        actions={
          canManage ? (
            <div className="flex items-center gap-2">
              <Link
                href="/silverfang/projects/templates"
                className="rounded-md border px-3 py-2 text-sm font-medium transition hover:bg-accent"
              >
                Templates
              </Link>
              <Link
                href="/silverfang/projects/new"
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
              >
                <Plus className="h-4 w-4" /> New project
              </Link>
            </div>
          ) : null
        }
      />
      <div className="space-y-4 p-4 sm:p-8">
        {projects.length === 0 ? (
          <Card>
            <EmptyState
              icon={<FolderKanban className="h-8 w-8" />}
              title="No projects yet"
              description="Projects group the tickets techs log time against, and can be created from a template."
            />
          </Card>
        ) : (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-4 font-medium">Project</th>
                    <th className="py-1 pr-4 font-medium">Client</th>
                    <th className="py-1 pr-4 font-medium">Status</th>
                    <th className="py-1 pr-4 font-medium">Manager</th>
                    <th className="py-1 pr-4 font-medium">Due</th>
                    <th className="py-1 pr-4 text-right font-medium">Tickets</th>
                    <th className="py-1 pr-4 text-right font-medium">Estimate</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((p) => {
                    // Restricted projects stay visible and openable — greyed, not
                    // hidden. Somebody who cannot log time still needs to be able
                    // to look the project up.
                    const authorization = checkAuthorized(
                      {
                        kind: "project",
                        name: p.name,
                        authorizedUserIds: p.authorizedTechs.map((t) => t.userId),
                      },
                      user.id,
                    );
                    const dimmed = authorization.restricted && !authorization.allowed;
                    return (
                    <tr
                      key={p.id}
                      className={`border-t align-top ${dimmed ? "opacity-60" : ""}`}
                      title={dimmed ? (authorization.reason ?? undefined) : undefined}
                    >
                      <td className="py-1.5 pr-4 font-medium">
                        <Link
                          href={`/silverfang/projects/${p.id}`}
                          className="text-primary hover:underline"
                        >
                          {p.name}
                        </Link>
                        {authorization.restricted && (
                          <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
                            <ShieldCheck className="h-3 w-3" />
                            {restrictionLabel(authorization)}
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 pr-4">
                        <Link
                          href={`/silverfang/clients/${p.client.id}`}
                          className="text-primary hover:underline"
                        >
                          {p.client.name}
                        </Link>
                      </td>
                      <td className="py-1.5 pr-4">{PROJECT_STATUS_LABELS[p.status]}</td>
                      <td className="py-1.5 pr-4">{p.manager?.name ?? p.manager?.email ?? "—"}</td>
                      <td className="py-1.5 pr-4 whitespace-nowrap">
                        {p.dueDate ? <LocalTime value={p.dueDate.toISOString()} dateOnly /> : "—"}
                      </td>
                      <td className="py-1.5 pr-4 text-right tabular-nums">{p._count.tickets}</td>
                      <td className="py-1.5 pr-4 text-right tabular-nums">
                        {p.estimatedHours != null ? formatHours(Number(p.estimatedHours)) : "—"}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        <Card>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">Project templates ({templates.length}) <PawTip topic="projectTemplates" /></h2>
          {templates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No templates yet. A template holds a reusable set of phases and ticket stubs (with
              estimated hours) that can be stamped out into a new project.
            </p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {templates.map((t) => (
                <li key={t.id} className="flex items-center gap-2">
                  <span className="font-medium">{t.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {t._count.phases} phase{t._count.phases === 1 ? "" : "s"} ·{" "}
                    {t._count.tickets} ticket{t._count.tickets === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
