import { connectorFetch } from "@/connectors/http";
import { writeDebugLog } from "@/lib/debug-log";
import type { ConnectorContext } from "@/connectors/types";

/**
 * SuperOps GraphQL transport.
 *
 * Single GraphQL endpoint authenticated with a Bearer API token plus a
 * `CustomerSubDomain` header. Region specific:
 *   US: https://api.superops.ai/msp
 *   EU: https://euapi.superops.ai/msp
 * Rate limit: 100 requests/minute (connectorFetch honors 429/Retry-After).
 */
export interface SuperOpsConfig {
  subdomain?: string;
  dataCenter?: "us" | "eu";
  /** Default QBO item id used for invoice lines when pushing to QuickBooks. */
  defaultQboItemId?: string;
  /** Optional override GraphQL query for fetching invoices (advanced). */
  invoicesQuery?: string;
}

export interface SuperOpsSecrets {
  apiToken?: string;
}

export type SuperOpsCtx = ConnectorContext<SuperOpsConfig, SuperOpsSecrets>;

export function superOpsEndpoint(dc: "us" | "eu" | undefined): string {
  return dc === "eu"
    ? "https://euapi.superops.ai/msp"
    : "https://api.superops.ai/msp";
}

export interface GraphQLResult {
  ok: boolean;
  status: number;
  data: unknown;
  errors?: unknown;
}

/** Execute a GraphQL query; treats a GraphQL `errors` array as failure. */
export async function superOpsGraphQL(
  ctx: SuperOpsCtx,
  action: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<GraphQLResult> {
  const res = await connectorFetch(superOpsEndpoint(ctx.config.dataCenter), {
    connectorType: "SUPEROPS",
    connectorId: ctx.connectorId,
    action,
    method: "POST",
    headers: {
      Authorization: `Bearer ${ctx.secrets.apiToken!}`,
      CustomerSubDomain: ctx.config.subdomain!,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const parsed = res.body
    ? (JSON.parse(res.body) as { data?: unknown; errors?: unknown })
    : {};
  // A GraphQL error arrives as HTTP 200 with a non-empty `errors` array, so
  // connectorFetch logs it as a success. Record a redacted failure entry with
  // the GraphQL message(s) so the exact bad field shows in the debug-log viewer.
  if (parsed.errors) {
    await writeDebugLog({
      type: "SUPEROPS",
      connectorId: ctx.connectorId,
      action: `${action}_graphql_error`,
      endpoint: "api.superops.ai/msp",
      httpStatus: res.status,
      outcome: "failure",
      error: describeGraphQLErrors(parsed.errors) || "GraphQL error",
    });
  }
  return {
    ok: res.ok && !parsed.errors,
    status: res.status,
    data: parsed.data,
    errors: parsed.errors,
  };
}

/**
 * Introspect a GraphQL type's field names. Returns null if introspection is
 * disabled or the type is unknown. Used to discover the exact field names a
 * tenant exposes (instead of guessing) for enrichment fields.
 */
export async function introspectTypeFields(
  ctx: SuperOpsCtx,
  typeName: string,
): Promise<string[] | null> {
  const query = `query Introspect($n: String!) { __type(name: $n) { fields { name } } }`;
  const res = await superOpsGraphQL(ctx, "introspect", query, { n: typeName });
  const t = (res.data as { __type?: { fields?: { name?: unknown }[] } } | null)?.__type;
  if (!res.ok || !t?.fields) return null;
  return t.fields
    .map((f) => f.name)
    .filter((n): n is string => typeof n === "string" && n.length > 0);
}

/** Compact human-readable summary of GraphQL errors for logs/messages. */
export function describeGraphQLErrors(errors: unknown): string {
  if (!Array.isArray(errors)) return "";
  const msgs = errors
    .map((e) => (e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : ""))
    .filter(Boolean);
  return msgs.slice(0, 3).join("; ");
}
