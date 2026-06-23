import "server-only";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { proposeMatches, type Candidate } from "@/lib/matching/similarity";
import { normalizeName } from "@/lib/reconciliation/discrepancies";

/**
 * Materialize a Wolf365 Client for every synced source customer, so all
 * customers are visible/billable — not just exact auto-matches.
 *
 * Deterministic: each TD SYNNEX customer becomes a Client (they carry the
 * subscriptions); each QBO customer links to the TD-derived Client with the
 * same normalized name (enabling the side-by-side view + invoice push), or
 * becomes its own Client when there's no name match. Respects the 1:1
 * client↔source constraints.
 */
export async function materializeClients(actor: {
  id: string;
  email: string;
}): Promise<{ created: number; merged: number; clients: number }> {
  const [tds, qbos] = await Promise.all([
    prisma.tdSynnexCustomer.findMany({ where: { clientId: null } }),
    prisma.qboCustomer.findMany({ where: { clientId: null } }),
  ]);

  let created = 0;
  let merged = 0;
  const tdClientByNorm = new Map<string, string>();

  // 1) One Client per TD SYNNEX customer (first occurrence of a name owns it).
  for (const td of tds) {
    const client = await prisma.client.create({ data: { name: td.name } });
    await prisma.tdSynnexCustomer.update({
      where: { id: td.id },
      data: { clientId: client.id },
    });
    created += 1;
    const norm = normalizeName(td.name);
    if (norm && !tdClientByNorm.has(norm)) tdClientByNorm.set(norm, client.id);
  }

  // 2) Link each QBO customer to the matching TD-derived Client, else create one.
  const usedClient = new Set<string>();
  for (const qbo of qbos) {
    const name = qbo.companyName ?? qbo.displayName;
    const norm = normalizeName(name);
    const match = norm ? tdClientByNorm.get(norm) : undefined;
    if (match && !usedClient.has(match)) {
      await prisma.qboCustomer.update({
        where: { id: qbo.id },
        data: { clientId: match },
      });
      usedClient.add(match);
      merged += 1;
    } else {
      const client = await prisma.client.create({ data: { name } });
      await prisma.qboCustomer.update({
        where: { id: qbo.id },
        data: { clientId: client.id },
      });
      created += 1;
    }
  }

  const clients = await prisma.client.count();
  await audit({
    action: "MAPPING_CHANGED",
    actorId: actor.id,
    actorEmail: actor.email,
    target: "clients:materialize",
    metadata: { created, merged, total: clients },
  });
  return { created, merged, clients };
}

/**
 * AI-assisted mapping service.
 *
 * Strategy: deterministic exact-name matches auto-confirm; everything else is
 * proposed with a transparent confidence score for human approval. Nothing is
 * linked without either an exact match or explicit confirmation.
 */

function emailDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const d = email.split("@")[1]?.toLowerCase();
  return d ?? null;
}

/** Scan unlinked QBO + TD SYNNEX customers and (re)build client proposals. */
export async function proposeClientMatches(actor: {
  id: string;
  email: string;
}): Promise<{ proposed: number; autoConfirmed: number }> {
  const [qbo, td] = await Promise.all([
    prisma.qboCustomer.findMany({ where: { clientId: null } }),
    prisma.tdSynnexCustomer.findMany({ where: { clientId: null } }),
  ]);

  const sources: Candidate[] = qbo.map((c) => ({
    id: c.id,
    name: c.companyName ?? c.displayName,
    domain: emailDomain(c.billingEmail),
  }));
  const targets: Candidate[] = td.map((c) => ({
    id: c.id,
    name: c.name,
    domain: c.domain,
  }));

  const proposals = proposeMatches(sources, targets);
  let proposed = 0;
  let autoConfirmed = 0;

  for (const p of proposals) {
    if (p.exact) {
      await linkClient(p.sourceId, p.targetId, p.confidence, "DETERMINISTIC", actor);
      autoConfirmed += 1;
    } else {
      await prisma.clientMatchProposal.upsert({
        where: {
          qboCustomerId_tdSynnexCustomerId: {
            qboCustomerId: p.sourceId,
            tdSynnexCustomerId: p.targetId,
          },
        },
        create: {
          qboCustomerId: p.sourceId,
          tdSynnexCustomerId: p.targetId,
          confidence: p.confidence,
          method: "AI_ASSISTED",
          status: "PROPOSED",
        },
        update: { confidence: p.confidence, status: "PROPOSED" },
      });
      proposed += 1;
    }
  }

  await audit({
    action: "MAPPING_CHANGED",
    actorId: actor.id,
    actorEmail: actor.email,
    target: "clientMatch:auto",
    metadata: { proposed, autoConfirmed },
  });
  return { proposed, autoConfirmed };
}

/** Create a Wolf365 Client linking a QBO + TD SYNNEX customer. */
async function linkClient(
  qboCustomerId: string,
  tdSynnexCustomerId: string,
  confidence: number,
  method: "DETERMINISTIC" | "AI_ASSISTED" | "MANUAL",
  actor: { id: string; email: string },
): Promise<string> {
  const [qbo, td] = await Promise.all([
    prisma.qboCustomer.findUniqueOrThrow({ where: { id: qboCustomerId } }),
    prisma.tdSynnexCustomer.findUniqueOrThrow({ where: { id: tdSynnexCustomerId } }),
  ]);
  const name = qbo.companyName ?? qbo.displayName ?? td.name;

  const clientId = await prisma.$transaction(async (tx) => {
    const client = await tx.client.create({ data: { name } });
    await tx.qboCustomer.update({
      where: { id: qboCustomerId },
      data: { clientId: client.id },
    });
    await tx.tdSynnexCustomer.update({
      where: { id: tdSynnexCustomerId },
      data: { clientId: client.id },
    });
    await tx.clientMatchProposal.upsert({
      where: {
        qboCustomerId_tdSynnexCustomerId: { qboCustomerId, tdSynnexCustomerId },
      },
      create: {
        qboCustomerId,
        tdSynnexCustomerId,
        confidence,
        method,
        status: "CONFIRMED",
        reviewedById: actor.id,
        reviewedAt: new Date(),
      },
      update: {
        status: "CONFIRMED",
        reviewedById: actor.id,
        reviewedAt: new Date(),
      },
    });
    return client.id;
  });
  return clientId;
}

export async function confirmClientMatch(
  proposalId: string,
  actor: { id: string; email: string },
): Promise<void> {
  const p = await prisma.clientMatchProposal.findUniqueOrThrow({
    where: { id: proposalId },
  });
  await linkClient(
    p.qboCustomerId,
    p.tdSynnexCustomerId,
    p.confidence,
    "MANUAL",
    actor,
  );
  await audit({
    action: "MAPPING_CHANGED",
    actorId: actor.id,
    actorEmail: actor.email,
    target: `clientMatch:${proposalId}`,
    metadata: { decision: "confirmed" },
  });
}

export async function rejectClientMatch(
  proposalId: string,
  actor: { id: string; email: string },
): Promise<void> {
  await prisma.clientMatchProposal.update({
    where: { id: proposalId },
    data: { status: "REJECTED", reviewedById: actor.id, reviewedAt: new Date() },
  });
  await audit({
    action: "MAPPING_CHANGED",
    actorId: actor.id,
    actorEmail: actor.email,
    target: `clientMatch:${proposalId}`,
    metadata: { decision: "rejected" },
  });
}

/** Propose SKU -> QBO item mappings from synced subscriptions and items. */
export async function proposeSkuMatches(actor: {
  id: string;
  email: string;
}): Promise<{ proposed: number; autoConfirmed: number }> {
  const subs = await prisma.tdSynnexSubscription.findMany({
    where: { productSku: { not: null } },
    select: { productSku: true, productName: true },
    distinct: ["productSku"],
  });
  const items = await prisma.qboItem.findMany({ where: { active: true } });

  const sources: Candidate[] = subs
    .filter((s) => s.productSku)
    .map((s) => ({ id: s.productSku!, name: s.productName ?? s.productSku! }));
  const targets: Candidate[] = items.map((i) => ({
    id: i.qboId,
    name: i.fullyQualifiedName ?? i.name,
  }));

  const proposals = proposeMatches(sources, targets, 0.4);
  const itemById = new Map(items.map((i) => [i.qboId, i]));
  let proposed = 0;
  let autoConfirmed = 0;

  for (const p of proposals) {
    const item = itemById.get(p.targetId);
    await prisma.productMapping.upsert({
      where: { tdSynnexSku: p.sourceId },
      create: {
        tdSynnexSku: p.sourceId,
        qboItemId: p.targetId,
        qboItemName: item?.name ?? null,
        confidence: p.confidence,
        method: p.exact ? "DETERMINISTIC" : "AI_ASSISTED",
        status: p.exact ? "CONFIRMED" : "PROPOSED",
        reviewedById: p.exact ? actor.id : null,
        reviewedAt: p.exact ? new Date() : null,
      },
      update: {
        qboItemId: p.targetId,
        qboItemName: item?.name ?? null,
        confidence: p.confidence,
        method: p.exact ? "DETERMINISTIC" : "AI_ASSISTED",
        ...(p.exact ? { status: "CONFIRMED" } : {}),
      },
    });
    if (p.exact) autoConfirmed += 1;
    else proposed += 1;
  }

  await audit({
    action: "MAPPING_CHANGED",
    actorId: actor.id,
    actorEmail: actor.email,
    target: "skuMatch:auto",
    metadata: { proposed, autoConfirmed },
  });
  return { proposed, autoConfirmed };
}

export async function setProductMappingStatus(
  sku: string,
  status: "CONFIRMED" | "REJECTED",
  actor: { id: string; email: string },
): Promise<void> {
  await prisma.productMapping.update({
    where: { tdSynnexSku: sku },
    data: { status, reviewedById: actor.id, reviewedAt: new Date() },
  });
  await audit({
    action: "MAPPING_CHANGED",
    actorId: actor.id,
    actorEmail: actor.email,
    target: `skuMatch:${sku}`,
    metadata: { decision: status },
  });
}
