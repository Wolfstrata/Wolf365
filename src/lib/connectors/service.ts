import "server-only";
import type { Connector, ConnectorType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { decryptJson, encryptJson } from "@/lib/crypto";
import {
  getEnvConfig,
  getEnvSecrets,
  setEnvConfig,
  setEnvSecrets,
} from "@/lib/connectors/secrets";
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
  /** Non-secret config values for the active environment (prefill the form). */
  configValues: Record<string, unknown>;
  /** Which secret keys have a stored value for the active environment. */
  secretsSet: Record<string, boolean>;
  /** True when this connector stores settings per environment (Sandbox/Production). */
  envScoped: boolean;
  /** The active environment value (e.g. "sandbox"). */
  activeEnv: string;
  /** Per-environment non-secret config, so the UI can switch without a round-trip. */
  envConfig: Record<string, Record<string, unknown>>;
  /** Per-environment secret-set status. */
  envSecretsSet: Record<string, Record<string, boolean>>;
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
  const storedSecrets: Record<string, unknown> = row?.secretsEnc
    ? decryptJson(row.secretsEnc)
    : {};
  const storedConfig = (row?.config as Record<string, unknown>) ?? {};

  const envField = def.configFields.find((f) => f.key === "environment");
  const envScoped = Boolean(envField);
  const envs = envField?.options?.map((o) => o.value) ?? [];
  const activeEnv = String(storedConfig.environment ?? envs[0] ?? "");

  const secretsForEnv = (env: string): Record<string, boolean> => {
    const secs = getEnvSecrets(storedSecrets, { environment: env });
    const out: Record<string, boolean> = {};
    for (const f of def.secretFields) out[f.key] = Boolean(secs[f.key]);
    return out;
  };

  const envConfig: Record<string, Record<string, unknown>> = {};
  const envSecretsSet: Record<string, Record<string, boolean>> = {};
  if (envScoped) {
    for (const env of envs) {
      envConfig[env] = getEnvConfig({ ...storedConfig, environment: env });
      envSecretsSet[env] = secretsForEnv(env);
    }
  }

  const configValues = envScoped
    ? (envConfig[activeEnv] ?? { environment: activeEnv })
    : storedConfig;
  const secretsSet = envScoped
    ? (envSecretsSet[activeEnv] ?? {})
    : secretsForEnv("");

  return {
    type: def.type,
    displayName: def.displayName,
    description: def.description,
    enabled: row?.enabled ?? false,
    health: row?.health ?? "UNCONFIGURED",
    configFields: def.configFields,
    secretFields: def.secretFields,
    configValues,
    secretsSet,
    envScoped,
    activeEnv,
    envConfig,
    envSecretsSet,
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
  const envScoped = def.configFields.some((f) => f.key === "environment");

  // Collect submitted config fields.
  const submitted: Record<string, string> = {};
  for (const f of def.configFields) {
    const v = configValues[f.key];
    if (v !== undefined) submitted[f.key] = v.trim();
  }

  // Build the persisted config. For env-scoped connectors, keep `environment`
  // at the top level and store the remaining fields under that environment.
  const storedConfig = (existing?.config as Record<string, unknown>) ?? {};
  const env = String(submitted.environment ?? "");
  let nextConfig: Record<string, unknown>;
  if (envScoped && env) {
    const { environment: _e, ...nonEnv } = submitted;
    nextConfig = setEnvConfig(storedConfig, env, nonEnv);
  } else {
    nextConfig = submitted;
  }

  // Merge submitted secrets into the active environment's bag (blank inputs are
  // ignored so existing secrets aren't wiped).
  const cfgForSecrets = envScoped ? { environment: env } : {};
  const stored: Record<string, unknown> = existing?.secretsEnc
    ? decryptJson(existing.secretsEnc)
    : {};
  const activeSecrets = getEnvSecrets(stored, cfgForSecrets);
  for (const f of def.secretFields) {
    const v = secretValues[f.key];
    if (v !== undefined && v.trim() !== "") {
      activeSecrets[f.key] = v.trim();
    }
  }
  const mergedSecrets = setEnvSecrets(stored, cfgForSecrets, activeSecrets);

  await prisma.connector.upsert({
    where: { type },
    create: {
      type,
      config: nextConfig as object,
      secretsEnc: encryptJson(mergedSecrets),
    },
    update: {
      config: nextConfig as object,
      secretsEnc: encryptJson(mergedSecrets),
    },
  });
}

export async function setConnectorEnabled(
  type: ConnectorType,
  enabled: boolean,
): Promise<void> {
  await prisma.connector.update({ where: { type }, data: { enabled } });
}
