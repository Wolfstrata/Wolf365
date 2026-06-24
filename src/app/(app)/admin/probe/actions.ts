"use server";

import type { ConnectorType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { safeErrorMessage } from "@/lib/redact";
import { fetch as undiciFetch } from "undici";
import { buildContext } from "@/connectors/runtime";
import { connectorFetch, proxyAgent, proxyConfigured } from "@/connectors/http";
import {
  getStellrAccessToken,
  type StellrConfig,
  type StellrSecrets,
} from "@/connectors/tdsynnex/auth";
import {
  getValidAccessToken,
  qboApiBase,
  type QboEnvironment,
  type QboSecrets,
} from "@/connectors/quickbooks/oauth";

export interface ProbeResult {
  ok: boolean;
  status?: number;
  url?: string;
  message: string;
  /** Truncated raw response body for inspection (admin-only, not persisted). */
  preview?: string;
}

export interface EgressIpResult {
  ok: boolean;
  ip?: string;
  proxied: boolean;
  message: string;
}

/**
 * Report the outbound (egress) IP that connector API calls originate from, by
 * calling a public IP-echo service through the SAME path connectors use (so a
 * configured static-IP proxy is reflected). Use this value for vendor IP
 * allowlists (e.g. QuickBooks production "where is your app hosted").
 */
export async function showEgressIpAction(): Promise<EgressIpResult> {
  await requirePermission("connectors:configure");
  const proxied = proxyConfigured;
  // Direct call through the (optional) proxy dispatcher so the REAL underlying
  // error is surfaced — connectorFetch's retry wrapper hides the cause.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await undiciFetch("https://api.ipify.org?format=json", {
      signal: controller.signal,
      ...(proxyAgent ? { dispatcher: proxyAgent } : {}),
    });
    if (!res.ok) {
      return { ok: false, proxied, message: `IP echo returned HTTP ${res.status}` };
    }
    const ip = (JSON.parse(await res.text()) as { ip?: string }).ip;
    return {
      ok: true,
      ip,
      proxied,
      message: proxied
        ? "Egress IP (through the configured static-IP proxy)."
        : "Egress IP (NO proxy configured — this is a rotating Vercel IP).",
    };
  } catch (err) {
    // Surface the underlying cause (auth/connection/TLS) for diagnosis.
    const cause = (err as { cause?: { message?: string; code?: string } }).cause;
    const detail = cause?.code || cause?.message;
    return {
      ok: false,
      proxied,
      message: `${safeErrorMessage(err)}${detail ? ` — ${detail}` : ""}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

const MAX_PREVIEW = 6000;

/**
 * Admin endpoint-discovery probe. Performs a REAL authenticated GET against a
 * connector's configured base URL + the supplied path, using the saved
 * credentials for the active environment, and returns the raw response so an
 * admin can find the correct endpoint/parameters. Owner/admin only; the body is
 * shown to the admin but never persisted.
 */
export async function runProbeAction(
  _prev: ProbeResult | null,
  formData: FormData,
): Promise<ProbeResult> {
  const user = await requirePermission("connectors:configure");
  const type = String(formData.get("type")) as ConnectorType;
  let path = String(formData.get("path") ?? "").trim();
  if (!path) return { ok: false, message: "Enter a path to probe." };
  if (!path.startsWith("/")) path = `/${path}`;

  try {
    const connector = await prisma.connector.findUniqueOrThrow({
      where: { type },
    });
    const ctx = await buildContext(connector);

    let url: string;
    let headers: Record<string, string>;

    if (type === "TD_SYNNEX_STELLR") {
      const config = ctx.config as StellrConfig;
      const token = await getStellrAccessToken(
        config,
        ctx.secrets as StellrSecrets,
        (next) => ctx.saveSecrets(next as Record<string, unknown>),
      );
      const base = (config.apiBaseUrl ?? "").replace(/\/$/, "");
      // Substitute {accountId} so the admin can paste templated paths.
      const filled = path.replace(
        /\{accountId\}/g,
        encodeURIComponent(config.accountId ?? ""),
      );
      url = `${base}${filled}`;
      headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    } else if (type === "QUICKBOOKS_ONLINE") {
      const secrets = ctx.secrets as QboSecrets;
      const env = (ctx.config.environment as QboEnvironment) ?? "sandbox";
      const token = await getValidAccessToken(secrets, (next) =>
        ctx.saveSecrets(next as Record<string, unknown>),
      );
      url = `${qboApiBase(env)}${path}`;
      headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    } else {
      return { ok: false, message: `Probe not supported for ${type}.` };
    }

    const res = await connectorFetch(url, {
      connectorType: type,
      connectorId: connector.id,
      action: "api_probe",
      headers,
    });

    await audit({
      action: "SYNC_RUN",
      actorId: user.id,
      actorEmail: user.email,
      target: `probe:${type}`,
      metadata: { status: res.status },
    });

    const preview =
      res.body.length > MAX_PREVIEW
        ? `${res.body.slice(0, MAX_PREVIEW)}\n…[truncated, ${res.body.length} bytes total]`
        : res.body;

    return {
      ok: res.ok,
      status: res.status,
      url,
      message: res.ok
        ? `HTTP ${res.status}`
        : `HTTP ${res.status} — check the path/parameters`,
      preview,
    };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}
