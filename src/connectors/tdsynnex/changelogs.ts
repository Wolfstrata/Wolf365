import { prisma } from "@/lib/db";
import { buildContext } from "@/connectors/runtime";
import { connectorFetch } from "@/connectors/http";
import { getEnvConfig } from "@/lib/connectors/secrets";
import { safeErrorMessage } from "@/lib/redact";
import {
  getStellrAccessToken,
  type StellrConfig,
  type StellrSecrets,
} from "@/connectors/tdsynnex/auth";

/**
 * Read-only retrieval of TD SYNNEX Stellr `listSubscriptionChangeLogs` for a
 * single subscription (keyed by customerNo + contractNo). Used by the admin
 * Subscription Raw diagnostic to reveal the exact date + quantity of mid-month
 * seat additions on a co-terminous subscription — the data that lets us pro-rate
 * added seats on their own line. Returns the raw response verbatim; we do NOT
 * assume field names here (the response schema is confirmed from real output).
 */
export interface ChangeLogResult {
  ok: boolean;
  status?: number;
  url?: string;
  message: string;
  /** Extracted change-log entries when the response envelope is recognized. */
  records: Record<string, unknown>[];
  /** Parsed response body (object/array), or the raw string if not JSON. */
  raw: unknown;
}

/**
 * Generate candidate paths by re-spelling a change-log-ish last path segment.
 * Stellr's route is one of several common spellings (changelogs / change-logs /
 * changeLogs …); we try them so a single wrong spelling doesn't force the admin
 * to guess-and-save repeatedly. The configured spelling is always tried first.
 */
function changeLogPathVariants(template: string): string[] {
  const [pathPart = "", query = ""] = template.split("?");
  const segs = pathPart.split("/");
  const lastIdx = segs.length - 1;
  const last = segs[lastIdx] ?? "";
  if (!/change|log/i.test(last)) return [template];
  const spellings = [last, "change-logs", "changeLogs", "changelogs", "change-log", "changelog"];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of spellings) {
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const copy = [...segs];
    copy[lastIdx] = s;
    const joined = copy.join("/");
    out.push(query ? `${joined}?${query}` : joined);
  }
  return out;
}

/** Pull the first array-of-objects out of a Stellr paginated envelope. */
function extractRecords(parsed: unknown): Record<string, unknown>[] {
  if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
  const obj = (parsed ?? {}) as Record<string, unknown>;
  const inner =
    obj.data && typeof obj.data === "object" && !Array.isArray(obj.data)
      ? (obj.data as Record<string, unknown>)
      : obj;
  for (const key of [
    "records",
    "changeLogs",
    "changelogs",
    "content",
    "items",
    "results",
    "list",
  ]) {
    if (Array.isArray(inner[key])) return inner[key] as Record<string, unknown>[];
  }
  return [];
}

export async function fetchStellrChangeLogs(
  customerNo: string,
  contractNo: string,
): Promise<ChangeLogResult> {
  const empty = { records: [] as Record<string, unknown>[], raw: null };
  try {
    const connector = await prisma.connector.findUnique({
      where: { type: "TD_SYNNEX_STELLR" },
    });
    if (!connector) {
      return { ok: false, message: "TD SYNNEX connector is not configured.", ...empty };
    }

    // The change-logs path (and the live customer data) live under a specific
    // environment. buildContext with no override reads whichever environment is
    // currently active — which may not be the one where the path is saved. Pick
    // the environment that actually has changeLogsPath configured, preferring
    // production (where real customer data lives), then build context for it.
    const storedConfig = (connector.config as Record<string, unknown>) ?? {};
    const activeEnv =
      typeof storedConfig.environment === "string" ? storedConfig.environment : null;
    const envMap =
      storedConfig.__env && typeof storedConfig.__env === "object"
        ? (storedConfig.__env as Record<string, unknown>)
        : {};
    const candidateEnvs = Array.from(
      new Set(
        [activeEnv, "production", "sandbox", ...Object.keys(envMap)].filter(
          (e): e is string => Boolean(e),
        ),
      ),
    );
    let chosenEnv: string | null = null;
    let chosenPath: string | null = null;
    for (const env of candidateEnvs) {
      const cfg = getEnvConfig({ ...storedConfig, environment: env }) as StellrConfig;
      if (cfg.changeLogsPath) {
        chosenEnv = env;
        chosenPath = cfg.changeLogsPath;
        break;
      }
    }
    if (!chosenEnv || !chosenPath) {
      return {
        ok: false,
        message:
          "No 'Subscription change logs path' is configured on the TD SYNNEX connector " +
          "(checked all environments). Add it in the connector settings from the Stellr " +
          "API reference (listSubscriptionChangeLogs), using {customerNo} and {contractNo} " +
          "placeholders, and click Save configuration.",
        ...empty,
      };
    }

    const ctx = await buildContext(connector, chosenEnv);
    const config = ctx.config as StellrConfig;
    const token = await getStellrAccessToken(
      config,
      ctx.secrets as StellrSecrets,
      (next) => ctx.saveSecrets(next as Record<string, unknown>),
    );
    const base = (config.apiBaseUrl ?? "").replace(/\/$/, "");
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };

    // Try the configured spelling first, then common change-log segment variants
    // so one wrong spelling doesn't force a save-and-retry loop. First 2xx wins;
    // otherwise keep the configured spelling's result to report.
    const variants = changeLogPathVariants(chosenPath);
    let chosen: { url: string; status: number; ok: boolean; raw: unknown } | null = null;
    let firstAttempt: { url: string; status: number; ok: boolean; raw: unknown } | null = null;
    for (const variant of variants) {
      let filled = variant
        .replace(/\{customerNo\}/g, encodeURIComponent(customerNo))
        .replace(/\{contractNo\}/g, encodeURIComponent(contractNo));
      if (!filled.startsWith("/")) filled = `/${filled}`;
      const url = `${base}${filled}`;
      const res = await connectorFetch(url, {
        connectorType: "TD_SYNNEX_STELLR",
        connectorId: connector.id,
        action: "changelogs_probe",
        headers,
      });
      let raw: unknown = res.body;
      try {
        raw = JSON.parse(res.body);
      } catch {
        /* non-JSON body — surface as-is */
      }
      const attempt = { url, status: res.status, ok: res.ok, raw };
      firstAttempt ??= attempt;
      if (res.ok) {
        chosen = attempt;
        break;
      }
    }
    const result = chosen ?? firstAttempt!;
    const foundVariant = chosen && variants.length > 1;
    const raw = result.raw;

    return {
      ok: result.ok,
      status: result.status,
      url: result.url,
      message: result.ok
        ? `HTTP ${result.status} · ${chosenEnv}${foundVariant ? " — working path found; save this exact path in the connector" : ""}`
        : `HTTP ${result.status} · ${chosenEnv} — tried ${variants.length} path spelling(s); none matched. Verify the exact segment in the Stellr docs.`,
      records: result.ok ? extractRecords(raw) : [],
      raw,
    };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err), ...empty };
  }
}
