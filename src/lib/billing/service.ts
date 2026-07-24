import "server-only";
import type { BillingRunStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { assertTransition } from "@/lib/billing/state";
import {
  generateBillingLines,
  type ProductMappingInput,
  type SubscriptionInput,
} from "@/lib/billing/generate";
import type { SeatAddition } from "@/lib/billing/changelog";
import type { PriceRuleLike } from "@/lib/billing/pricing";
import { isM365Subscription } from "@/lib/licensing/vendor";

/**
 * Server-only billing service: turns synced subscription data into a saved,
 * reviewable billing run, and governs run state transitions. Uses the same
 * pure generator the preview uses, so the persisted run matches the review.
 */
export interface GenerateRunParams {
  clientId: string;
  periodStart: Date;
  periodEnd: Date;
  invoiceDate: Date;
  actor: { id: string; email: string };
}

export async function generateAndSaveBillingRun(
  params: GenerateRunParams,
): Promise<string> {
  const client = await prisma.client.findUniqueOrThrow({
    where: { id: params.clientId },
    include: {
      tdSynnexCustomer: { include: { subscriptions: true } },
      qboCustomer: true,
    },
  });

  // Bill Microsoft 365 licensing only — TD SYNNEX also resells other vendors
  // (e.g. Cisco), which never belong on an M365 invoice.
  const subs = (client.tdSynnexCustomer?.subscriptions ?? []).filter(isM365Subscription);

  // Load mid-period seat additions from the change log so they can be split onto
  // their own pro-rated line (they fold into the subscription's total quantity
  // without changing its start date, so this is the only source of the add date).
  const additionsBySub = new Map<string, SeatAddition[]>();
  if (subs.length > 0) {
    const logs = await prisma.tdSynnexSubscriptionChangeLog.findMany({
      where: {
        subscriptionId: { in: subs.map((s) => s.id) },
        seatsDelta: { gt: 0 },
        entryDatetime: { gte: params.periodStart, lt: params.periodEnd },
      },
      orderBy: { entryDatetime: "asc" },
    });
    for (const l of logs) {
      const list = additionsBySub.get(l.subscriptionId) ?? [];
      list.push({ date: l.entryDatetime, seats: l.seatsDelta, note: l.changeLog ?? "" });
      additionsBySub.set(l.subscriptionId, list);
    }
  }

  const subscriptions: SubscriptionInput[] = subs.map((s) => ({
    id: s.id,
    sku: s.productSku,
    productName: s.productName,
    quantity: s.quantity,
    unitCost: s.unitCost != null ? Number(s.unitCost) : null,
    customerPrice: s.customerPrice != null ? Number(s.customerPrice) : null,
    currency: s.currency,
    activeStart: s.startDate,
    activeEnd: s.cancellationWindowEnds,
    monthlyAdditions: additionsBySub.get(s.id) ?? [],
  }));

  // Build SKU -> QBO item mapping from confirmed product mappings.
  const skus = Array.from(
    new Set(subscriptions.map((s) => s.sku).filter((s): s is string => !!s)),
  );
  const productMappings = await prisma.productMapping.findMany({
    where: { tdSynnexSku: { in: skus }, status: { not: "REJECTED" } },
  });
  const mappings: ProductMappingInput = {};
  for (const m of productMappings) {
    mappings[m.tdSynnexSku] = {
      qboItemId: m.qboItemId,
      qboItemName: m.qboItemName,
    };
  }

  const rules = await prisma.priceRule.findMany({ where: { active: true } });
  const priceRules: PriceRuleLike[] = rules.map((r) => ({
    scope: r.scope,
    clientId: r.clientId,
    sku: r.sku,
    markupPct: r.markupPct != null ? Number(r.markupPct) : null,
    fixedUnitPrice: r.fixedUnitPrice != null ? Number(r.fixedUnitPrice) : null,
    active: r.active,
  }));

  const { lines, exceptions } = generateBillingLines({
    clientId: params.clientId,
    period: { start: params.periodStart, end: params.periodEnd },
    subscriptions,
    mappings,
    priceRules,
  });

  const run = await prisma.$transaction(async (tx) => {
    const created = await tx.billingRun.create({
      data: {
        status: "DRAFT",
        periodStart: params.periodStart,
        periodEnd: params.periodEnd,
        invoiceDate: params.invoiceDate,
        clientId: params.clientId,
        createdById: params.actor.id,
        lines: {
          create: lines.map((l) => ({
            tdSynnexSubscriptionId: l.tdSynnexSubscriptionId,
            qboItemId: l.qboItemId,
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            prorationFactor: l.prorationFactor,
            proratedDays: l.proratedDays,
            periodDays: l.periodDays,
            discount: l.discount,
            adjustment: l.adjustment,
            estimatedCost: l.estimatedCost,
            taxStatus: client.qboCustomer?.taxStatus ?? null,
            subtotal: l.subtotal,
            total: l.total,
          })),
        },
      },
    });

    // Persist generation exceptions to the reconciliation queue.
    if (exceptions.length > 0) {
      await tx.exception.createMany({
        data: exceptions.map((e) => ({
          type: e.type,
          severity: e.type === "MISSING_PRICE" ? "error" : "warning",
          clientId: params.clientId,
          message: e.message,
          details: { sku: e.sku ?? null, subscriptionId: e.subscriptionId ?? null },
        })),
      });
    }

    return created;
  });

  await audit({
    action: "BILLING_RUN_CREATED",
    actorId: params.actor.id,
    actorEmail: params.actor.email,
    target: `billingRun:${run.id}`,
    metadata: {
      clientId: params.clientId,
      lines: lines.length,
      exceptions: exceptions.length,
    },
  });

  return run.id;
}

/** Move a run between states, enforcing the legal lifecycle + auditing. */
export async function transitionBillingRun(
  runId: string,
  to: BillingRunStatus,
  actor: { id: string; email: string },
): Promise<void> {
  const run = await prisma.billingRun.findUniqueOrThrow({ where: { id: runId } });
  assertTransition(run.status, to);

  await prisma.billingRun.update({
    where: { id: runId },
    data: {
      status: to,
      ...(to === "APPROVED"
        ? { approvedById: actor.id, approvedAt: new Date() }
        : {}),
    },
  });

  await audit({
    action: to === "APPROVED" ? "BILLING_RUN_APPROVED" : "BILLING_RUN_CREATED",
    actorId: actor.id,
    actorEmail: actor.email,
    target: `billingRun:${runId}`,
    metadata: { from: run.status, to },
  });
}
