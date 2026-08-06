import { connectorFetch } from "@/connectors/http";
import type {
  ConnectorDefinition,
  ConnectorSyncResult,
  ConnectorTestResult,
} from "@/connectors/types";
import { huduBase, huduHeaders, type HuduConfig, type HuduCtx, type HuduSecrets } from "./client";
import { syncHuduData } from "./sync";

/**
 * Hudu connector.
 *
 * Hudu exposes a REST API under `<baseUrl>/api/v1` authenticated with the
 * `x-api-key` header. Read-only: we pull companies, assets and article titles so
 * SilverFang can show what Hudu already knows about a client. Wolf365 never
 * pushes anything to Hudu, and never reads Hudu's password records — see the
 * security note in `sync.ts`.
 */
export const huduConnector: ConnectorDefinition<HuduConfig, HuduSecrets> = {
  type: "HUDU",
  displayName: "Hudu",
  description:
    "Sync Hudu companies, assets and documentation links into SilverFang (read-only; credentials are never copied).",
  configFields: [
    {
      key: "baseUrl",
      label: "Hudu Base URL",
      type: "url",
      required: true,
      secret: false,
      placeholder: "https://yourcompany.huducloud.com",
    },
  ],
  secretFields: [
    {
      key: "apiKey",
      label: "API Key",
      type: "password",
      required: true,
      secret: true,
      helpText:
        "Generated in Hudu under Admin → API. A read-only key is sufficient — this connector never writes to Hudu.",
    },
  ],
  validateReadiness(config, secrets) {
    const missing: string[] = [];
    if (!(config as HuduConfig).baseUrl) missing.push("Hudu Base URL");
    if (!(secrets as HuduSecrets).apiKey) missing.push("API Key");
    return missing;
  },

  async testConnection(ctx: HuduCtx): Promise<ConnectorTestResult> {
    const start = Date.now();
    // Listing a single company is a safe, read-only probe.
    const res = await connectorFetch(`${huduBase(ctx)}/api/v1/companies?page_size=1`, {
      connectorType: "HUDU",
      connectorId: ctx.connectorId,
      action: "test_connection",
      headers: huduHeaders(ctx.secrets.apiKey ?? ""),
    });
    const durationMs = Date.now() - start;
    if (!res.ok) {
      return {
        ok: false,
        message:
          res.status === 401
            ? "Hudu rejected the API key (HTTP 401)."
            : `Hudu returned HTTP ${res.status}`,
        durationMs,
      };
    }
    return { ok: true, message: "Connected to Hudu.", durationMs };
  },

  async sync(ctx: HuduCtx): Promise<ConnectorSyncResult> {
    const result = await syncHuduData(ctx);
    return {
      imported: result.imported,
      updated: result.updated,
      skipped: result.skipped,
      summary: result.summary as unknown as Record<string, unknown>,
    };
  },
};

export type { HuduConfig, HuduSecrets, HuduCtx };
