import Link from "next/link";
import { Trash2 } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card, EmptyState } from "@/components/ui/primitives";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { PawTip } from "@/components/ui/paw-tip";
import {
  deleteProjectTemplateAction,
  projectTemplateFormValues,
} from "../../project-actions";
import { TemplateForm, BLANK_TEMPLATE } from "./template-form";

export const dynamic = "force-dynamic";

/**
 * Project templates: a reusable project shape — phases and ticket stubs —
 * with no client attached.
 *
 * Every template is editable in place rather than behind a detail route, because
 * a template is one screen's worth of definition and a round trip per edit is
 * friction for no gain.
 */
export default async function ProjectTemplatesPage() {
  await requirePermission("projects:manage");

  const templates = await prisma.sfProjectTemplate.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      sourceProjectId: true,
      active: true,
      _count: { select: { phases: true, tickets: true, projects: true } },
    },
  });

  // Loaded through the action module's mapper so the edit form is fed by exactly
  // the same shape the save path parses back.
  const values = await Promise.all(templates.map((t) => projectTemplateFormValues(t.id)));

  return (
    <div>
      <PageHeader
        help={<PawTip topic="projectTemplates" />}
        title="Project templates"
        description="A reusable project shape — phases and tickets — with no client attached."
      />
      <div className="space-y-6 p-4 sm:p-8">
        <Breadcrumbs
          items={[
            { label: "Projects", href: "/silverfang/projects" },
            { label: "Templates" },
          ]}
        />

        {templates.length === 0 && (
          <Card>
            <EmptyState
              title="No templates yet"
              description="Build one below, or open a project you have already run and use “Save as template” to capture its phases and tickets."
            />
          </Card>
        )}

        {templates.map((t, i) => {
          const v = values[i];
          if (!v) return null;
          return (
            <Card key={t.id}>
              <details>
                <summary className="cursor-pointer text-sm font-semibold">
                  {t.name}{" "}
                  <span className="font-normal text-muted-foreground">
                    · {t._count.phases} phase{t._count.phases === 1 ? "" : "s"} ·{" "}
                    {t._count.tickets} ticket{t._count.tickets === 1 ? "" : "s"} · used by{" "}
                    {t._count.projects} project{t._count.projects === 1 ? "" : "s"}
                    {t.sourceProjectId ? " · captured from a project" : ""}
                    {t.active ? "" : " · inactive"}
                  </span>
                </summary>
                <div className="mt-4 space-y-4">
                  <TemplateForm values={v} submitLabel="Save template" />
                  <div className="flex items-center justify-between gap-3 border-t pt-3">
                    <p className="text-xs text-muted-foreground">
                      Deleting a template leaves every project made from it untouched — their
                      phases and tickets are records of real work.
                    </p>
                    <form action={deleteProjectTemplateAction}>
                      <input type="hidden" name="id" value={t.id} />
                      <button
                        type="submit"
                        className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium text-danger transition hover:bg-danger/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete template
                      </button>
                    </form>
                  </div>
                </div>
              </details>
            </Card>
          );
        })}

        <Card>
          <details open={templates.length === 0}>
            <summary className="cursor-pointer text-sm font-semibold">New template</summary>
            <div className="mt-4">
              <TemplateForm values={BLANK_TEMPLATE} submitLabel="Create template" />
            </div>
          </details>
        </Card>

        <p className="text-xs text-muted-foreground">
          To use one, create a project and pick the template — its phases and tickets are stamped
          out. See{" "}
          <Link href="/silverfang/projects/new" className="text-primary hover:underline">
            new project
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
