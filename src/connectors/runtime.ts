import type { Connector, ConnectorType, Prisma } from "@prisma/client";
import { ConnectorHealth, SyncStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { decryptJson, encryptJson } from "@/lib/crypto";
import { getEnvSecrets, setEnvSecrets } from "@/lib/connectors/secrets";
import { safeErrorMessage } from "@/lib/redact";
import { getConnectorDefinition } from "@/connectors/registry";
import type {
  ConnectorContext,
  ConnectorSyncResult,
  ConnectorTestResult,
} from "@/connectors/types";

/**
 * Connector runtime: the cross-cutting orchestration layer that every connector
 * operation goes through. It builds the decrypted execution context, runs the
 * connector-specific logic, and records health, sync runs, and errors. Secrets
 * never leave this layer except into the connector code itself.
 */

/** Build a runtime context with decrypted secrets for a stored connector. */
export async function buildContext(
  connector: Connector,
): Promise<ConnectorContext> {
  const stored: Record<string, unknown> = connector.secretsEnc
    ? decryptJson(connector.secretsEnc)
    : {};
  const config = (connector.config as Record<string, unknown>) ?? {};
  // Resolve the secrets for the active environment (Sandbox/Production).
  const secrets = getEnvSecrets(stored, config);

  return {
    connectorId: connector.id,
    type: connector.type,
    config,
    secrets,
    saveSecrets: async (next) => {
      const merged = setEnvSecrets(stored, config, next);
      await prisma.connector.update({
        where: { id: connector.id },
        data: { secretsEnc: encryptJson(merged) },
      });
      // Keep the in-memory context coherent for the rest of the operation.
      Object.assign(stored, merged);
      Object.assign(secrets, next);
    },
  };
}

/** Fetch the connector row, or throw a clear error if it is not configured. */
async function requireConnector(type: ConnectorType): Promise<Connector> {
  const connector = await prisma.connector.findUnique({ where: { type } });
  if (!connector) {
    throw new Error(`Connector ${type} is not configured`);
  }
  return connector;
}

/**
 * Run a connector's real Test Connection probe and update its health status.
 * Returns a secret-free result for display.
 */
export async function runTestConnection(
  type: ConnectorType,
): Promise<ConnectorTestResult> {
  const def = getConnectorDefinition(type);
  const connector = await requireConnector(type);
  const ctx = await buildContext(connector);

  // Fail visibly if required configuration/credentials are missing.
  const missing = def.validateReadiness(ctx.config, ctx.secrets);
  if (missing.length > 0) {
    await prisma.connector.update({
      where: { id: connector.id },
      data: { health: ConnectorHealth.UNCONFIGURED, lastError: missing.join("; ") },
    });
    return {
      ok: false,
      message: `Missing configuration: ${missing.join("; ")}`,
    };
  }

  try {
    const result = await def.testConnection(ctx);
    await prisma.connector.update({
      where: { id: connector.id },
      data: {
        health: result.ok ? ConnectorHealth.HEALTHY : ConnectorHealth.ERROR,
        lastError: result.ok ? null : result.message,
      },
    });
    return result;
  } catch (err) {
    const message = safeErrorMessage(err);
    await prisma.connector.update({
      where: { id: connector.id },
      data: { health: ConnectorHealth.ERROR, lastError: message },
    });
    return { ok: false, message };
  }
}

/**
 * Run a connector's real sync inside a tracked SyncRun, updating health,
 * timing, and record counts. Throws are caught and recorded as a FAILED run.
 */
export async function runSync(
  type: ConnectorType,
  trigger: "manual" | "cron" | "test",
  startedById?: string | null,
): Promise<ConnectorSyncResult> {
  const def = getConnectorDefinition(type);
  const connector = await requireConnector(type);
  const ctx = await buildContext(connector);

  const missing = def.validateReadiness(ctx.config, ctx.secrets);
  if (missing.length > 0) {
    throw new Error(`Cannot sync: missing configuration — ${missing.join("; ")}`);
  }

  const run = await prisma.syncRun.create({
    data: {
      connectorId: connector.id,
      type,
      status: SyncStatus.RUNNING,
      trigger,
      startedById: startedById ?? null,
    },
  });

  const start = Date.now();
  try {
    const result = await def.sync(ctx);
    const durationMs = Date.now() - start;

    await prisma.$transaction([
      prisma.syncRun.update({
        where: { id: run.id },
        data: {
          status: SyncStatus.SUCCESS,
          finishedAt: new Date(),
          durationMs,
          recordsImported: result.imported,
          recordsUpdated: result.updated,
          recordsSkipped: result.skipped,
          summary: (result.summary ?? undefined) as
            | Prisma.InputJsonValue
            | undefined,
        },
      }),
      prisma.connector.update({
        where: { id: connector.id },
        data: {
          health: ConnectorHealth.HEALTHY,
          lastSuccessfulSyncAt: new Date(),
          lastSyncDurationMs: durationMs,
          lastRecordsImported: result.imported,
          lastRecordsUpdated: result.updated,
          lastRecordsSkipped: result.skipped,
          lastError: null,
        },
      }),
    ]);
    return result;
  } catch (err) {
    const durationMs = Date.now() - start;
    const message = safeErrorMessage(err);
    await prisma.$transaction([
      prisma.syncRun.update({
        where: { id: run.id },
        data: {
          status: SyncStatus.FAILED,
          finishedAt: new Date(),
          durationMs,
          error: message,
        },
      }),
      prisma.connector.update({
        where: { id: connector.id },
        data: {
          health: ConnectorHealth.ERROR,
          lastFailedSyncAt: new Date(),
          lastSyncDurationMs: durationMs,
          lastError: message,
        },
      }),
    ]);
    throw err;
  }
}
