import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { PageHeader, Card, EmptyState } from "@/components/ui/primitives";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { PawTip } from "@/components/ui/paw-tip";
import { ShieldCheck } from "lucide-react";
import {
  DEFAULT_TERM_MONTHS,
  previewManagedAgreements,
  type ManagedCandidate,
} from "@/lib/silverfang/managed-service";
import { AGREEMENT_TYPE_LABELS } from "@/lib/silverfang/constants";
import { TagManagedButton } from "./tag-button";

export const dynamic = "force-dynamic";

/**
 * Tag SuperOps managed-services customers by giving each a placeholder agreement.
 *
 * This is a preview first and a button second. The classification is string
 * matching over free text somebody typed into SuperOps, so the operator gets to
 * see every client, the exact label that matched, and every client that didn't,
 * before anything is written. "It created 87 agreements" with no way to check
 * which 87 would be unauditable.
 */
export default async function ManagedAgreementsPage() {
  const user = await requirePermission("agreements:read");
  const canManage = can(user.role, "agreements:manage");
  const preview = await previewManagedAgreements();

  return (
    <div>
      <PageHeader
        help={<PawTip topic="managedAgreements" align="right" />}
        title="Tag managed-services customers"
        description={`Creates one draft ${DEFAULT_TERM_MONTHS}-month managed agreement per SuperOps managed customer, starting today.`}
        actions={canManage ? <TagManagedButton count={preview.toCreate.length} /> : null}
      />
      <div className="space-y-4 p-4 sm:p-8">
        <Breadcrumbs
          items={[
            { label: "Agreements", href: "/silverfang/agreements" },
            { label: "Tag managed customers" },
          ]}
        />

        <Card>
          <p className="text-sm text-muted-foreground">
            SuperOps has no managed-services flag, so SilverFang reads the client{" "}
            <span className="font-medium text-foreground">stage</span>, the client{" "}
            <span className="font-medium text-foreground">status</span>, and the names of the
            client&apos;s <span className="font-medium text-foreground">contracts</span>, looking for
            the word &ldquo;managed&rdquo;. A client labelled &ldquo;unmanaged&rdquo; is excluded
            even if a contract says otherwise. Everything created here is a{" "}
            <span className="font-medium text-foreground">draft</span> with no amounts, hours or
            rates — drafts cannot bill, so they tag the client and wait for you.
          </p>
        </Card>

        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="To create" value={preview.toCreate.length} accent />
          <Stat label="Already tagged" value={preview.alreadyTagged.length} />
          <Stat label="Can't create yet" value={preview.blocked.length} />
          <Stat label="Not managed" value={preview.unmatched.length} />
        </div>

        {preview.considered === 0 ? (
          <Card>
            <EmptyState
              icon={<ShieldCheck className="h-8 w-8" />}
              title="No SuperOps clients synced"
              description="Nothing can be classified until the SuperOps connector has synced its client list. Run the sync from Connectors, then come back."
            />
          </Card>
        ) : (
          <>
            <CandidateTable
              title={`Will get a new draft agreement (${preview.toCreate.length})`}
              note="One agreement each, term starting today. Press the button above to create them."
              rows={preview.toCreate}
              showType
            />
            <CandidateTable
              title={`Already tagged (${preview.alreadyTagged.length})`}
              note="These clients already have a managed agreement, so they are left alone."
              rows={preview.alreadyTagged}
              showExisting
            />
            <CandidateTable
              title={`Matched but can't be created (${preview.blocked.length})`}
              note="Fix the reason and re-run — nothing is skipped silently."
              rows={preview.blocked}
            />
            <CandidateTable
              title={`Not managed (${preview.unmatched.length})`}
              note="No managed-services signal in SuperOps. If one of these should be managed, tag it by hand or fix its stage in SuperOps."
              rows={preview.unmatched}
              collapsed
            />
          </>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <Card>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold tabular-nums ${accent && value > 0 ? "text-primary" : ""}`}
      >
        {value}
      </p>
    </Card>
  );
}

function CandidateTable({
  title,
  note,
  rows,
  showType,
  showExisting,
  collapsed,
}: {
  title: string;
  note: string;
  rows: ManagedCandidate[];
  showType?: boolean;
  showExisting?: boolean;
  /** Long, low-interest lists start folded rather than being omitted. */
  collapsed?: boolean;
}) {
  if (rows.length === 0) return null;

  const table = (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="py-1 pr-4 font-medium">Client</th>
            <th className="py-1 pr-4 font-medium">SuperOps stage</th>
            <th className="py-1 pr-4 font-medium">SuperOps status</th>
            {showType && <th className="py-1 pr-4 font-medium">Agreement type</th>}
            {showExisting && <th className="py-1 pr-4 font-medium">Existing agreement</th>}
            <th className="py-1 pr-4 font-medium">Why</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.superOpsName} className="border-t align-top">
              <td className="py-1.5 pr-4 font-medium">
                {r.clientId ? (
                  <Link
                    href={`/silverfang/clients/${r.clientId}`}
                    className="text-primary hover:underline"
                  >
                    {r.clientName}
                  </Link>
                ) : (
                  r.clientName
                )}
              </td>
              <td className="py-1.5 pr-4 text-muted-foreground">{r.stage || "—"}</td>
              <td className="py-1.5 pr-4 text-muted-foreground">{r.status || "—"}</td>
              {showType && (
                <td className="py-1.5 pr-4">
                  {r.verdict.kind ? AGREEMENT_TYPE_LABELS[r.verdict.kind] : "—"}
                </td>
              )}
              {showExisting && (
                <td className="py-1.5 pr-4">
                  {r.existingAgreement ? (
                    <Link
                      href={`/silverfang/agreements/${r.existingAgreement.id}`}
                      className="text-primary hover:underline"
                    >
                      {r.existingAgreement.name}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
              )}
              <td className="py-1.5 pr-4 text-muted-foreground">
                {r.skipReason ?? describeKind(r)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <Card>
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
      <div className="mt-3">
        {collapsed ? (
          <details>
            <summary className="cursor-pointer text-xs text-primary hover:underline">
              Show all {rows.length}
            </summary>
            <div className="mt-3">{table}</div>
          </details>
        ) : (
          table
        )}
      </div>
    </Card>
  );
}

function describeKind(r: ManagedCandidate): string {
  const { source, label } = r.verdict;
  if (source === "stage" || source === "status") return `${source} says "${label}"`;
  if (source === "contract") return `contract "${label}"`;
  return "—";
}
