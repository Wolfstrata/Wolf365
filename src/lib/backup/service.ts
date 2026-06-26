import { prisma } from "@/lib/db";
import { getEnv } from "@/env";
import { audit } from "@/lib/audit";
import { safeErrorMessage } from "@/lib/redact";
import {
  isNeonConfigured,
  createBranch,
  deleteBranch,
  getDefaultBranchId,
  restoreBranch,
  waitForOperations,
} from "@/lib/backup/neon";

export interface BackupActor {
  id: string | null;
  email: string;
}

export interface BackupResult {
  ok: boolean;
  configured: boolean;
  backupId?: string;
  branchName?: string;
  message: string;
}

/** A Neon-safe branch name from an ISO timestamp passed in by the caller. */
function branchNameFor(isoStamp: string): string {
  return `wolf365-backup-${isoStamp.replace(/[:.]/g, "-")}`;
}

/**
 * Create a Neon branch snapshot of the whole database and record it. The caller
 * supplies the timestamp so this stays deterministic/testable. No-ops with a
 * clear result if Neon isn't configured.
 */
export async function runNeonBackup(opts: {
  trigger: "MANUAL" | "CRON";
  actor: BackupActor;
  now: Date;
}): Promise<BackupResult> {
  if (!isNeonConfigured()) {
    return {
      ok: false,
      configured: false,
      message: "Neon backups are not configured (set NEON_API_KEY and NEON_PROJECT_ID).",
    };
  }

  const branchName = branchNameFor(opts.now.toISOString());
  const retentionDays = getEnv().BACKUP_RETENTION_DAYS;
  const expiresAt = new Date(opts.now.getTime() + retentionDays * 86_400_000);

  const record = await prisma.backup.create({
    data: {
      kind: "NEON_BRANCH",
      trigger: opts.trigger,
      status: "PENDING",
      branchName,
      createdById: opts.actor.id,
    },
  });

  try {
    const branch = await createBranch(branchName);
    await prisma.backup.update({
      where: { id: record.id },
      data: {
        status: "SUCCESS",
        neonBranchId: branch.id,
        expiresAt,
        finishedAt: opts.now,
      },
    });
    await audit({
      action: "BACKUP_CREATED",
      actorId: opts.actor.id,
      actorEmail: opts.actor.email,
      target: `backup:${record.id}`,
      metadata: { trigger: opts.trigger, branchName, neonBranchId: branch.id },
    });
    return {
      ok: true,
      configured: true,
      backupId: record.id,
      branchName,
      message: `Backup created (${branchName}).`,
    };
  } catch (err) {
    const message = safeErrorMessage(err);
    await prisma.backup.update({
      where: { id: record.id },
      data: { status: "FAILED", error: message, finishedAt: opts.now },
    });
    await audit({
      action: "BACKUP_CREATED",
      actorId: opts.actor.id,
      actorEmail: opts.actor.email,
      target: `backup:${record.id}`,
      metadata: { trigger: opts.trigger, branchName, status: "FAILED" },
    });
    return { ok: false, configured: true, backupId: record.id, message };
  }
}

/** Delete Neon branches past their retention horizon. Best-effort and idempotent. */
export async function pruneExpiredBackups(now: Date): Promise<{ pruned: number; errors: number }> {
  if (!isNeonConfigured()) return { pruned: 0, errors: 0 };

  const expired = await prisma.backup.findMany({
    where: {
      kind: "NEON_BRANCH",
      status: "SUCCESS",
      neonBranchId: { not: null },
      expiresAt: { lt: now },
    },
    select: { id: true, neonBranchId: true, branchName: true },
  });

  let pruned = 0;
  let errors = 0;
  for (const b of expired) {
    try {
      await deleteBranch(b.neonBranchId!);
      await prisma.backup.update({
        where: { id: b.id },
        data: { status: "PRUNED", neonBranchId: null },
      });
      await audit({
        action: "BACKUP_DELETED",
        actorId: null,
        actorEmail: "cron",
        target: `backup:${b.id}`,
        metadata: { branchName: b.branchName, reason: "expired" },
      });
      pruned += 1;
    } catch {
      errors += 1;
    }
  }
  return { pruned, errors };
}

export interface RestoreResult {
  ok: boolean;
  configured: boolean;
  message: string;
  preserveName?: string;
}

/**
 * Restore the production database from a previously captured Neon snapshot.
 * DESTRUCTIVE: overwrites all current data with the snapshot. A safety branch
 * (the current state) is preserved first so the restore is reversible.
 *
 * The caller must pass `confirmation` equal to the snapshot's branch name; this
 * is re-validated server-side. No DB writes happen after the restore call (the
 * connection resets), so the audit entry is written beforehand and is captured
 * in the preserved safety branch.
 */
export async function restoreFromBackup(opts: {
  backupId: string;
  confirmation: string;
  actor: BackupActor;
  now: Date;
}): Promise<RestoreResult> {
  if (!isNeonConfigured()) {
    return {
      ok: false,
      configured: false,
      message: "Neon backups are not configured (set NEON_API_KEY and NEON_PROJECT_ID).",
    };
  }

  const backup = await prisma.backup.findUnique({ where: { id: opts.backupId } });
  if (
    !backup ||
    backup.kind !== "NEON_BRANCH" ||
    backup.status !== "SUCCESS" ||
    !backup.neonBranchId
  ) {
    return {
      ok: false,
      configured: true,
      message: "This snapshot is not restorable (missing, failed, or already pruned).",
    };
  }

  if (opts.confirmation !== backup.branchName) {
    return {
      ok: false,
      configured: true,
      message: "Confirmation text did not match the snapshot name. Restore cancelled.",
    };
  }

  let targetBranchId: string;
  try {
    targetBranchId = await getDefaultBranchId();
  } catch (err) {
    return { ok: false, configured: true, message: safeErrorMessage(err) };
  }

  if (targetBranchId === backup.neonBranchId) {
    return {
      ok: false,
      configured: true,
      message: "The snapshot branch is the live branch; nothing to restore.",
    };
  }

  const preserveName = `pre-restore-${opts.now.toISOString().replace(/[:.]/g, "-")}`;

  // Written BEFORE the restore so it lands in the preserved safety branch. The
  // restore reverts production data, so this row will not persist in production.
  await audit({
    action: "BACKUP_RESTORED",
    actorId: opts.actor.id,
    actorEmail: opts.actor.email,
    target: `backup:${backup.id}`,
    metadata: {
      branchName: backup.branchName,
      sourceBranchId: backup.neonBranchId,
      targetBranchId,
      preserveName,
    },
  });

  try {
    const operationIds = await restoreBranch({
      targetBranchId,
      sourceBranchId: backup.neonBranchId,
      preserveName,
    });
    const status = await waitForOperations(operationIds);
    const done = status === "finished";
    return {
      ok: status !== "failed",
      configured: true,
      preserveName,
      message: done
        ? `Restore complete. Current state was preserved as "${preserveName}".`
        : status === "failed"
          ? "Restore failed — see the Neon console. Your data was not changed by a failed restore."
          : `Restore initiated; it is still completing in Neon. Current state preserved as "${preserveName}".`,
    };
  } catch (err) {
    return { ok: false, configured: true, message: safeErrorMessage(err) };
  }
}

/**
 * Build a sanitized JSON snapshot of the core business tables for download.
 * Excludes ALL secret material (connector secrets, SSO client secret, OAuth
 * tokens) and session/auth tables — this is a portable data copy, not a full
 * restore. Connector rows include non-secret config only.
 */
export async function exportPlatformData(now: Date) {
  const [
    clients,
    billingRuns,
    billingLines,
    billingLineEdits,
    crmOpportunities,
    priceRules,
    productMappings,
    clientMatchProposals,
    auditLogs,
    connectors,
  ] = await Promise.all([
    prisma.client.findMany(),
    prisma.billingRun.findMany(),
    prisma.billingLine.findMany(),
    prisma.billingLineEdit.findMany(),
    prisma.crmOpportunity.findMany(),
    prisma.priceRule.findMany(),
    prisma.productMapping.findMany(),
    prisma.clientMatchProposal.findMany(),
    prisma.auditLog.findMany(),
    // Non-secret config only — never include secretsEnc.
    prisma.connector.findMany({
      select: {
        id: true,
        type: true,
        enabled: true,
        config: true,
        health: true,
        lastSuccessfulSyncAt: true,
        lastFailedSyncAt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);

  return {
    meta: {
      app: "Wolf365",
      exportedAt: now.toISOString(),
      note: "Sanitized data export. Excludes all secrets, OAuth tokens and sessions. Not a full restore.",
    },
    tables: {
      clients,
      billingRuns,
      billingLines,
      billingLineEdits,
      crmOpportunities,
      priceRules,
      productMappings,
      clientMatchProposals,
      auditLogs,
      connectors,
    },
  };
}
