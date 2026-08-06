import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card, EmptyState } from "@/components/ui/primitives";
import { MapRow } from "./map-form";

export const dynamic = "force-dynamic";

/** Line kinds that are not hours, and what each one means. */
const KINDS: { kind: string; label: string; hint: string }[] = [
  { kind: "RECURRING", label: "Recurring agreement fee", hint: "Managed services / NOC monthly or annual fee." },
  { kind: "BLOCK_PURCHASE", label: "Prepaid hours block", hint: "A block of hours the client bought." },
  { kind: "PROJECT_FEE", label: "Fixed-fee project", hint: "A fixed-fee project's fee for the interval." },
  { kind: "PROJECT_DEPOSIT", label: "Project deposit", hint: "An up-front percentage of a project total." },
  { kind: "TIME", label: "Time (fallback)", hint: "Used when a charge code has no item of its own." },
  { kind: "OVERAGE", label: "Overage (fallback)", hint: "Hours past an inclusion or prepaid balance." },
  { kind: "MANUAL", label: "Manual line", hint: "A line added by hand during review." },
];

/**
 * Which QuickBooks item each kind of line pushes as. Without a mapping a line is
 * skipped at push and the run finishes PARTIALLY FAILED — deliberately loud,
 * because the alternative is an invoice that quietly went out short.
 */
export default async function SfBillingSettingsPage() {
  await requirePermission("billing:read");
  const [items, chargeCodes, codeMaps, kindMaps] = await Promise.all([
    prisma.qboItem.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { qboId: true, name: true },
      take: 1000,
    }),
    prisma.sfChargeCode.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, code: true, name: true, kind: true },
    }),
    prisma.sfChargeCodeItemMap.findMany(),
    prisma.sfBillingKindItemMap.findMany(),
  ]);

  const itemByCode = new Map(codeMaps.map((m) => [m.chargeCodeId, m.qboItemId]));
  const itemByKind = new Map(kindMaps.map((m) => [m.kind as string, m.qboItemId]));
  const unmappedCodes = chargeCodes.filter(
    (c) => c.kind === "BILLABLE_WORK" && !itemByCode.get(c.id),
  ).length;

  return (
    <div>
      <PageHeader
        title="SilverFang Billing — item mapping"
        description="What each kind of line becomes in QuickBooks. An unmapped line is skipped at push, never silently dropped."
      />
      <div className="space-y-6 p-4 sm:p-8">
        <Link
          href="/silverfang-billing"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> SilverFang Billing
        </Link>

        {items.length === 0 ? (
          <EmptyState
            title="No QuickBooks items synced yet"
            description="Run the QuickBooks Online connector sync first — mapping needs its item list."
          />
        ) : (
          <>
            {unmappedCodes > 0 && (
              <Card>
                <p className="text-sm">
                  <span className="font-medium text-warning">
                    {unmappedCodes} billable charge code{unmappedCodes === 1 ? "" : "s"}
                  </span>{" "}
                  ha{unmappedCodes === 1 ? "s" : "ve"} no QuickBooks item. Time on{" "}
                  {unmappedCodes === 1 ? "it" : "them"} will fall back to the Time item below, and
                  if that is unmapped too the lines will be skipped at push.
                </p>
              </Card>
            )}

            <Card>
              <h2 className="mb-1 text-sm font-semibold">Charge codes</h2>
              <p className="mb-3 text-xs text-muted-foreground">
                Hours logged against a charge code push as its item. Most useful when QuickBooks has
                separate service items per rate.
              </p>
              {chargeCodes.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No charge codes yet — run the SilverFang setup to create the defaults.
                </p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {chargeCodes.map((c) => (
                    <MapRow
                      key={c.id}
                      scope="chargeCode"
                      id={c.id}
                      label={`${c.code} — ${c.name}`}
                      hint={c.kind.replaceAll("_", " ").toLowerCase()}
                      current={itemByCode.get(c.id) ?? null}
                      items={items}
                    />
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <h2 className="mb-1 text-sm font-semibold">Line kinds</h2>
              <p className="mb-3 text-xs text-muted-foreground">
                Everything that is not hours against a charge code. These are the ones to get right
                first — a recurring fee with no item means the whole monthly charge is skipped.
              </p>
              <ul className="divide-y rounded-md border">
                {KINDS.map((k) => (
                  <MapRow
                    key={k.kind}
                    scope="kind"
                    id={k.kind}
                    label={k.label}
                    hint={k.hint}
                    current={itemByKind.get(k.kind) ?? null}
                    items={items}
                  />
                ))}
              </ul>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
