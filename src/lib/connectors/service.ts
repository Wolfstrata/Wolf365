import "server-only";
import type { Connector, ConnectorType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { decryptJson, encryptJson } from "@/lib/crypto";
import { getEnvSecrets, setEnvSecrets } from "@/lib/connectors/secrets";
import { getConnectorDefinition, listConnectorDefinitions } from "@/connectors/registry";
import type { ConnectorDefinition } from "@/connectors/types";

/**
 * Server-only connector service. Bridges the static connector definitions and
 * their stored configuration into safe view models for the admin UI. Secret
 * values are NEVER returned — only whether each secret has been set.
 */
export interface ConnectorView {
  type: ConnectorType;
  displayName: string;
  description: string;
  enabled: boolean;
  health: Connector["health"];
  configFields: ConnectorDefinition["configFields"];
  secretFields: ConnectorDefinition["secretFields"];
  /** Non-secret config values to prefill the form. */
  configValues: Record<string, unknown>;
  /** Which secret keys currently have a stored value. */
  secretsSet: Record<string, boolean>;
  lastSuccessfulSyncAt: Date | null;
  lastFailedSyncAt: Date | null;
  lastError: string | null;
  lastSyncDurationMs: number | null;
  lastRecordsImported: number | null;
  lastRecordsUpdated: number | null;
  lastRecordsSkipped: number | null;
}

export async function getConnectorViews(): Promise<ConnectorView[]> {
  const rows = await prisma.connector.findMany();
  const byType = new Map(rows.map((r) => [r.type, r]));
  return listConnectorDefinitions().map((def) =>
    toView(def, byType.get(def.type)),
  );
}

export async function getConnectorView(
  type: ConnectorType,
): Promise<ConnectorView> {
  const def = getConnectorDefinition(type);
  const row = await prisma.connector.findUnique({ where: { type } });
  return toView(def, row ?? undefined);
}

function toView(
  def: ConnectorDefinition,
  row: Connector | undefined,
): ConnectorView {
  const stored: Record<string, unknown> = row?.secretsEnc
    ? decryptJson(row.secretsEnc)
    : {};
  const config = (row?.config as Record<string, unknown>) ?? {};
  // Report stored status for the ACTIVE environment's credentials.
  const secrets = getEnvSecrets(stored, config);
  const secretsSet: Record<string, boolean> = {};
  for (const f of def.secretFields) {
    secretsSet[f.key] = Boolean(secrets[f.key]);
  }
  return {
    type: def.type,
    displayName: def.displayName,
    description: def.description,
    enabled: row?.enabled ?? false,
    health: row?.health ?? "UNCONFIGURED",
    configFields: def.configFields,
    secretFields: def.secretFields,
    configValues: (row?.config as Record<string, unknown>) ?? {},
    secretsSet,
    lastSuccessfulSyncAt: row?.lastSuccessfulSyncAt ?? null,
    lastFailedSyncAt: row?.lastFailedSyncAt ?? null,
    lastError: row?.lastError ?? null,
    lastSyncDurationMs: row?.lastSyncDurationMs ?? null,
    lastRecordsImported: row?.lastRecordsImported ?? null,
    lastRecordsUpdated: row?.lastRecordsUpdated ?? null,
    lastRecordsSkipped: row?.lastRecordsSkipped ?? null,
  };
}

/**
 * Persist connector configuration. Non-secret values are stored in `config`;
 * secret values are merged into the encrypted secrets bag. Blank secret inputs
 * are ignored so existing secrets are not wiped by an empty form field.
 */
export async function saveConnectorConfig(
  type: ConnectorType,
  configValues: Record<string, string>,
  secretValues: Record<string, string>,
): Promise<void> {
  const def = getConnectorDefinition(type);
  const existing = await prisma.connector.findUnique({ where: { type } });

  const config: Record<string, string> = {};
  for (const f of def.configFields) {
    const v = configValues[f.key];
    if (v !== undefined) config[f.key] = v.trim();
  }

  const stored: Record<string, unknown> = existing?.secretsEnc
    ? decryptJson(existing.secretsEnc)
    : {};
  // Merge submitted secrets into the ACTIVE environment's bag (using the newly
  // submitted config so switching environment targets the right slot). Blank
  // inputs are ignored so existing secrets aren't wiped.
  const activeSecrets = getEnvSecrets(stored, config);
  for (const f of def.secretFields) {
    const v = secretValues[f.key];
    if (v !== undefined && v.trim() !== "") {
      activeSecrets[f.key] = v.trim();
    }
  }
  const merged = setEnvSecrets(stored, config, activeSecrets);

  await prisma.connector.upsert({
    where: { type },
    create: {
      type,
      config,
      secretsEnc: encryptJson(merged),
    },
    update: {
      config,
      secretsEnc: encryptJson(merged),
    },
  });
}

export async function setConnectorEnabled(
  type: ConnectorType,
  enabled: boolean,
): Promise<void> {
  await prisma.connector.update({ where: { type }, data: { enabled } });
}
