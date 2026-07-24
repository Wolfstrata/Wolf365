import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { PageHeader, Card, EmptyState } from "@/components/ui/primitives";
import { formatDate } from "@/lib/utils";
import { fetchStellrChangeLogs, type ChangeLogResult } from "@/connectors/tdsynnex/changelogs";

export const maxDuration = 60;

/**
 * Derive the Stellr contract number for a subscription. It is usually carried in
 * the raw payload; otherwise the subscription id is `{contractNo}_{line}` (e.g.
 * "411833_1" → "411833"), so fall back to the prefix before the first separator.
 */
function deriveContractNo(
  raw: unknown,
  stellrSubscriptionId: string,
): string | null {
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    for (const k of ["contractNo", "contractNumber", "contract", "contractId"]) {
      const v = r[k];
      if (typeof v === "string" && v.trim()) return v.trim();
      if (typeof v === "number") return String(v);
    }
  }
  const prefix = stellrSubscriptionId.split(/[_\-:]/)[0];
  return prefix || null;
}

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
  searchParams: Promise<{ q?: string; cl?: string }>;
}) {
  await requirePermission("connectors:configure");
  const { q, cl } = await searchParams;
  const query = (q ?? "").trim();
  // Subscription id whose change logs the admin asked to fetch (live call).
  const changeLogSubId = (cl ?? "").trim();

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
          stellrId: true,
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

  // Live change-log retrieval for the one requested subscription (read-only).
  let changeLog: ChangeLogResult | null = null;
  let changeLogContractNo: string | null = null;
  if (changeLogSubId) {
    for (const c of customers) {
      const sub = c.subscriptions.find((s) => s.id === changeLogSubId);
      if (sub) {
        changeLogContractNo = deriveContractNo(sub.raw, sub.stellrSubscriptionId);
        if (changeLogContractNo) {
          changeLog = await fetchStellrChangeLogs(c.stellrId, changeLogContractNo);
        } else {
          changeLog = {
            ok: false,
            message: `Could not derive a contract number from subscription "${sub.stellrSubscriptionId}".`,
            records: [],
            raw: null,
          };
        }
        break;
      }
    }
  }

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
                const contractNo = deriveContractNo(s.raw, s.stellrSubscriptionId);
                const isActiveChangeLog = s.id === changeLogSubId;
                return (
                  <div key={s.id} className="rounded-lg border p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                      <span>
                        {s.productName ?? s.productSku ?? s.stellrSubscriptionId}{" "}
                        <span className="text-muted-foreground">· qty {s.quantity}</span>
                        {s.status && <span className="text-muted-foreground"> · {s.status}</span>}
                      </span>
                      <Link
                        href={`/admin/subscription-raw?q=${encodeURIComponent(query)}${isActiveChangeLog ? "" : `&cl=${encodeURIComponent(s.id)}`}#cl-${s.id}`}
                        id={`cl-${s.id}`}
                        className="rounded-md border px-2 py-0.5 text-xs font-normal transition hover:bg-accent"
                      >
                        {isActiveChangeLog ? "Hide change logs" : "Fetch change logs"}
                        {contractNo && (
                          <span className="ml-1 text-muted-foreground">(contract {contractNo})</span>
                        )}
                      </Link>
                    </div>

                    {isActiveChangeLog && changeLog && (
                      <ChangeLogBlock result={changeLog} contractNo={changeLogContractNo} />
                    )}

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

/**
 * Renders a live listSubscriptionChangeLogs response for one subscription:
 * status, the extracted entries with a date-field scan (so the mid-month add
 * date + quantity delta are easy to spot), and the full raw JSON.
 */
function ChangeLogBlock({
  result,
  contractNo,
}: {
  result: ChangeLogResult;
  contractNo: string | null;
}) {
  return (
    <div className="mb-3 rounded-md border border-dashed bg-muted/40 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span
          className={`rounded-full px-2 py-0.5 font-medium ${
            result.ok ? "bg-success/15 text-success" : "bg-danger/15 text-danger"
          }`}
        >
          {result.message}
        </span>
        {contractNo && <span className="text-muted-foreground">contract {contractNo}</span>}
        {result.ok && (
          <span className="text-muted-foreground">
            {result.records.length} change-log {result.records.length === 1 ? "entry" : "entries"}
          </span>
        )}
      </div>

      {result.url && (
        <p className="mb-2 break-all text-[11px] text-muted-foreground">
          <code>{result.url}</code>
        </p>
      )}

      {result.records.length > 0 && (
        <div className="mb-2 space-y-2">
          {result.records.map((entry, i) => {
            const dates = scanDateFields(entry);
            return (
              <div key={i} className="rounded border bg-background p-2">
                <p className="mb-1 text-[11px] font-medium text-muted-foreground">
                  Entry {i + 1} — date-like fields:
                </p>
                {dates.length > 0 ? (
                  <ul className="grid grid-cols-1 gap-x-6 gap-y-0.5 text-xs sm:grid-cols-2">
                    {dates.map((f) => (
                      <li key={f.path} className="tabular-nums">
                        <code className="text-primary">{f.path}</code>{" "}
                        <span className="text-muted-foreground">=</span> {f.value}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">No date-like fields.</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <details open={!result.ok || result.records.length === 0}>
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
          Full change-log response
        </summary>
        <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">
          {typeof result.raw === "string"
            ? result.raw
            : JSON.stringify(result.raw, null, 2)}
        </pre>
      </details>
    </div>
  );
}
