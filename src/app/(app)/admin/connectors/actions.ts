"use server";

import { revalidatePath } from "next/cache";
import type { ConnectorType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import {
  saveConnectorConfig,
  setConnectorEnabled,
} from "@/lib/connectors/service";
import { getConnectorDefinition } from "@/connectors/registry";
import { runSync, runTestConnection } from "@/connectors/runtime";
import { safeErrorMessage } from "@/lib/redact";

export interface ActionResult {
  ok: boolean;
  message: string;
  /** The environment the operation ran against (e.g. "sandbox"), if any. */
  env?: string;
}

/** Read the connector's currently-saved environment, if it has one. */
async function savedEnv(type: ConnectorType): Promise<string | undefined> {
  const row = await prisma.connector.findUnique({
    where: { type },
    select: { config: true },
  });
  const env = (row?.config as Record<string, unknown> | null)?.environment;
  return typeof env === "string" && env ? env : undefined;
}

/** The environment the operation should target, from the form's toggle. */
function requestedEnv(formData: FormData): string | undefined {
  const v = formData.get("env");
  return typeof v === "string" && v ? v : undefined;
}

/** Prefix a message with a capitalized environment label, e.g. "Sandbox: …". */
function withEnv(message: string, env?: string): string {
  if (!env) return message;
  return `${env.charAt(0).toUpperCase()}${env.slice(1)}: ${message}`;
}

const CONNECTOR_TYPES: ConnectorType[] = [
  "TD_SYNNEX_STELLR",
  "QUICKBOOKS_ONLINE",
  "HUDU",
  "SUPEROPS",
  "SALESFORCE",
];

function parseType(value: FormDataEntryValue | null): ConnectorType {
  if (typeof value === "string" && CONNECTOR_TYPES.includes(value as ConnectorType)) {
    return value as ConnectorType;
  }
  throw new Error("Invalid connector type");
}

/** Save non-secret config + any newly entered secrets for a connector. */
export async function saveConnectorAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requirePermission("connectors:configure");
  try {
    const type = parseType(formData.get("type"));
    const def = getConnectorDefinition(type);

    const config: Record<string, string> = {};
    for (const f of def.configFields) {
      const v = formData.get(`config.${f.key}`);
      if (typeof v === "string") config[f.key] = v;
    }
    const secrets: Record<string, string> = {};
    for (const f of def.secretFields) {
      const v = formData.get(`secret.${f.key}`);
      if (typeof v === "string") secrets[f.key] = v;
    }

    await saveConnectorConfig(type, config, secrets);
    await audit({
      action: "CONNECTOR_CONFIG_CHANGED",
      actorId: user.id,
      actorEmail: user.email,
      target: `connector:${type}`,
      metadata: { configFields: Object.keys(config) },
    });
    revalidatePath(`/admin/connectors/${type}`);
    return { ok: true, message: "Configuration saved." };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

/** Run a real Test Connection probe. */
export async function testConnectionAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requirePermission("connectors:configure");
  const type = parseType(formData.get("type"));
  // Target the toggled environment (falls back to saved for non-env connectors).
  const env = requestedEnv(formData) ?? (await savedEnv(type));
  try {
    const result = await runTestConnection(type, env);
    revalidatePath(`/admin/connectors/${type}`);
    return { ok: result.ok, message: withEnv(result.message, env), env };
  } catch (err) {
    return { ok: false, message: withEnv(safeErrorMessage(err), env), env };
  }
}

/** Trigger a real sync run. */
export async function syncNowAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requirePermission("connectors:sync");
  const type = parseType(formData.get("type"));
  const env = requestedEnv(formData) ?? (await savedEnv(type));
  try {
    const result = await runSync(type, "manual", user.id, env);
    await audit({
      action: "SYNC_RUN",
      actorId: user.id,
      actorEmail: user.email,
      target: `connector:${type}`,
      metadata: {
        imported: result.imported,
        updated: result.updated,
        skipped: result.skipped,
      },
    });
    revalidatePath(`/admin/connectors/${type}`);
    return {
      ok: true,
      env,
      message: withEnv(
        `Sync complete: ${result.imported} imported, ${result.updated} updated, ${result.skipped} skipped.`,
        env,
      ),
    };
  } catch (err) {
    return { ok: false, message: withEnv(safeErrorMessage(err), env), env };
  }
}

/** Enable/disable a connector. */
export async function toggleConnectorAction(
  formData: FormData,
): Promise<void> {
  const user = await requirePermission("connectors:configure");
  const type = parseType(formData.get("type"));
  const enabled = formData.get("enabled") === "true";
  await setConnectorEnabled(type, enabled);
  await audit({
    action: enabled ? "CONNECTOR_ENABLED" : "CONNECTOR_DISABLED",
    actorId: user.id,
    actorEmail: user.email,
    target: `connector:${type}`,
  });
  revalidatePath(`/admin/connectors/${type}`);
  revalidatePath("/admin/connectors");
}
