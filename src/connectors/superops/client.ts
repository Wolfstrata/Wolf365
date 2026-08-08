import { connectorFetch } from "@/connectors/http";
import { writeDebugLog } from "@/lib/debug-log";
import { describeGraphQLErrors } from "@/connectors/superops/parse";
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

// --- Schema-driven field discovery -----------------------------------------
// To pull the maximum detail without guessing, we introspect each entity's type
// and select ALL of its scalar/enum fields (JSON scalars included — that covers
// association blobs like `client`). Object/list-of-object fields are skipped
// (they'd need sub-selections). Adapts automatically to the tenant's schema.

interface TypeRef {
  kind: string;
  name: string | null;
  ofType?: TypeRef | null;
}

const TYPE_REF_FRAGMENT =
  "kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } }";

/** Unwrap NON_NULL/LIST wrappers to the underlying named type. */
function unwrapType(t: TypeRef | null | undefined): { kind: string; name: string | null } {
  let cur: TypeRef | null | undefined = t;
  while (cur && (cur.kind === "NON_NULL" || cur.kind === "LIST")) cur = cur.ofType;
  return { kind: cur?.kind ?? "", name: cur?.name ?? null };
}

interface IntrospectedField {
  name: string;
  type: TypeRef;
}

/** The return type name of a top-level query (e.g. getClientList -> ClientList). */
export async function introspectQueryReturnType(
  ctx: SuperOpsCtx,
  queryName: string,
): Promise<string | null> {
  const q = `query { __schema { queryType { fields { name type { ${TYPE_REF_FRAGMENT} } } } } }`;
  const res = await superOpsGraphQL(ctx, "introspect_query", q, {});
  const fields = (res.data as { __schema?: { queryType?: { fields?: IntrospectedField[] } } } | null)
    ?.__schema?.queryType?.fields;
  if (!res.ok || !Array.isArray(fields)) return null;
  const f = fields.find((x) => x.name === queryName);
  return f ? unwrapType(f.type).name : null;
}

export interface IntrospectedArg {
  name: string;
  /** The type as it must be written in a variable declaration, e.g. `ID!`, `String`. */
  signature: string;
  /** The underlying named type, wrappers removed. */
  baseName: string | null;
  kind: string;
  required: boolean;
}

/** Render a type reference back to GraphQL syntax, so a variable can declare it. */
function renderType(t: TypeRef | null | undefined): string {
  if (!t) return "";
  if (t.kind === "NON_NULL") return `${renderType(t.ofType)}!`;
  if (t.kind === "LIST") return `[${renderType(t.ofType)}]`;
  return t.name ?? "";
}

/**
 * The arguments a top-level query accepts, with their exact types.
 *
 * Needed because a query's *name* being present says nothing about how it wants
 * to be called. Guessing `(ticketId: ID!)` against a tenant that expects
 * `(id: String!)` fails every single call, and a per-record loop that skips
 * failures turns that into a silent zero. Read the schema instead.
 */
export async function introspectQueryArgs(
  ctx: SuperOpsCtx,
  queryName: string,
): Promise<IntrospectedArg[] | null> {
  const q = `query { __schema { queryType { fields { name args { name type { ${TYPE_REF_FRAGMENT} } } } } } }`;
  const res = await superOpsGraphQL(ctx, "introspect_query_args", q, {});
  const fields = (
    res.data as {
      __schema?: { queryType?: { fields?: { name: string; args?: IntrospectedField[] }[] } };
    } | null
  )?.__schema?.queryType?.fields;
  if (!res.ok || !Array.isArray(fields)) return null;
  const field = fields.find((f) => f.name === queryName);
  if (!field) return null;
  return (field.args ?? []).map((a) => {
    const base = unwrapType(a.type);
    const signature = renderType(a.type);
    return {
      name: a.name,
      signature,
      baseName: base.name,
      kind: base.kind,
      required: signature.endsWith("!"),
    };
  });
}

/** The element type name of a wrapper field (e.g. ClientList.clients -> Client). */
export async function introspectFieldType(
  ctx: SuperOpsCtx,
  typeName: string,
  fieldName: string,
): Promise<string | null> {
  const q = `query($n: String!) { __type(name: $n) { fields { name type { ${TYPE_REF_FRAGMENT} } } } }`;
  const res = await superOpsGraphQL(ctx, "introspect_field", q, { n: typeName });
  const fields = (res.data as { __type?: { fields?: IntrospectedField[] } } | null)?.__type?.fields;
  if (!res.ok || !Array.isArray(fields)) return null;
  const f = fields.find((x) => x.name === fieldName);
  return f ? unwrapType(f.type).name : null;
}

/** All SCALAR/ENUM field names of a type (safe to select without sub-selections). */
export async function introspectScalarFieldNames(
  ctx: SuperOpsCtx,
  typeName: string,
): Promise<string[] | null> {
  const q = `query($n: String!) { __type(name: $n) { fields { name type { ${TYPE_REF_FRAGMENT} } } } }`;
  const res = await superOpsGraphQL(ctx, "introspect_scalars", q, { n: typeName });
  const fields = (res.data as { __type?: { fields?: IntrospectedField[] } } | null)?.__type?.fields;
  if (!res.ok || !Array.isArray(fields)) return null;
  const out: string[] = [];
  for (const f of fields) {
    const base = unwrapType(f.type);
    if (base.kind === "SCALAR" || base.kind === "ENUM") out.push(f.name);
  }
  return out;
}

/** One field of a GraphQL *input* type, with its unwrapped base type. */
export interface InputField {
  name: string;
  base: { kind: string; name: string | null };
}

/**
 * Fields of an input object type. Input types expose `inputFields`, not `fields`,
 * so the regular helpers return nothing for them — which is why discovering how a
 * list query can be filtered needs its own call.
 */
export async function introspectInputFields(
  ctx: SuperOpsCtx,
  typeName: string,
): Promise<InputField[] | null> {
  const q = `query($n: String!) { __type(name: $n) { inputFields { name type { ${TYPE_REF_FRAGMENT} } } } }`;
  const res = await superOpsGraphQL(ctx, "introspect_input", q, { n: typeName });
  const fields = (res.data as { __type?: { inputFields?: IntrospectedField[] } } | null)?.__type
    ?.inputFields;
  if (!res.ok || !Array.isArray(fields)) return null;
  return fields.map((f) => ({ name: f.name, base: unwrapType(f.type) }));
}

export interface DetailedField {
  name: string;
  /** True if the field requires arguments (can't be selected without them). */
  requiredArgs: boolean;
  base: { kind: string; name: string | null };
}

/** Field names + kinds + arg-requirements for a type (for recursive selection). */
export async function introspectTypeFieldsDetailed(
  ctx: SuperOpsCtx,
  typeName: string,
): Promise<DetailedField[] | null> {
  const q = `query($n: String!) { __type(name: $n) { fields { name args { type { kind } } type { ${TYPE_REF_FRAGMENT} } } } }`;
  const res = await superOpsGraphQL(ctx, "introspect_detail", q, { n: typeName });
  const fields = (
    res.data as {
      __type?: { fields?: { name: string; args?: { type?: { kind?: string } }[]; type: TypeRef }[] };
    } | null
  )?.__type?.fields;
  if (!res.ok || !Array.isArray(fields)) return null;
  return fields.map((f) => ({
    name: f.name,
    requiredArgs: Array.isArray(f.args) && f.args.some((a) => a?.type?.kind === "NON_NULL"),
    base: unwrapType(f.type),
  }));
}

/** Compact human-readable summary of GraphQL errors for logs/messages. */
// Re-exported from the pure module so it can be unit-tested: the "null" it
// used to print for a null message cost a round trip to diagnose.
export { describeGraphQLErrors };

