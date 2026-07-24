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
        { value: "sandbox", label: "Sandbox / UAT — testing (api-uat.*.tdsynnex.com)" },
        { value: "production", label: "Production — live data (api.*.tdsynnex.com)" },
      ],
      helpText:
        "Credentials and tokens are stored SEPARATELY per environment. Use the matching Sandbox or Production client credentials from the Developer Portal.",
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
      key: "accountId",
      label: "Reseller Account ID",
      type: "text",
      required: false,
      secret: false,
      placeholder: "1230703",
      helpText:
        "Your reseller account id. Used to fill {accountId} in account-scoped paths.",
    },
    {
      key: "customersPath",
      label: "Customers resource path (optional)",
      type: "text",
      required: false,
      secret: false,
      placeholder: "/api/v3/accounts/{accountId}/customers",
      helpText:
        "Documented path for listing customers (use {accountId} for the account-scoped endpoint). Required for customer sync.",
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
    {
      key: "changeLogsPath",
      label: "Subscription change logs path (optional)",
      type: "text",
      required: false,
      secret: false,
      placeholder:
        "e.g. /api/v1/cloud/customers/{customerNo}/subscriptions/changelogs?contractNo={contractNo}",
      helpText:
        "TYPE the full listSubscriptionChangeLogs path here (the grey text is only an example — mirror your working Subscriptions resource path). Use {customerNo} and {contractNo} placeholders. Used by the Subscription Raw diagnostic to reveal the exact date and quantity of mid-month seat additions.",
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

    // Account-scoped endpoints require {accountId}; fail visibly if it's used
    // but not configured.
    if (ctx.config.customersPath.includes("{accountId}") && !ctx.config.accountId) {
      throw new Error(
        "Customers path uses {accountId} but Reseller Account ID is not configured.",
      );
    }

    let imported = 0;
    let updated = 0;
    let skipped = 0;

    const customersPath = fillPath(ctx.config.customersPath, {
      accountId: ctx.config.accountId,
    });
    const customers = await fetchJsonList(ctx, customersPath, "sync_customers");
    for (const raw of customers) {
      const result = await upsertTdCustomer(raw);
      if (result === "created") imported += 1;
      else updated += 1;
    }

    // Subscriptions are optional; only sync if the path is configured.
    let subCount = 0;
    let subErrors = 0;
    const subsPath = ctx.config.subscriptionsPath;
    if (subsPath) {
      const perCustomer = /\{customerNo\}|\{customerId\}/.test(subsPath);
      if (perCustomer) {
        // The subscriptions endpoint is per-customer (…/customers/{customerNo}
        // /subscriptions). Fetch in parallel with a concurrency cap so a large
        // customer base completes well within the serverless time limit.
        const stored = await prisma.tdSynnexCustomer.findMany();
        const CONCURRENCY = 6;
        let cursor = 0;
        const worker = async () => {
          while (cursor < stored.length) {
            const cust = stored[cursor++]!;
            const path = fillPath(subsPath, {
              accountId: ctx.config.accountId,
              customerNo: cust.stellrId,
              customerId: cust.stellrId,
            });
            try {
              const subs = await fetchJsonList(ctx, path, "sync_subscriptions");
              for (const raw of subs) {
                const ok = await upsertTdSubscription(raw, cust.id);
                if (ok) subCount += 1;
                else skipped += 1;
              }
            } catch {
              // Isolate per-customer failures so one bad call doesn't abort all.
              subErrors += 1;
            }
          }
        };
        await Promise.all(
          Array.from({ length: Math.min(CONCURRENCY, stored.length) }, worker),
        );
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
      summary: {
        customers: customers.length,
        subscriptions: subCount,
        subscriptionErrors: subErrors,
      },
    };
  },
};

/**
 * Substitute {token} placeholders in a resource path (e.g. {accountId},
 * {customerNo}) with URL-encoded values. Unknown placeholders are left intact
 * so a misconfigured path surfaces a real error rather than a silent blank.
 */
function fillPath(
  path: string,
  tokens: Record<string, string | null | undefined>,
): string {
  return path.replace(/\{(\w+)\}/g, (match, key: string) => {
    const v = tokens[key];
    return v != null && v !== "" ? encodeURIComponent(v) : match;
  });
}

// ---------------------------------------------------------------------------
// Response parsing + persistence.
//
// The Stellr response envelope and exact field names vary by region/version.
// We read defensively across the common shapes (top-level array, or items/data/
// results/customers/subscriptions wrappers) and map well-known field aliases.
// A wrong path still surfaces the real HTTP error — we never fabricate records.
// ---------------------------------------------------------------------------

const PAGE_SIZE = 100; // Stellr max is 200; 100 is a safe default.
const MAX_PAGES = 1000; // safety cap against pathological loops.

/** Merge pageNo/pageSize into a path that may already contain a query string. */
function withPaging(path: string, pageNo: number): string {
  const [p, q = ""] = path.split("?");
  const sp = new URLSearchParams(q);
  sp.set("pageNo", String(pageNo));
  sp.set("pageSize", String(PAGE_SIZE));
  return `${p}?${sp.toString()}`;
}

/**
 * Fetch ALL pages of a Stellr list endpoint. Always sends pageNo/pageSize
 * (the API returns 0 records without them) and walks pages until the reported
 * `total` is reached or a short page is returned. Emits one diagnostic log line.
 */
async function fetchJsonList(
  ctx: ConnectorContext<StellrConfig, StellrSecrets>,
  path: string,
  action: string,
): Promise<Record<string, unknown>[]> {
  const token = await getStellrAccessToken(ctx.config, ctx.secrets, (next) =>
    ctx.saveSecrets(next),
  );
  const base = ctx.config.apiBaseUrl!.replace(/\/$/, "");
  const env = ctx.config.environment ?? ctx.config.region ?? "unknown";
  let host = "?";
  try {
    host = new URL(base).host;
  } catch {
    /* base not a full URL */
  }

  const isObj = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === "object" && !Array.isArray(v);

  const all: Record<string, unknown>[] = [];
  let total: number | undefined;
  let firstRequestId: string | null = null;
  let lastTopKeys: string[] = [];
  let lastDataKeys: string[] = [];
  let pages = 0;

  for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo += 1) {
    const rel = withPaging(path.startsWith("/") ? path : `/${path}`, pageNo);
    const res = await connectorFetch(`${base}${rel}`, {
      connectorType: "TD_SYNNEX_STELLR",
      connectorId: ctx.connectorId,
      environment: env,
      action,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(
        `TD SYNNEX ${action} failed (HTTP ${res.status}). Verify the resource path.`,
      );
    }
    const parsed = JSON.parse(res.body) as unknown;
    const records = extractArray(parsed);
    pages += 1;

    if (isObj(parsed)) {
      if (firstRequestId === null && typeof parsed.requestId === "string") {
        firstRequestId = parsed.requestId;
      }
      lastTopKeys = Object.keys(parsed);
      if (isObj(parsed.data)) {
        lastDataKeys = Object.keys(parsed.data);
        if (total === undefined && typeof parsed.data.total === "number") {
          total = parsed.data.total;
        }
      }
    }

    all.push(...records);

    // Stop on a short/empty page or once we've collected the reported total.
    if (records.length < PAGE_SIZE) break;
    if (total !== undefined && all.length >= total) break;
  }

  // Single diagnostic line summarizing the whole paged pull (no customer PII).
  await writeDebugLog({
    type: "TD_SYNNEX_STELLR",
    connectorId: ctx.connectorId,
    environment: env,
    action: `${action}_parsed`,
    endpoint: host,
    correlationId: firstRequestId,
    recordsRequested: total,
    recordsReturned: all.length,
    outcome: "success",
    error: `env=${env}; host=${host}; reqId=${firstRequestId ?? "n/a"}; pages=${pages}; parsed ${all.length}${total != null ? `/${total}` : ""} record(s); topKeys=[${lastTopKeys.join(",")}]; dataKeys=[${lastDataKeys.join(",")}]`,
  });

  return all;
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
    serviceAddress: buildAddress(raw),
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

  const productName = pick(raw, ["productName", "name", "description"]);
  const billingFrequency = pick(raw, ["billingFrequency", "billingCycle"]);
  const data = {
    customerId: customer.id,
    // TD SYNNEX SKU identifiers: prefer the Microsoft part number / offer id,
    // fall back to the numeric TD SYNNEX skuNo.
    productSku: pick(raw, [
      "mfgPartNo",
      "offerId",
      "skuNo",
      "sku",
      "productSku",
      "partNumber",
    ]),
    productName,
    vendor: pick(raw, [
      "vendorName",
      "vendor",
      "publisher",
      "manufacturer",
      "mfrName",
      "brand",
    ]),
    quantity: pickNumber(raw, ["quantity", "seats", "qty"]) ?? 0,
    // unitPrice is our reseller cost; customerPrice is the suggested sell price.
    unitCost: pickNumber(raw, ["unitCost", "cost", "unitPrice", "price"]),
    customerPrice: pickNumber(raw, ["customerPrice", "sellPrice", "resellerPrice"]),
    currency: pick(raw, ["currency", "currencyCode"]),
    commitmentTerm: deriveCommitmentTerm(productName, billingFrequency),
    billingFrequency,
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
  return !["inactive", "suspended", "cancelled", "canceled", "disabled", "discontinued"].includes(
    status,
  );
}

/**
 * Build a normalized service address from either a nested address object or
 * the flat address fields Stellr returns (address1, city, state, zipCode, ...).
 */
function buildAddress(
  raw: Record<string, unknown>,
): Prisma.InputJsonValue | undefined {
  if (raw.address && typeof raw.address === "object") {
    return raw.address as Prisma.InputJsonValue;
  }
  if (raw.serviceAddress && typeof raw.serviceAddress === "object") {
    return raw.serviceAddress as Prisma.InputJsonValue;
  }
  const line1 = pick(raw, ["address1", "addressLine1", "street"]);
  const city = pick(raw, ["city"]);
  if (!line1 && !city) return undefined;
  return {
    line1: line1 ?? "",
    line2: pick(raw, ["address2", "addressLine2"]) ?? "",
    city: city ?? "",
    region: pick(raw, ["state", "province", "region"]) ?? "",
    postalCode: pick(raw, ["zipCode", "postalCode", "zip"]) ?? "",
    country: pick(raw, ["country", "countryCode"]) ?? "",
  } as Prisma.InputJsonValue;
}

/** Derive the NCE commitment term from the product name + billing frequency. */
function deriveCommitmentTerm(
  productName: string | null,
  billingFrequency: string | null,
): string | null {
  const n = (productName ?? "").toLowerCase();
  if (n.includes("trienn") || n.includes("3y")) return "triennial";
  if (n.includes("annual") || /\b1y\b/.test(n) || n.includes("annual commit"))
    return "annual";
  if (n.includes("monthly")) return "monthly";
  if (billingFrequency === "one_time") return "one_time";
  if (billingFrequency === "month") return "monthly";
  if (billingFrequency === "annual" || billingFrequency === "year") return "annual";
  return null;
}

function parseDate(raw: Record<string, unknown>, keys: string[]): Date | null {
  const v = pick(raw, keys);
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
