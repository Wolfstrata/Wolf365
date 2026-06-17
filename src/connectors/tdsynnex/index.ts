import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { connectorFetch } from "@/connectors/http";
import { writeDebugLog } from "@/lib/debug-log";
import type {
  ConnectorContext,
  ConnectorDefinition,
  ConnectorSyncResult,
  ConnectorTestResult,
} from "@/connectors/types";
import {
  getStellrAccessToken,
  type StellrConfig,
  type StellrSecrets,
} from "@/connectors/tdsynnex/auth";

/**
 * TD SYNNEX StreamOne Stellr connector.
 *
 * Test Connection performs a REAL OAuth client-credentials request: obtaining a
 * token proves the credentials + connectivity without depending on a specific
 * resource path. Customer/subscription sync requires the documented resource
 * paths from the partner-gated API reference; if they are not configured we
 * fail VISIBLY rather than calling an invented endpoint.
 */
export const tdSynnexConnector: ConnectorDefinition<
  StellrConfig,
  StellrSecrets
> = {
  type: "TD_SYNNEX_STELLR",
  displayName: "TD SYNNEX StreamOne Stellr",
  description:
    "Sync M365 customers, license agreements, and SKUs from StreamOne Stellr.",
  configFields: [
    {
      key: "environment",
      label: "Environment",
      type: "select",
      required: true,
      secret: false,
      options: [
        { value: "sandbox", label: "Sandbox" },
        { value: "production", label: "Production" },
      ],
    },
    {
      key: "region",
      label: "Region",
      type: "select",
      required: true,
      secret: false,
      options: [
        { value: "us", label: "United States" },
        { value: "ca", label: "Canada" },
        { value: "eu", label: "Europe" },
        { value: "uk", label: "United Kingdom" },
        { value: "apac", label: "Asia Pacific" },
      ],
      helpText: "Determines the region-specific API base URL.",
    },
    {
      key: "apiBaseUrl",
      label: "API Base URL",
      type: "url",
      required: true,
      secret: false,
      placeholder: "https://<region>.api.tdsynnex...",
      helpText:
        "Region-specific base URL from the Stellr API reference for your environment.",
    },
    {
      key: "tokenUrl",
      label: "OAuth Token URL",
      type: "url",
      required: true,
      secret: false,
      helpText:
        "OAuth token endpoint from the Stellr Developer Portal for your environment.",
    },
    {
      key: "scope",
      label: "OAuth Scope (optional)",
      type: "text",
      required: false,
      secret: false,
    },
    {
      key: "customersPath",
      label: "Customers resource path (optional)",
      type: "text",
      required: false,
      secret: false,
      placeholder: "/v1/customers",
      helpText:
        "Documented path for listing customers. Required for customer sync.",
    },
    {
      key: "subscriptionsPath",
      label: "Subscriptions resource path (optional)",
      type: "text",
      required: false,
      secret: false,
      helpText:
        "Documented path for listing M365 subscriptions. Required for subscription sync.",
    },
  ],
  secretFields: [
    {
      key: "clientId",
      label: "Client ID",
      type: "password",
      required: true,
      secret: true,
    },
    {
      key: "clientSecret",
      label: "Client Secret",
      type: "password",
      required: true,
      secret: true,
    },
  ],
  validateReadiness(config, secrets) {
    const c = config as StellrConfig;
    const s = secrets as StellrSecrets;
    const missing: string[] = [];
    if (!c.apiBaseUrl) missing.push("API Base URL");
    if (!c.tokenUrl) missing.push("OAuth Token URL");
    if (!s.clientId) missing.push("Client ID");
    if (!s.clientSecret) missing.push("Client Secret");
    return missing;
  },

  async testConnection(ctx): Promise<ConnectorTestResult> {
    const start = Date.now();
    // A successful client-credentials grant is a real, side-effect-free probe.
    await getStellrAccessToken(ctx.config, ctx.secrets, (next) =>
      ctx.saveSecrets(next),
    );
    return {
      ok: true,
      message: "Authenticated with StreamOne Stellr (access token obtained).",
      details: {
        environment: ctx.config.environment ?? "",
        region: ctx.config.region ?? "",
      },
      durationMs: Date.now() - start,
    };
  },

  async sync(ctx): Promise<ConnectorSyncResult> {
    if (!ctx.config.customersPath) {
      // Fail visibly — do not invent an endpoint.
      throw new Error(
        "TD SYNNEX customer sync requires the documented 'Customers resource path' " +
          "to be configured. Add it from the Stellr API reference for your region.",
      );
    }

    let imported = 0;
    let updated = 0;
    let skipped = 0;

    const customers = await fetchJsonList(ctx, ctx.config.customersPath, "sync_customers");
    for (const raw of customers) {
      const result = await upsertTdCustomer(raw);
      if (result === "created") imported += 1;
      else updated += 1;
    }

    // Subscriptions are optional; only sync if the path is configured.
    let subCount = 0;
    const subsPath = ctx.config.subscriptionsPath;
    if (subsPath) {
      const perCustomer = /\{customerNo\}|\{customerId\}/.test(subsPath);
      if (perCustomer) {
        // The subscriptions endpoint is per-customer (…/customers/{customerNo}
        // /subscriptions). Loop over synced customers, substituting the id.
        const stored = await prisma.tdSynnexCustomer.findMany();
        for (const cust of stored) {
          const path = subsPath.replace(
            /\{customerNo\}|\{customerId\}/g,
            encodeURIComponent(cust.stellrId),
          );
          const subs = await fetchJsonList(ctx, path, "sync_subscriptions");
          for (const raw of subs) {
            const ok = await upsertTdSubscription(raw, cust.id);
            if (ok) subCount += 1;
            else skipped += 1;
          }
        }
      } else {
        const subs = await fetchJsonList(ctx, subsPath, "sync_subscriptions");
        for (const raw of subs) {
          const ok = await upsertTdSubscription(raw);
          if (ok) subCount += 1;
          else skipped += 1;
        }
      }
    }

    return {
      imported,
      updated,
      skipped,
      summary: { customers: customers.length, subscriptions: subCount },
    };
  },
};

// ---------------------------------------------------------------------------
// Response parsing + persistence.
//
// The Stellr response envelope and exact field names vary by region/version.
// We read defensively across the common shapes (top-level array, or items/data/
// results/customers/subscriptions wrappers) and map well-known field aliases.
// A wrong path still surfaces the real HTTP error — we never fabricate records.
// ---------------------------------------------------------------------------

async function fetchJsonList(
  ctx: ConnectorContext<StellrConfig, StellrSecrets>,
  path: string,
  action: string,
): Promise<Record<string, unknown>[]> {
  const token = await getStellrAccessToken(ctx.config, ctx.secrets, (next) =>
    ctx.saveSecrets(next),
  );
  const base = ctx.config.apiBaseUrl!.replace(/\/$/, "");
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await connectorFetch(url, {
    connectorType: "TD_SYNNEX_STELLR",
    connectorId: ctx.connectorId,
    environment: ctx.config.environment ?? ctx.config.region ?? null,
    action,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`TD SYNNEX ${action} failed (HTTP ${res.status}). Verify the resource path.`);
  }
  const parsed = JSON.parse(res.body) as unknown;
  const arr = extractArray(parsed);

  // Diagnostic (no customer PII): record how many records we parsed and the
  // JSON envelope keys, so an empty result can be distinguished from a parser
  // miss in the admin Debug Logs.
  const isObj = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === "object" && !Array.isArray(v);
  const topKeys = Array.isArray(parsed)
    ? ["<root array>"]
    : isObj(parsed)
      ? Object.keys(parsed)
      : [];
  const dataKeys =
    isObj(parsed) && isObj(parsed.data) ? Object.keys(parsed.data) : [];
  await writeDebugLog({
    type: "TD_SYNNEX_STELLR",
    connectorId: ctx.connectorId,
    environment: ctx.config.environment ?? ctx.config.region ?? null,
    action: `${action}_parsed`,
    httpStatus: res.status,
    recordsReturned: arr.length,
    outcome: "success",
    error: `parsed ${arr.length} record(s); topKeys=[${topKeys.join(",")}]; dataKeys=[${dataKeys.join(",")}]`,
  });

  return arr;
}

function extractArray(parsed: unknown): Record<string, unknown>[] {
  if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
  const obj = (parsed ?? {}) as Record<string, unknown>;

  // TD SYNNEX Stellr paginated shape: { requestId, data: { total, records: [] } }.
  // Handle the `data.<array>` envelope explicitly before anything else.
  if (obj.data && typeof obj.data === "object" && !Array.isArray(obj.data)) {
    const inner = obj.data as Record<string, unknown>;
    for (const key of ["records", "content", "items", "results", "list", "customers", "subscriptions"]) {
      if (Array.isArray(inner[key])) return inner[key] as Record<string, unknown>[];
    }
  }

  // Known top-level wrapper keys (incl. Spring-style `content`).
  for (const key of [
    "records",
    "content",
    "items",
    "data",
    "results",
    "value",
    "customers",
    "subscriptions",
  ]) {
    if (Array.isArray(obj[key])) return obj[key] as Record<string, unknown>[];
  }
  // Fallback: first array-of-objects found at the top level, then one level
  // deep (handles e.g. { data: { content: [...] } }) — avoids guessing the
  // exact wrapper name while still ignoring scalar/metadata arrays.
  const topArray = firstObjectArray(obj);
  if (topArray) return topArray;
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const nested = firstObjectArray(v as Record<string, unknown>);
      if (nested) return nested;
    }
  }
  return [];
}

function firstObjectArray(
  obj: Record<string, unknown>,
): Record<string, unknown>[] | null {
  for (const v of Object.values(obj)) {
    if (
      Array.isArray(v) &&
      v.length > 0 &&
      typeof v[0] === "object" &&
      v[0] !== null
    ) {
      return v as Record<string, unknown>[];
    }
  }
  return null;
}

function pick(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v;
    if (typeof v === "number") return String(v);
  }
  return null;
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number") return v;
    if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  }
  return null;
}

async function upsertTdCustomer(
  raw: Record<string, unknown>,
): Promise<"created" | "updated" | "skipped"> {
  const stellrId = pick(raw, ["customerNo", "customerNumber", "id", "customerId", "accountId"]);
  if (!stellrId) return "skipped";
  const name =
    pick(raw, ["name", "companyName", "customerName", "displayName"]) ??
    `Customer ${stellrId}`;
  const data = {
    name,
    domain: pick(raw, ["domain", "defaultDomain", "primaryDomain"]),
    microsoftTenantId: pick(raw, ["microsoftTenantId", "tenantId", "msTenantId"]),
    serviceAddress: (raw.address ?? raw.serviceAddress ?? undefined) as
      | Prisma.InputJsonValue
      | undefined,
    active: deriveActive(raw),
    raw: raw as Prisma.InputJsonValue,
    lastSyncedAt: new Date(),
  };
  const existing = await prisma.tdSynnexCustomer.findUnique({ where: { stellrId } });
  if (existing) {
    await prisma.tdSynnexCustomer.update({ where: { stellrId }, data });
    return "updated";
  }
  await prisma.tdSynnexCustomer.create({ data: { stellrId, ...data } });
  return "created";
}

async function upsertTdSubscription(
  raw: Record<string, unknown>,
  /** Known internal customer id when called per-customer (templated path). */
  customerInternalId?: string,
): Promise<boolean> {
  const stellrSubscriptionId = pick(raw, [
    "id",
    "subscriptionId",
    "agreementId",
    "vendorSubscriptionId",
  ]);
  if (!stellrSubscriptionId) return false;

  let customer: { id: string } | null = null;
  if (customerInternalId) {
    customer = { id: customerInternalId };
  } else {
    const customerStellrId = pick(raw, ["customerId", "accountId", "customer", "customerNo"]);
    if (!customerStellrId) return false;
    customer = await prisma.tdSynnexCustomer.findUnique({
      where: { stellrId: customerStellrId },
    });
  }
  if (!customer) return false; // customer must be synced first

  const data = {
    customerId: customer.id,
    productSku: pick(raw, ["sku", "productSku", "partNumber"]),
    productName: pick(raw, ["productName", "name", "description"]),
    quantity: pickNumber(raw, ["quantity", "seats", "qty"]) ?? 0,
    unitCost: pickNumber(raw, ["unitCost", "cost", "price", "unitPrice"]),
    currency: pick(raw, ["currency", "currencyCode"]),
    commitmentTerm: pick(raw, ["commitmentTerm", "term", "billingTerm"]),
    billingFrequency: pick(raw, ["billingFrequency", "billingCycle"]),
    startDate: parseDate(raw, ["startDate", "effectiveDate", "createdDate"]),
    renewalDate: parseDate(raw, ["renewalDate", "endDate", "expiryDate"]),
    cancellationWindowEnds: parseDate(raw, ["cancellationWindowEnds", "cancellationDeadline"]),
    reducible: typeof raw.reducible === "boolean" ? raw.reducible : null,
    status: pick(raw, ["status", "state"]),
    raw: raw as Prisma.InputJsonValue,
    lastSyncedAt: new Date(),
  };
  await prisma.tdSynnexSubscription.upsert({
    where: { stellrSubscriptionId },
    create: { stellrSubscriptionId, ...data },
    update: data,
  });
  return true;
}

function deriveActive(raw: Record<string, unknown>): boolean {
  if (typeof raw.active === "boolean") return raw.active;
  const status = pick(raw, ["status", "state"])?.toLowerCase();
  if (!status) return true;
  return !["inactive", "suspended", "cancelled", "canceled", "disabled"].includes(status);
}

function parseDate(raw: Record<string, unknown>, keys: string[]): Date | null {
  const v = pick(raw, keys);
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
