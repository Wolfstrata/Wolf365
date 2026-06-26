import Link from "next/link";
import { GitMerge, ExternalLink } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { PageHeader, Card, EmptyState } from "@/components/ui/primitives";
import {
  autoMatchClientsAction,
  autoMatchSkusAction,
  confirmClientAction,
  rejectClientAction,
  confirmSkuAction,
  rejectSkuAction,
} from "./actions";
import { AutoMatchButton } from "./auto-match-button";

// The auto-match server actions materialize a Client per synced customer and
// can touch hundreds of records; allow up to 5 minutes (capped lower on Hobby).
export const maxDuration = 300;

function ConfidenceBadge({ value }: { value: number | null }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  const pct = Math.round(value * 100);
  const tone =
    pct >= 90 ? "text-success" : pct >= 60 ? "text-warning" : "text-danger";
  return <span className={`font-medium ${tone}`}>{pct}%</span>;
}

export default async function MappingsPage() {
  const user = await requireUser();
  if (!can(user.role, "mappings:read")) {
    return <PageHeader title="Mappings" description="Insufficient permissions." />;
  }
  const canApprove = can(user.role, "mappings:approve");
  const canPropose = can(user.role, "mappings:propose");

  const [clientProposals, productMappings, links] = await Promise.all([
    prisma.clientMatchProposal.findMany({
      where: { status: "PROPOSED" },
      orderBy: { confidence: "desc" },
      take: 200,
    }),
    prisma.productMapping.findMany({
      orderBy: [{ status: "asc" }, { confidence: "desc" }],
      take: 300,
    }),
    // Every client with its cross-system links, for the full linkages view.
    prisma.client.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        qboCustomer: { select: { displayName: true, companyName: true } },
        tdSynnexCustomer: {
          select: { name: true, _count: { select: { subscriptions: true } } },
        },
      },
    }),
  ]);

  // Human-readable product name per SKU, so reviewers aren't decoding raw codes.
  const skuList = [...new Set(productMappings.map((m) => m.tdSynnexSku))];
  const skuNames = new Map(
    (
      await prisma.tdSynnexSubscription.findMany({
        where: { productSku: { in: skuList } },
        select: { productSku: true, productName: true },
        distinct: ["productSku"],
      })
    ).map((s) => [s.productSku, s.productName]),
  );

  const linkCounts = {
    total: links.length,
    both: links.filter((l) => l.qboCustomer && l.tdSynnexCustomer).length,
    qboOnly: links.filter((l) => l.qboCustomer && !l.tdSynnexCustomer).length,
    tdOnly: links.filter((l) => !l.qboCustomer && l.tdSynnexCustomer).length,
  };

  // Resolve names for the client proposals in one round-trip each side.
  const qboIds = clientProposals.map((p) => p.qboCustomerId);
  const tdIds = clientProposals.map((p) => p.tdSynnexCustomerId);
  const [qboMap, tdMap] = await Promise.all([
    prisma.qboCustomer
      .findMany({ where: { id: { in: qboIds } } })
      .then((rows) => new Map(rows.map((r) => [r.id, r]))),
    prisma.tdSynnexCustomer
      .findMany({ where: { id: { in: tdIds } } })
      .then((rows) => new Map(rows.map((r) => [r.id, r]))),
  ]);

  return (
    <div>
      <PageHeader
        title="Mappings"
        description="AI-assisted client and SKU mapping. Exact matches auto-confirm; uncertain ones need review."
      />
      <div className="space-y-8 p-8">
        {/* Full customer linkages — every client and its QBO ↔ TD SYNNEX links */}
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">
              Customer linkages ({linkCounts.total})
            </h2>
            <p className="text-xs text-muted-foreground">
              {linkCounts.both} linked both · {linkCounts.qboOnly} QuickBooks only ·{" "}
              {linkCounts.tdOnly} TD SYNNEX only
            </p>
          </div>
          {links.length === 0 ? (
            <EmptyState
              icon={<GitMerge className="h-8 w-8" />}
              title="No customer linkages yet"
              description="Run auto-match after syncing QuickBooks and TD SYNNEX to create clients and link them across systems."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Client</th>
                    <th className="px-4 py-2 font-medium">QuickBooks</th>
                    <th className="px-4 py-2 font-medium">TD SYNNEX</th>
                    <th className="px-4 py-2 font-medium">M365 subs</th>
                    <th className="px-4 py-2 font-medium">Link status</th>
                    <th className="px-4 py-2 font-medium text-right">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {links.map((l) => {
                    const qboName =
                      l.qboCustomer?.companyName ?? l.qboCustomer?.displayName ?? null;
                    const tdName = l.tdSynnexCustomer?.name ?? null;
                    const status = qboName && tdName ? "Linked" : qboName ? "QBO only" : "TD only";
                    const tone =
                      status === "Linked"
                        ? "bg-success/15 text-success"
                        : "bg-warning/15 text-warning";
                    return (
                      <tr key={l.id} className="border-t hover:bg-accent/40">
                        <td className="px-4 py-2 font-medium">
                          <Link href={`/clients/${l.id}`} className="hover:underline">
                            {l.name}
                          </Link>
                        </td>
                        <td className="px-4 py-2">{qboName ?? <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-4 py-2">{tdName ?? <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-4 py-2 tabular-nums">
                          {l.tdSynnexCustomer?._count.subscriptions ?? 0}
                        </td>
                        <td className="px-4 py-2">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}
                          >
                            {status}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right">
                          <Link
                            href={`/clients/${l.id}`}
                            className="inline-flex items-center gap-1 text-primary hover:underline"
                          >
                            View <ExternalLink className="h-3.5 w-3.5" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Client mapping */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Client matches awaiting review</h2>
            {canPropose && <AutoMatchButton action={autoMatchClientsAction} />}
          </div>
          {clientProposals.length === 0 ? (
            <EmptyState
              icon={<GitMerge className="h-8 w-8" />}
              title="No client proposals"
              description="Run auto-match after syncing QuickBooks and TD SYNNEX to propose client links."
            />
          ) : (
            <div className="space-y-2">
              {clientProposals.map((p) => (
                <Card key={p.id} className="flex items-center justify-between">
                  <div className="text-sm">
                    <p className="font-medium">
                      {qboMap.get(p.qboCustomerId)?.displayName ?? "?"}
                      <span className="mx-2 text-muted-foreground">↔</span>
                      {tdMap.get(p.tdSynnexCustomerId)?.name ?? "?"}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Confidence <ConfidenceBadge value={p.confidence} /> · {p.method}
                    </p>
                  </div>
                  {canApprove && (
                    <div className="flex gap-2">
                      <form action={confirmClientAction}>
                        <input type="hidden" name="id" value={p.id} />
                        <button className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:opacity-90">
                          Confirm
                        </button>
                      </form>
                      <form action={rejectClientAction}>
                        <input type="hidden" name="id" value={p.id} />
                        <button className="rounded-md border px-3 py-1.5 text-sm font-medium transition hover:bg-accent">
                          Reject
                        </button>
                      </form>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* SKU mapping */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">SKU → QuickBooks item mappings</h2>
            {canPropose && <AutoMatchButton action={autoMatchSkusAction} />}
          </div>
          {productMappings.length === 0 ? (
            <EmptyState
              icon={<GitMerge className="h-8 w-8" />}
              title="No SKU mappings"
              description="Run auto-match after syncing TD SYNNEX subscriptions and QuickBooks items."
            />
          ) : (
            <div className="space-y-2">
              {productMappings.map((m) => (
                <Card key={m.id} className="flex items-center justify-between">
                  <div className="text-sm">
                    <p className="font-medium">
                      {skuNames.get(m.tdSynnexSku) ?? m.tdSynnexSku}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {m.tdSynnexSku}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Bill under QuickBooks item:{" "}
                      <span className="font-medium text-foreground">
                        {m.qboItemName ?? m.qboItemId ?? "Unmapped"}
                      </span>{" "}
                      · Confidence <ConfidenceBadge value={m.confidence} /> · {m.status}
                    </p>
                  </div>
                  {canApprove && m.status === "PROPOSED" && (
                    <div className="flex gap-2">
                      <form action={confirmSkuAction}>
                        <input type="hidden" name="sku" value={m.tdSynnexSku} />
                        <button className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:opacity-90">
                          Confirm
                        </button>
                      </form>
                      <form action={rejectSkuAction}>
                        <input type="hidden" name="sku" value={m.tdSynnexSku} />
                        <button className="rounded-md border px-3 py-1.5 text-sm font-medium transition hover:bg-accent">
                          Reject
                        </button>
                      </form>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
