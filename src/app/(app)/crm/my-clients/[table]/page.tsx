import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/primitives";
import { loadMyClientsView } from "../data";
import { MoversTable } from "../movers-table";
import { MyClientsTable } from "../clients-table";

export const maxDuration = 120;

const TITLES: Record<string, string> = {
  roster: "Client roster — all",
  movers: "Year-over-year spend movers — all",
};

/** Full-list "view all" screen for a single My Clients table. */
export default async function MyClientsTablePage({
  params,
  searchParams,
}: {
  params: Promise<{ table: string }>;
  searchParams: Promise<{ rep?: string }>;
}) {
  await requirePermission("crm:read");
  const { table } = await params;
  const title = TITLES[table];
  if (!title) notFound();

  const sp = await searchParams;
  const v = await loadMyClientsView(sp.rep);
  const { report } = v;

  const whose = v.viewingName ? `${v.viewingName}'s accounts` : "Your accounts";
  const backHref = `/crm/my-clients${sp.rep ? `?rep=${encodeURIComponent(sp.rep)}` : ""}`;

  return (
    <div>
      <PageHeader
        title={title}
        description={
          table === "movers"
            ? `${whose} — won revenue ${report.compareYear} vs ${report.priorYear}.`
            : `${whose} — ${report.fyLabel} gross figures and lifetime spend.`
        }
      />
      <div className="space-y-6 p-4 sm:p-8">
        <Link href={backHref} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to My Clients
        </Link>

        {!report.hasData ? (
          <p className="text-sm text-muted-foreground">No clients yet.</p>
        ) : table === "roster" ? (
          <MyClientsTable rows={v.tableRows} touchpointsLive={v.touchpointsLive} />
        ) : report.spendMovers.up.length > 0 || report.spendMovers.down.length > 0 ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <MoversTable rows={report.spendMovers.up} priorYear={report.priorYear} compareYear={report.compareYear} kind="up" />
            <MoversTable rows={report.spendMovers.down} priorYear={report.priorYear} compareYear={report.compareYear} kind="down" />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Not enough year-over-year history yet.</p>
        )}
      </div>
    </div>
  );
}
