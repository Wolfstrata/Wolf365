import { Award } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card, EmptyState } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

/**
 * Opportunity Reliability leaderboard. For each sales rep, the reliability
 * rating is the percentage of the opportunities they entered that ultimately
 * moved from open pipeline to Closed Won. Reps are ranked most → least reliable.
 * Uses ALL dates (not fiscal-year scoped) so it reflects a rep's full track record.
 */
export default async function OpportunityReliabilityPage() {
  await requirePermission("crm:read");

  // Count opportunities per owner × stage across all time.
  const grouped = await prisma.crmOpportunity.groupBy({
    by: ["ownerId", "stage"],
    _count: { _all: true },
  });

  type Tally = { total: number; won: number; lost: number; open: number };
  const byOwner = new Map<string, Tally>();
  for (const g of grouped) {
    const t = byOwner.get(g.ownerId) ?? { total: 0, won: 0, lost: 0, open: 0 };
    const n = g._count._all;
    t.total += n;
    if (g.stage === "CLOSED_WON") t.won += n;
    else if (g.stage === "CLOSED_LOST") t.lost += n;
    else t.open += n;
    byOwner.set(g.ownerId, t);
  }

  const owners = await prisma.user.findMany({
    where: { id: { in: [...byOwner.keys()] } },
    select: { id: true, name: true, email: true },
  });
  const nameById = new Map(owners.map((o) => [o.id, o.name ?? o.email]));

  const ranked = [...byOwner.entries()]
    .map(([ownerId, t]) => {
      const decided = t.won + t.lost;
      return {
        rep: nameById.get(ownerId) ?? "Unknown",
        // Reliability = entered opportunities that reached Closed Won.
        reliability: t.total > 0 ? (t.won / t.total) * 100 : 0,
        // Win rate = of decided (won or lost) opportunities, how many were won.
        winRate: decided > 0 ? (t.won / decided) * 100 : null,
        ...t,
      };
    })
    // Most reliable first; break ties by more wins, then name.
    .sort(
      (a, b) =>
        b.reliability - a.reliability ||
        b.won - a.won ||
        a.rep.localeCompare(b.rep),
    );

  const MEDALS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

  return (
    <div>
      <PageHeader
        title="Opportunity Reliability"
        description="How reliably each rep's entered opportunities convert to Closed Won — the share of every opportunity they created that ended up won. Ranked best to worst, across all dates."
      />
      <div className="space-y-6 p-4 sm:p-8">
        {ranked.length === 0 ? (
          <EmptyState
            icon={<Award className="h-8 w-8" />}
            title="No opportunities yet"
            description="Once opportunities are created or synced from Salesforce, each rep's reliability rating appears here."
          />
        ) : (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Rank</th>
                    <th className="px-3 py-2 font-medium">Rep</th>
                    <th className="px-3 py-2 text-right font-medium">Reliability</th>
                    <th className="px-3 py-2 text-right font-medium">Won</th>
                    <th className="px-3 py-2 text-right font-medium">Lost</th>
                    <th className="px-3 py-2 text-right font-medium">Open</th>
                    <th className="px-3 py-2 text-right font-medium">Total entered</th>
                    <th className="px-3 py-2 text-right font-medium">Win rate (of closed)</th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((r, i) => {
                    const rank = i + 1;
                    return (
                      <tr key={r.rep} className={cn("border-t", rank <= 3 && "bg-accent/30")}>
                        <td className="px-3 py-2 font-medium tabular-nums">
                          {MEDALS[rank] ?? rank}
                        </td>
                        <td className="px-3 py-2 font-medium">{r.rep}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">
                          {r.reliability.toFixed(1)}%
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-success">{r.won}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-danger">{r.lost}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.open}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.total}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {r.winRate != null ? `${r.winRate.toFixed(1)}%` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Reliability = Closed Won ÷ total opportunities entered (open deals count
              against it since they haven&apos;t converted yet). Win rate = Closed Won ÷
              (Closed Won + Closed Lost). Watch the &ldquo;Total entered&rdquo; column —
              a high rating on very few opportunities is a small sample.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}
