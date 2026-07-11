import "server-only";
import { randomUUID } from "node:crypto";
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
  // Customers with a pending match proposal are left unlinked so they remain
  // reviewable; everything else gets a materialized client.
  const pending = await prisma.clientMatchProposal.findMany({
    where: { status: "PROPOSED" },
    select: { qboCustomerId: true, tdSynnexCustomerId: true },
  });
  const skipQbo = new Set(pending.map((p) => p.qboCustomerId));
  const skipTd = new Set(pending.map((p) => p.tdSynnexCustomerId));

  const [tdsAll, qbosAll] = await Promise.all([
    prisma.tdSynnexCustomer.findMany({ where: { clientId: null } }),
    prisma.qboCustomer.findMany({ where: { clientId: null } }),
  ]);
  const tds = tdsAll.filter((c) => !skipTd.has(c.id));
  const qbos = qbosAll.filter((c) => !skipQbo.has(c.id));

  let created = 0;
  let merged = 0;
  const tdClientByNorm = new Map<string, string>();
  // Collected (source → clientId) links, applied in batched transactions at the
  // end. We pre-generate client ids so creates and links can be batched without
  // depending on per-row return values (hundreds of sequential round-trips here
  // previously caused the action to time out).
  const tdLinks: { id: string; clientId: string }[] = [];
  const qboLinks: { id: string; clientId: string }[] = [];
  const newClients: { id: string; name: string }[] = [];

  // 1) One Client per TD SYNNEX customer (first occurrence of a name owns it).
  for (const td of tds) {
    const clientId = randomUUID();
    newClients.push({ id: clientId, name: td.name });
    tdLinks.push({ id: td.id, clientId });
    created += 1;
    const norm = normalizeName(td.name);
    if (norm && !tdClientByNorm.has(norm)) tdClientByNorm.set(norm, clientId);
  }

  // 2) Link each QBO customer to the matching TD-derived Client, else create one.
  const usedClient = new Set<string>();
  for (const qbo of qbos) {
    const name = qbo.companyName ?? qbo.displayName;
    const norm = normalizeName(name);
    const match = norm ? tdClientByNorm.get(norm) : undefined;
    if (match && !usedClient.has(match)) {
      qboLinks.push({ id: qbo.id, clientId: match });
      usedClient.add(match);
      merged += 1;
    } else {
      const clientId = randomUUID();
      newClients.push({ id: clientId, name });
      qboLinks.push({ id: qbo.id, clientId });
      created += 1;
    }
  }

  // Apply in a few batched round-trips instead of two per customer.
  if (newClients.length) {
    await prisma.client.createMany({ data: newClients });
  }
  if (tdLinks.length) {
    await prisma.$transaction(
      tdLinks.map((l) =>
        prisma.tdSynnexCustomer.update({
          where: { id: l.id },
          data: { clientId: l.clientId },
        }),
      ),
    );
  }
  if (qboLinks.length) {
    await prisma.$transaction(
      qboLinks.map((l) =>
        prisma.qboCustomer.update({
          where: { id: l.id },
          data: { clientId: l.clientId },
        }),
      ),
    );
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

/** A value that looks like a bare domain (e.g. "acme.com"), not a company name. */
function looksLikeDomain(s: string | null | undefined): boolean {
  return !!s && !s.includes(" ") && /\.[a-z]{2,}$/i.test(s.trim());
}

/** Registrable label of a domain, for name comparison ("buhlerindustries.com"
 *  → "buhlerindustries", "mail.acme.co.uk" → "acme"). */
function domainToName(domain: string): string {
  const parts = domain.toLowerCase().split(".").filter(Boolean);
  if (parts.length < 2) return domain;
  let idx = parts.length - 2;
  if (parts.length >= 3 && ["co", "com", "org", "net", "gov", "ac", "edu"].includes(parts[idx] ?? "")) {
    idx = parts.length - 3;
  }
  return parts[idx] ?? domain;
}

/**
 * (Re)build client-match proposals between QuickBooks and TD SYNNEX customers
 * that are not yet cross-linked — a customer qualifies when it has no client
 * yet, OR its client is missing the other system's side (e.g. a QBO-only client
 * and a TD-only client that look like the same company). Exact name matches are
 * merged automatically; fuzzy matches are proposed for human review.
 */
export async function proposeClientMatches(actor: {
  id: string;
  email: string;
}): Promise<{ proposed: number; autoConfirmed: number }> {
  const [qboAll, tdAll] = await Promise.all([
    prisma.qboCustomer.findMany({
      include: { client: { select: { tdSynnexCustomer: { select: { id: true } } } } },
    }),
    prisma.tdSynnexCustomer.findMany({
      include: { client: { select: { qboCustomer: { select: { id: true } } } } },
    }),
  ]);
  // Candidates: no client yet, or a client that lacks the other system's side.
  const qbo = qboAll.filter((c) => !c.client || !c.client.tdSynnexCustomer);
  const td = tdAll.filter((c) => !c.client || !c.client.qboCustomer);

  // TD SYNNEX customer names are often domains (e.g. "buhlerindustries.com").
  // Derive a comparable company-ish name from the domain so it lines up with
  // QuickBooks company names, and keep the full domain as a matching signal.
  const sources: Candidate[] = qbo.map((c) => {
    const raw = c.companyName ?? c.displayName;
    return {
      id: c.id,
      name: looksLikeDomain(raw) ? domainToName(raw) : raw,
      domain: emailDomain(c.billingEmail) ?? (looksLikeDomain(raw) ? raw : null),
    };
  });
  const targets: Candidate[] = td.map((c) => ({
    id: c.id,
    name: looksLikeDomain(c.name) ? domainToName(c.name) : c.name,
    domain: c.domain ?? (looksLikeDomain(c.name) ? c.name : null),
  }));

  const proposals = proposeMatches(sources, targets);
  let proposed = 0;
  let autoConfirmed = 0;

  for (const p of proposals) {
    if (p.exact) {
      await mergeOrLink(p.sourceId, p.targetId, p.confidence, "DETERMINISTIC", actor);
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

/**
 * Link a QBO + TD SYNNEX customer onto a single Wolf365 Client, handling every
 * starting state: create a new client when neither is linked, attach to the
 * existing client when one side is, and MERGE when both already have separate
 * clients (the TD-side client's data moves to the QBO-side client, then the
 * emptied client is deleted). Marks the proposal CONFIRMED.
 */
async function mergeOrLink(
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
    let targetClientId: string;

    if (qbo.clientId && td.clientId && qbo.clientId !== td.clientId) {
      // Both already have separate clients → keep the QBO client, fold the TD
      // client into it, then delete the now-empty TD client.
      targetClientId = qbo.clientId;
      const fromId = td.clientId;
      await tx.tdSynnexCustomer.update({
        where: { id: td.id },
        data: { clientId: targetClientId },
      });
      // Move any business data off the client being removed.
      await tx.billingRun.updateMany({ where: { clientId: fromId }, data: { clientId: targetClientId } });
      await tx.exception.updateMany({ where: { clientId: fromId }, data: { clientId: targetClientId } });
      await tx.crmOpportunity.updateMany({ where: { clientId: fromId }, data: { clientId: targetClientId } });
      await tx.superOpsInvoice.updateMany({ where: { clientId: fromId }, data: { clientId: targetClientId } });
      // Any Hudu/SuperOps 1:1 links on the removed client are released (SetNull)
      // and can be re-materialized; we don't force-move them to avoid unique
      // conflicts when the target already has one.
      await tx.client.delete({ where: { id: fromId } });
    } else if (qbo.clientId) {
      targetClientId = qbo.clientId;
      if (td.clientId !== targetClientId) {
        await tx.tdSynnexCustomer.update({ where: { id: td.id }, data: { clientId: targetClientId } });
      }
    } else if (td.clientId) {
      targetClientId = td.clientId;
      await tx.qboCustomer.update({ where: { id: qbo.id }, data: { clientId: targetClientId } });
    } else {
      const client = await tx.client.create({ data: { name } });
      targetClientId = client.id;
      await tx.qboCustomer.update({ where: { id: qbo.id }, data: { clientId: targetClientId } });
      await tx.tdSynnexCustomer.update({ where: { id: td.id }, data: { clientId: targetClientId } });
    }

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
    return targetClientId;
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
  await mergeOrLink(
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

/**
 * Resolve UNMAPPED_SKU exceptions for SKUs that now have a usable QBO-item
 * mapping (non-rejected, with an item). Once a SKU is mapped it no longer
 * belongs in the exception queue. Idempotent — safe to call after any mapping
 * change. Returns the number of exceptions resolved.
 */
export async function resolveMappedSkuExceptions(): Promise<number> {
  return prisma.$executeRaw`
    UPDATE "Exception"
    SET "status" = 'RESOLVED', "resolvedAt" = now()
    WHERE "type" = 'UNMAPPED_SKU'
      AND "status" <> 'RESOLVED'
      AND ("details"->>'sku') IN (
        SELECT "tdSynnexSku" FROM "ProductMapping"
        WHERE "qboItemId" IS NOT NULL AND "status" <> 'REJECTED'
      )
  `;
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

  await resolveMappedSkuExceptions();

  await audit({
    action: "MAPPING_CHANGED",
    actorId: actor.id,
    actorEmail: actor.email,
    target: "skuMatch:auto",
    metadata: { proposed, autoConfirmed },
  });
  return { proposed, autoConfirmed };
}

/** Manually map a SKU to a specific QuickBooks item and confirm it. */
export async function setProductMappingItem(
  sku: string,
  qboItemId: string,
  actor: { id: string; email: string },
): Promise<void> {
  const item = await prisma.qboItem.findUnique({
    where: { qboId: qboItemId },
    select: { name: true },
  });
  await prisma.productMapping.upsert({
    where: { tdSynnexSku: sku },
    create: {
      tdSynnexSku: sku,
      qboItemId,
      qboItemName: item?.name ?? null,
      confidence: 1,
      method: "MANUAL",
      status: "CONFIRMED",
      reviewedById: actor.id,
      reviewedAt: new Date(),
    },
    update: {
      qboItemId,
      qboItemName: item?.name ?? null,
      method: "MANUAL",
      status: "CONFIRMED",
      reviewedById: actor.id,
      reviewedAt: new Date(),
    },
  });
  await resolveMappedSkuExceptions();
  await audit({
    action: "MAPPING_CHANGED",
    actorId: actor.id,
    actorEmail: actor.email,
    target: `skuMatch:${sku}`,
    metadata: { decision: "manual-map", qboItemId },
  });
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
  // Mapping confirmed → clear its exception; rejected → leave it (still unmapped).
  if (status === "CONFIRMED") await resolveMappedSkuExceptions();
  await audit({
    action: "MAPPING_CHANGED",
    actorId: actor.id,
    actorEmail: actor.email,
    target: `skuMatch:${sku}`,
    metadata: { decision: status },
  });
}
