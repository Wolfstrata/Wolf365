import { requirePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { PageHeader, Card, EmptyState } from "@/components/ui/primitives";
import { formatDate } from "@/lib/utils";

export const maxDuration = 60;

/**
 * Admin diagnostic: inspect the raw TD SYNNEX (Stellr) subscription payloads for a
 * client. Read-only. Used to identify which raw field carries a subscription's real
 * mid-month activation/add date (vs. a term-anchor date) so mid-month license
 * additions can be pro-rated on their own billing line.
 *
 * It lists each subscription's parsed dates, a scan of every date-looking field in
 * the raw JSON (the quick way to spot the add date), and the full raw payload to copy.
 */

/** Does a value look like a date/timestamp we can surface as a candidate? */
function looksLikeDate(v: unknown): v is string {
  if (typeof v !== "string" || v.length < 8) return false;
  // ISO-ish (2026-07-15...) or a parseable date string.
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return true;
  return false;
}

/** Collect date-ish fields from the raw payload (top level + one nested level). */
function scanDateFields(raw: unknown): { path: string; value: string }[] {
  const out: { path: string; value: string }[] = [];
  const dateKey = /(date|start|end|effective|created|activat|provision|order|term|renew|expir|commit|cancel)/i;
  const visit = (obj: unknown, prefix: string, depth: number) => {
    if (!obj || typeof obj !== "object" || depth > 2) return;
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (looksLikeDate(v) || (dateKey.test(k) && (typeof v === "string" || typeof v === "number"))) {
        out.push({ path, value: String(v) });
      } else if (v && typeof v === "object") {
        visit(v, path, depth + 1);
      }
    }
  };
  visit(raw, "", 0);
  return out;
}

export default async function SubscriptionRawPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requirePermission("connectors:configure");
  const { q } = await searchParams;
  const query = (q ?? "").trim();

  const customers = query
    ? await prisma.tdSynnexCustomer.findMany({
        where: {
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { client: { name: { contains: query, mode: "insensitive" } } },
          ],
        },
        select: {
          id: true,
          name: true,
          subscriptions: {
            orderBy: { startDate: "desc" },
            select: {
              id: true,
              stellrSubscriptionId: true,
              productSku: true,
              productName: true,
              quantity: true,
              status: true,
              startDate: true,
              renewalDate: true,
              cancellationWindowEnds: true,
              raw: true,
            },
          },
        },
        take: 5,
      })
    : [];

  return (
    <div>
      <PageHeader
        title="Subscription raw (diagnostic)"
        description="Inspect a client's TD SYNNEX subscription payloads to find which field holds the real mid-month add date. Read-only, admin only."
      />
      <div className="space-y-6 p-4 sm:p-8">
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label className="block text-xs font-medium text-muted-foreground">
            Client or TD SYNNEX customer name
            <input
              name="q"
              defaultValue={query}
              placeholder="e.g. Alair"
              className="mt-1 block w-72 rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <button className="rounded-md border px-3 py-1.5 text-sm font-medium transition hover:bg-accent">
            Search
          </button>
        </form>

        {query && customers.length === 0 && (
          <EmptyState
            title="No matching customers"
            description={`No synced TD SYNNEX customer matches "${query}". Try part of the client name.`}
          />
        )}

        {customers.map((c) => (
          <Card key={c.id}>
            <h2 className="mb-1 text-sm font-semibold">{c.name}</h2>
            <p className="mb-4 text-xs text-muted-foreground">
              {c.subscriptions.length} subscription{c.subscriptions.length === 1 ? "" : "s"}
            </p>
            <div className="space-y-6">
              {c.subscriptions.map((s) => {
                const candidates = scanDateFields(s.raw);
                return (
                  <div key={s.id} className="rounded-lg border p-3">
                    <div className="mb-2 text-sm font-medium">
                      {s.productName ?? s.productSku ?? s.stellrSubscriptionId}{" "}
                      <span className="text-muted-foreground">· qty {s.quantity}</span>
                      {s.status && <span className="text-muted-foreground"> · {s.status}</span>}
                    </div>

                    <div className="mb-3 grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
                      <div>
                        <span className="text-muted-foreground">Parsed startDate: </span>
                        <span className="font-medium">{s.startDate ? formatDate(s.startDate) : "—"}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">renewalDate: </span>
                        <span className="font-medium">{s.renewalDate ? formatDate(s.renewalDate) : "—"}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">cancellationWindowEnds: </span>
                        <span className="font-medium">
                          {s.cancellationWindowEnds ? formatDate(s.cancellationWindowEnds) : "—"}
                        </span>
                      </div>
                    </div>

                    {candidates.length > 0 && (
                      <div className="mb-3">
                        <p className="mb-1 text-xs font-medium text-muted-foreground">
                          Date-like fields found in raw (the add date should be one of these):
                        </p>
                        <ul className="grid grid-cols-1 gap-x-6 gap-y-0.5 text-xs sm:grid-cols-2">
                          {candidates.map((f) => (
                            <li key={f.path} className="tabular-nums">
                              <code className="text-primary">{f.path}</code>{" "}
                              <span className="text-muted-foreground">=</span> {f.value}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <details>
                      <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
                        Full raw JSON
                      </summary>
                      <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">
                        {JSON.stringify(s.raw, null, 2)}
                      </pre>
                    </details>
                  </div>
                );
              })}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
