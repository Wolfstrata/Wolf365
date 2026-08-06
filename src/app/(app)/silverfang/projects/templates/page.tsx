import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card } from "@/components/ui/primitives";
import { formatTemplateTasks } from "@/lib/silverfang/project-templates";
import { TemplateForm } from "./template-form";

export const dynamic = "force-dynamic";

/** Project templates: a standard task list stamped onto new projects. */
export default async function ProjectTemplatesPage() {
  await requirePermission("projects:manage");

  const templates = await prisma.sfProjectTemplate.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: {
      tasks: { orderBy: { sortOrder: "asc" } },
      _count: { select: { projects: true } },
    },
  });

  return (
    <div>
      <PageHeader
        title="Project templates"
        description="Standard task lists — a template's tasks are copied onto a project when it's created."
      />
      <div className="space-y-6 p-4 sm:p-8">
        <Link
          href="/silverfang/projects"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Projects
        </Link>

        {templates.map((t) => (
          <Card key={t.id}>
            <details>
              <summary className="cursor-pointer text-sm font-semibold">
                {t.name}{" "}
                <span className="font-normal text-muted-foreground">
                  · {t.tasks.length} task{t.tasks.length === 1 ? "" : "s"} · used by{" "}
                  {t._count.projects} project{t._count.projects === 1 ? "" : "s"}
                  {t.active ? "" : " · inactive"}
                </span>
              </summary>
              <div className="mt-4">
                <TemplateForm
                  values={{
                    id: t.id,
                    name: t.name,
                    description: t.description ?? "",
                    active: t.active,
                    tasks: formatTemplateTasks(
                      t.tasks.map((x) => ({
                        phase: x.phase,
                        name: x.name,
                        estimatedHours:
                          x.estimatedHours != null ? Number(x.estimatedHours) : null,
                        dueOffsetDays: x.dueOffsetDays,
                      })),
                    ),
                  }}
                  submitLabel="Save template"
                />
              </div>
            </details>
          </Card>
        ))}

        <Card>
          <details open={templates.length === 0}>
            <summary className="cursor-pointer text-sm font-semibold">New template</summary>
            <div className="mt-4">
              <TemplateForm
                values={{ name: "", description: "", active: true, tasks: "" }}
                submitLabel="Create template"
              />
            </div>
          </details>
        </Card>
      </div>
    </div>
  );
}
