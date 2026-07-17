import "server-only";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import {
  computeMyClients,
  type MyClientOppInput,
  type MyClientsReport,
} from "@/lib/crm/my-clients";
import { getLastTouchpoints } from "@/lib/crm/touchpoints";
import { domainOf } from "@/lib/crm/graph";
import type { MyClientTableRow } from "./clients-table";

const DAY = 86_400_000;

export interface MyClientsView {
  report: MyClientsReport;
  tableRows: MyClientTableRow[];
  touchpointsLive: boolean;
  /** Account managers an admin/power user may view (empty for regular reps). */
  reps: { id: string; label: string }[];
  canViewAsRep: boolean;
  viewingId: string;
  /** Name of the rep being viewed when it isn't the signed-in user. */
  viewingName: string | null;
}

/**
 * Load the My Clients view for the signed-in user (or, for admins/power users, a
 * chosen account manager via `repParam`). Shared by the main page and the
 * full-list "view all" screens so both agree on scoping, margin and touchpoints.
 */
export async function loadMyClientsView(repParam?: string): Promise<MyClientsView> {
  const user = await requirePermission("crm:read");
  const canViewAsRep = user.role === "ADMINISTRATOR" || user.role === "POWER_USER";

  const reps = canViewAsRep
    ? await (async () => {
        const owners = await prisma.crmOpportunity.groupBy({ by: ["ownerId"] });
        const users = await prisma.user.findMany({
          where: { id: { in: owners.map((o) => o.ownerId) } },
          select: { id: true, name: true, email: true },
        });
        return users
          .map((u) => ({ id: u.id, email: u.email, label: u.name ?? u.email }))
          .sort((a, b) => a.label.localeCompare(b.label));
      })()
    : [];

  const picked = canViewAsRep && repParam ? reps.find((r) => r.id === repParam) : undefined;
  const viewingId = picked?.id ?? user.id;
  const viewingEmail = picked?.email ?? user.email ?? "";
  const viewingName = picked?.label ?? null;

  const opps = await prisma.crmOpportunity.findMany({
    where: { ownerId: viewingId, stage: "CLOSED_WON" },
    select: {
      accountName: true,
      contactEmail: true,
      line: true,
      stage: true,
      amount: true,
      marginAmount: true,
      closeDate: true,
    },
  });

  const inputs: MyClientOppInput[] = opps.map((o) => ({
    accountName: o.accountName,
    line: o.line,
    stage: o.stage,
    amount: o.amount != null ? Number(o.amount) : 0,
    marginAmount: o.marginAmount != null ? Number(o.marginAmount) : null,
    closeDate: o.closeDate,
  }));

  const now = new Date();
  const report = computeMyClients(inputs, now);

  // Each account's touchpoint-matching domain(s) from its Salesforce contact email.
  const domainsByAccount = new Map<string, Set<string>>();
  for (const o of opps) {
    const dom = domainOf(o.contactEmail);
    if (!dom) continue;
    const account = o.accountName?.trim() || "Unknown account";
    (domainsByAccount.get(account) ?? domainsByAccount.set(account, new Set()).get(account)!).add(dom);
  }
  const accountDomains = new Map<string, string[]>();
  for (const r of report.rows) {
    const doms = domainsByAccount.get(r.account);
    if (doms && doms.size) accountDomains.set(r.account, [...doms]);
  }

  const { live: touchpointsLive, touchpoints } = await getLastTouchpoints(
    viewingEmail,
    accountDomains,
  );
  const tableRows: MyClientTableRow[] = report.rows.map((r) => {
    const tp = touchpoints.get(r.account) ?? null;
    return {
      account: r.account,
      grossRevenue: r.grossRevenue,
      grossMargin: r.grossMargin,
      avgMarginPct: r.avgMarginPct,
      totalSpend: r.totalSpend,
      daysSinceLastPurchase: r.daysSinceLastPurchase,
      daysSinceLastTouchpoint: tp ? Math.floor((now.getTime() - tp.getTime()) / DAY) : null,
    };
  });

  return {
    report,
    tableRows,
    touchpointsLive,
    reps: reps.map((r) => ({ id: r.id, label: r.label })),
    canViewAsRep,
    viewingId,
    viewingName,
  };
}
