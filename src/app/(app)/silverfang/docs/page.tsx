import Link from "next/link";
import { BookText, Info } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card } from "@/components/ui/primitives";
import { PawTip } from "@/components/ui/paw-tip";
import { DOC_SECTIONS, type DocBlock } from "@/lib/silverfang/docs";

export const dynamic = "force-dynamic";

/**
 * The SilverFang manual.
 *
 * Content lives in `docs.ts` as data, so this page builds its own contents list
 * from it and a test can assert nothing is left empty. Gated on `tickets:read`,
 * the same as the rest of the module — documentation nobody can open is not
 * documentation.
 */
export default async function SilverFangDocsPage() {
  await requirePermission("tickets:read");

  return (
    <div>
      <PageHeader
        help={<PawTip topic="docs" />}
        title="SilverFang Docs"
        description="How the service desk works: boards, tickets, time, agreements, projects and email."
      />
      <div className="space-y-6 p-4 sm:p-8">
        <Card>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <BookText className="h-4 w-4" /> Contents
          </h2>
          <ol className="space-y-1.5 text-sm">
            {DOC_SECTIONS.map((s, i) => (
              <li key={s.id} className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-xs tabular-nums text-muted-foreground">{i + 1}.</span>
                <a href={`#${s.id}`} className="font-medium text-primary hover:underline">
                  {s.title}
                </a>
                <span className="text-xs text-muted-foreground">{s.summary}</span>
              </li>
            ))}
          </ol>
        </Card>

        {DOC_SECTIONS.map((section) => (
          <Card key={section.id}>
            {/* scroll-mt so an anchor jump does not tuck the heading under the
                sticky top bar on mobile. */}
            <h2
              id={section.id}
              className="scroll-mt-20 text-base font-semibold tracking-tight"
            >
              {section.title}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{section.summary}</p>
            <div className="mt-3 space-y-3">
              {section.blocks.map((block, i) => (
                <Block key={i} block={block} />
              ))}
            </div>
          </Card>
        ))}

        <p className="text-xs text-muted-foreground">
          Something here disagree with what the app does? The app is right and this page is
          wrong — say so and it gets fixed. Every screen also carries a{" "}
          <span className="font-medium">silver paw</span>: hover it for the short version of
          whatever you are looking at.{" "}
          <Link href="/silverfang/dashboard" className="text-primary hover:underline">
            Back to the dashboard
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

function Block({ block }: { block: DocBlock }) {
  if (block.h) {
    return (
      <h3 className="pt-1 text-sm font-semibold text-foreground">{block.h}</h3>
    );
  }
  if (block.note) {
    return (
      <p className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <span>{block.note}</span>
      </p>
    );
  }
  if (block.list) {
    return (
      <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed">
        {block.list.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    );
  }
  return <p className="text-sm leading-relaxed">{block.p}</p>;
}
