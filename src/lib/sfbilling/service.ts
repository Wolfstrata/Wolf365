import "server-only";
import type { SfBillingRunStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { availableHours } from "@/lib/silverfang/block-time";
import {
  generateSfBillingLines,
  sumSfLineTotals,
  type AgreementInput,
  type BlockInput,
  type ProjectInput,
  type SfGenerationResult,
  type TimeEntryInput,
} from "./generate";
import { assertTransition } from "./state";

/**
 * Loads what SilverFang has, hands it to the pure generator, and persists the
 * result. No billing rules live here — they are all in `generate.ts`, so the
 * preview a reviewer sees and the run that gets saved cannot diverge.
 */

const num = (v: { toString(): string } | null | undefined): number | null =>
  v != null ? Number(v) : null;

export interface SfGenerateRunParams {
  clientId: string;
  periodStart: Date;
  /** Exclusive. */
  periodEnd: Date;
  invoiceDate: Date;
  groupBy?: "CHARGE_CODE" | "TICKET";
  actor: { id: string; email: string };
}

/**
 * Which time entries are billable input: approved, not yet invoiced, in period.
 *
 * APPROVED is deliberate — draft or submitted time has not been checked by
 * anyone, and an invoice is the wrong place to discover a typo. `invoicedAt: null`
 * is the idempotency guard that stops a second run re-billing the same hour.
 */
async function loadTimeEntries(
  clientId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<TimeEntryInput[]> {
  const rows = await prisma.sfTimeEntry.findMany({
    where: {
      status: "APPROVED",
      invoicedAt: null,
      workDate: { gte: periodStart, lt: periodEnd },
      OR: [
        { ticket: { clientId } },
        { agreement: { clientId } },
        { projectTask: { project: { clientId } } },
        { projectPhase: { project: { clientId } } },
      ],
    },
    orderBy: { workDate: "asc" },
    include: {
      chargeCode: { select: { id: true, name: true } },
      ticket: {
        select: { number: true, summary: true, projectId: true, clientId: true },
      },
      projectTask: { select: { projectId: true } },
      projectPhase: { select: { projectId: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    workDate: r.workDate,
    hours: Number(r.hours),
    rate: num(r.rate),
    costRate: num(r.costRate),
    billable: r.billable,
    internalOnly: r.internalOnly,
    notes: r.notes,
    chargeCodeId: r.chargeCodeId,
    chargeCodeName: r.chargeCode.name,
    agreementId: r.agreementId,
    // A project can be reached three ways; the ticket's own project wins because
    // that is the most specific statement of what the work was for.
    projectId:
      r.ticket?.projectId ?? r.projectPhase?.projectId ?? r.projectTask?.projectId ?? null,
    ticketNumber: r.ticket?.number ?? null,
    ticketSummary: r.ticket?.summary ?? null,
  }));
}

async function loadAgreements(clientId: string): Promise<AgreementInput[]> {
  const rows = await prisma.sfAgreement.findMany({
    where: { clientId, status: "ACTIVE" },
    include: { blocks: { include: { draws: { select: { hours: true } } } } },
  });
  return rows.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    billingFrequency: a.billingFrequency,
    monthlyAmount: num(a.monthlyAmount),
    includedHours: num(a.includedHours),
    overageRate: num(a.overageRate),
    standardRate: num(a.standardRate),
    startDate: a.startDate,
    endDate: a.endDate,
    // The balance already reflects every draw ever recorded, including draws for
    // the entries in this period — which is what we want: those hours were
    // prepaid, and the generator must see them as covered.
    blockBalanceHours: availableHours(
      a.blocks.map((b) => ({
        id: b.id,
        purchasedHours: Number(b.purchasedHours),
        purchasedAt: b.purchasedAt,
        expiresAt: b.expiresAt,
        hoursUsed: b.draws.reduce((acc, d) => acc + Number(d.hours), 0),
      })),
    ),
  }));
}

async function loadBlocks(clientId: string): Promise<BlockInput[]> {
  const rows = await prisma.sfAgreementBlock.findMany({
    where: { agreement: { clientId } },
    include: { agreement: { select: { id: true, name: true } } },
  });
  return rows.map((b) => ({
    id: b.id,
    agreementId: b.agreement.id,
    agreementName: b.agreement.name,
    purchasedHours: Number(b.purchasedHours),
    rate: num(b.rate),
    amount: num(b.amount),
    purchasedAt: b.purchasedAt,
    invoiced: b.invoicedAt != null,
  }));
}

async function loadProjects(clientId: string): Promise<ProjectInput[]> {
  const rows = await prisma.sfProject.findMany({
    where: { clientId, status: { in: ["PLANNED", "ACTIVE", "ON_HOLD", "COMPLETED"] } },
  });
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    billingType: p.billingType,
    fixedFeeAmount: num(p.fixedFeeAmount),
    billingIntervalDays: p.billingIntervalDays,
    startDate: p.startDate,
    feeBilledThroughAt: p.feeBilledThroughAt,
    budgetAmount: num(p.budgetAmount),
    depositPercent: num(p.depositPercent),
    depositAmount: num(p.depositAmount),
    depositInvoicedAt: p.depositInvoicedAt,
  }));
}

export interface SfPreview extends SfGenerationResult {
  clientName: string;
  total: number;
}

/** Generate without saving, for the "what would this bill?" preview. */
export async function previewSfBillingRun(
  params: Omit<SfGenerateRunParams, "actor" | "invoiceDate">,
): Promise<SfPreview> {
  const client = await prisma.client.findUniqueOrThrow({
    where: { id: params.clientId },
    select: { name: true },
  });
  const [timeEntries, agreements, blocks, projects] = await Promise.all([
    loadTimeEntries(params.clientId, params.periodStart, params.periodEnd),
    loadAgreements(params.clientId),
    loadBlocks(params.clientId),
    loadProjects(params.clientId),
  ]);
  const result = generateSfBillingLines({
    clientName: client.name,
    periodStart: params.periodStart,
    periodEnd: params.periodEnd,
    timeEntries,
    agreements,
    blocks,
    projects,
    groupBy: params.groupBy,
  });
  return { ...result, clientName: client.name, total: sumSfLineTotals(result.lines) };
}

/**
 * Generate and save a run. Returns the run id.
 *
 * The default QBO item for each line is resolved at generation time from the
 * charge-code and kind maps, so a reviewer can see straight away which lines are
 * pushable. A line with no mapped item is still created — it is real revenue, and
 * hiding it would be worse than flagging it.
 */
export async function generateAndSaveSfBillingRun(
  params: SfGenerateRunParams,
): Promise<{ runId: string; lines: number; total: number }> {
  const client = await prisma.client.findUniqueOrThrow({
    where: { id: params.clientId },
    select: { id: true, name: true, qboCustomer: { select: { taxStatus: true } } },
  });

  const [timeEntries, agreements, blocks, projects, codeMaps, kindMaps] = await Promise.all([
    loadTimeEntries(params.clientId, params.periodStart, params.periodEnd),
    loadAgreements(params.clientId),
    loadBlocks(params.clientId),
    loadProjects(params.clientId),
    prisma.sfChargeCodeItemMap.findMany(),
    prisma.sfBillingKindItemMap.findMany(),
  ]);

  const result = generateSfBillingLines({
    clientName: client.name,
    periodStart: params.periodStart,
    periodEnd: params.periodEnd,
    timeEntries,
    agreements,
    blocks,
    projects,
    groupBy: params.groupBy,
  });

  const itemByCode = new Map<string, string | null>(
    codeMaps.map((m) => [m.chargeCodeId, m.qboItemId]),
  );
  const itemByKind = new Map<string, string | null>(
    kindMaps.map((m) => [m.kind as string, m.qboItemId]),
  );
  const itemFor = (line: (typeof result.lines)[number]): string | null =>
    (line.chargeCodeId ? itemByCode.get(line.chargeCodeId) : null) ??
    itemByKind.get(line.kind) ??
    null;

  const total = sumSfLineTotals(result.lines);
  const taxStatus = client.qboCustomer?.taxStatus ?? null;

  const run = await prisma.$transaction(async (tx) => {
    const created = await tx.sfBillingRun.create({
      data: {
        clientId: params.clientId,
        periodStart: params.periodStart,
        periodEnd: params.periodEnd,
        invoiceDate: params.invoiceDate,
        createdById: params.actor.id,
        createdByEmail: params.actor.email,
        notes:
          result.notes.length > 0
            ? result.notes.map((n) => `[${n.severity}] ${n.message}`).join("\n")
            : null,
      },
    });

    for (const line of result.lines) {
      await tx.sfBillingLine.create({
        data: {
          runId: created.id,
          kind: line.kind,
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discount: line.discount,
          adjustment: line.adjustment,
          subtotal: line.subtotal,
          total: line.total,
          estimatedCost: line.estimatedCost,
          taxStatus,
          agreementId: line.agreementId,
          projectId: line.projectId,
          blockId: line.blockId,
          chargeCodeId: line.chargeCodeId,
          hoursVisible: line.hoursVisible,
          qboItemId: itemFor(line),
          // The join rows are what prove no hour is billed twice.
          timeEntries: {
            create: line.timeEntries.map((t) => ({
              timeEntryId: t.id,
              hours: t.hours,
            })),
          },
        },
      });
    }
    return created;
  });

  await audit({
    action: "BILLING_RUN_CREATED",
    actorId: params.actor.id,
    actorEmail: params.actor.email,
    target: `sfBillingRun:${run.id}`,
    metadata: {
      source: "silverfang",
      clientId: params.clientId,
      lines: result.lines.length,
      covered: result.covered.length,
      total,
    },
  });

  return { runId: run.id, lines: result.lines.length, total };
}

/** Move a run through its state machine. Illegal transitions throw. */
export async function transitionSfBillingRun(
  runId: string,
  to: SfBillingRunStatus,
  actor: { id: string; email: string },
): Promise<void> {
  const run = await prisma.sfBillingRun.findUniqueOrThrow({
    where: { id: runId },
    select: { id: true, status: true },
  });
  assertTransition(run.status, to);

  await prisma.sfBillingRun.update({
    where: { id: runId },
    data: {
      status: to,
      ...(to === "APPROVED" ? { approvedById: actor.id, approvedAt: new Date() } : {}),
    },
  });
  await audit({
    action: to === "APPROVED" ? "BILLING_RUN_APPROVED" : "BILLING_RUN_CREATED",
    actorId: actor.id,
    actorEmail: actor.email,
    target: `sfBillingRun:${runId}`,
    metadata: { source: "silverfang", from: run.status, to },
  });
}
