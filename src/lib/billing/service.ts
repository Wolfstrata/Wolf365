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
import type { PriceRuleLike } from "@/lib/billing/pricing";

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

  const subs = client.tdSynnexCustomer?.subscriptions ?? [];
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
