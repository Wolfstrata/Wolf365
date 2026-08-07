import "server-only";
import { prisma } from "@/lib/db";
import { addMonths } from "@/lib/silverfang/renewal";
import {
  classifyManaged,
  defaultManagedAgreement,
  describeVerdict,
  startOfUtcDay,
  type ManagedKind,
  type ManagedVerdict,
} from "@/lib/silverfang/managed";

/**
 * Tagging SuperOps managed-services customers in SilverFang by giving each one a
 * placeholder managed agreement.
 *
 * Two entry points on purpose: `previewManagedAgreements` shows exactly what
 * would happen — including which clients matched on what text and which were
 * skipped — and `createManagedAgreements` does it. Nothing about the matching is
 * certain enough to run blind on 156 clients, so the preview is the default and
 * the write is a second, deliberate step.
 *
 * Idempotent. A client that already has a managed-type agreement is skipped
 * regardless of that agreement's status, so re-running never stacks duplicates
 * and never resurrects a term someone cancelled by hand.
 */

const MANAGED_TYPES: ManagedKind[] = ["MANAGED_SERVICES", "MANAGED_NOC"];

/** Term length for the placeholder agreements the user asked for. */
export const DEFAULT_TERM_MONTHS = 12;

export interface ManagedCandidate {
  clientId: string;
  clientName: string;
  superOpsName: string;
  stage: string | null;
  status: string | null;
  verdict: ManagedVerdict;
  /** Why this client won't be written: null means it will be. */
  skipReason: string | null;
  /** The agreement already on file, when that's the reason for skipping. */
  existingAgreement: { id: string; name: string; status: string } | null;
}

export interface ManagedPreview {
  /** Clients that would get a new agreement. */
  toCreate: ManagedCandidate[];
  /** Matched, but already tagged. */
  alreadyTagged: ManagedCandidate[];
  /** Matched, but not usable — no linked client, archived, etc. */
  blocked: ManagedCandidate[];
  /** Every SuperOps client the classifier declined, with the label it saw. */
  unmatched: ManagedCandidate[];
  /** Total SuperOps clients considered. */
  considered: number;
}

interface LoadedClient {
  clientId: string | null;
  clientName: string | null;
  clientArchived: boolean;
  superOpsName: string;
  stage: string | null;
  status: string | null;
  contracts: { name: string | null; status: string | null }[];
}

async function loadSuperOpsClients(): Promise<LoadedClient[]> {
  const rows = await prisma.superOpsClient.findMany({
    select: {
      name: true,
      stage: true,
      status: true,
      clientId: true,
      client: { select: { name: true, archived: true } },
      contracts: { select: { name: true, status: true } },
    },
    orderBy: { name: "asc" },
  });
  return rows.map((r) => ({
    clientId: r.clientId,
    clientName: r.client?.name ?? null,
    clientArchived: r.client?.archived ?? false,
    superOpsName: r.name,
    stage: r.stage,
    status: r.status,
    contracts: r.contracts,
  }));
}

/**
 * What `createManagedAgreements` would do, without doing it.
 *
 * Every SuperOps client appears in exactly one bucket, so the preview accounts
 * for all of them — a client quietly missing from all four lists would be the
 * one failure mode nobody notices.
 */
export async function previewManagedAgreements(): Promise<ManagedPreview> {
  const clients = await loadSuperOpsClients();

  // One query for the existing managed agreements rather than one per client.
  const existing = await prisma.sfAgreement.findMany({
    where: { type: { in: MANAGED_TYPES } },
    select: { id: true, name: true, status: true, clientId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const byClient = new Map<string, { id: string; name: string; status: string }>();
  for (const a of existing) {
    if (!byClient.has(a.clientId)) {
      byClient.set(a.clientId, { id: a.id, name: a.name, status: a.status });
    }
  }

  const preview: ManagedPreview = {
    toCreate: [],
    alreadyTagged: [],
    blocked: [],
    unmatched: [],
    considered: clients.length,
  };

  for (const c of clients) {
    const verdict = classifyManaged({
      stage: c.stage,
      status: c.status,
      contracts: c.contracts,
    });
    const base = {
      clientId: c.clientId ?? "",
      clientName: c.clientName ?? c.superOpsName,
      superOpsName: c.superOpsName,
      stage: c.stage,
      status: c.status,
      verdict,
    };

    if (!verdict.kind) {
      preview.unmatched.push({ ...base, skipReason: describeVerdict(verdict), existingAgreement: null });
      continue;
    }
    if (!c.clientId) {
      preview.blocked.push({
        ...base,
        skipReason: "Not linked to a Wolf365 client — run Import from SuperOps first",
        existingAgreement: null,
      });
      continue;
    }
    if (c.clientArchived) {
      preview.blocked.push({
        ...base,
        skipReason: "The Wolf365 client is archived",
        existingAgreement: null,
      });
      continue;
    }
    const already = byClient.get(c.clientId);
    if (already) {
      preview.alreadyTagged.push({ ...base, skipReason: "Already has a managed agreement", existingAgreement: already });
      continue;
    }
    preview.toCreate.push({ ...base, skipReason: null, existingAgreement: null });
  }

  return preview;
}

export interface ManagedCreateResult {
  created: number;
  alreadyTagged: number;
  blocked: number;
  unmatched: number;
  considered: number;
  /** The agreements written, for the result message and the audit metadata. */
  agreements: { clientName: string; name: string; type: ManagedKind; reason: string }[];
}

/**
 * Create the placeholder agreements.
 *
 * Deliberately re-derives the preview rather than accepting a client-supplied
 * list: a stale or tampered list from the browser must not be able to decide
 * which clients get agreements.
 */
export async function createManagedAgreements(
  actor: { id: string | null; email: string },
  now: Date = new Date(),
): Promise<ManagedCreateResult> {
  const preview = await previewManagedAgreements();
  const startDate = startOfUtcDay(now);
  const endDate = addMonths(startDate, DEFAULT_TERM_MONTHS);

  const result: ManagedCreateResult = {
    created: 0,
    alreadyTagged: preview.alreadyTagged.length,
    blocked: preview.blocked.length,
    unmatched: preview.unmatched.length,
    considered: preview.considered,
    agreements: [],
  };

  for (const candidate of preview.toCreate) {
    const reason = describeVerdict(candidate.verdict);
    const draft = defaultManagedAgreement({
      clientName: candidate.clientName,
      kind: candidate.verdict.kind!,
      startDate,
      endDate,
      reason,
    });
    await prisma.sfAgreement.create({
      data: {
        clientId: candidate.clientId,
        name: draft.name,
        type: draft.type,
        status: draft.status,
        startDate: draft.startDate,
        endDate: draft.endDate,
        autoRenew: draft.autoRenew,
        billingFrequency: draft.billingFrequency,
        notes: draft.notes,
        createdById: actor.id,
        createdByEmail: actor.email,
      },
    });
    result.created += 1;
    result.agreements.push({
      clientName: candidate.clientName,
      name: draft.name,
      type: draft.type,
      reason,
    });
  }

  return result;
}

/** One-line summary for the action result, with the skips said out loud. */
export function describeManagedRun(r: ManagedCreateResult): string {
  if (r.created === 0 && r.alreadyTagged === 0 && r.blocked === 0) {
    return (
      `No managed-services customers found among ${r.considered} SuperOps client(s). ` +
      `SilverFang looks at the SuperOps client stage, status and contract names for the ` +
      `word "managed" — if your accounts label it differently, tag them by hand.`
    );
  }
  const parts = [`${r.created} draft agreement${r.created === 1 ? "" : "s"} created`];
  if (r.alreadyTagged > 0) parts.push(`${r.alreadyTagged} already tagged`);
  if (r.blocked > 0) parts.push(`${r.blocked} skipped (not linked or archived)`);
  parts.push(`${r.unmatched} not managed`);
  return `${parts.join(", ")}, out of ${r.considered} SuperOps client(s). New agreements are DRAFT with no amounts — edit each one and set it Active.`;
}
