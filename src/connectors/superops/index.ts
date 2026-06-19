import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { connectorFetch } from "@/connectors/http";
import type {
  ConnectorContext,
  ConnectorDefinition,
  ConnectorSyncResult,
  ConnectorTestResult,
} from "@/connectors/types";

/**
 * SuperOps connector.
 *
 * SuperOps exposes a single GraphQL endpoint authenticated with a Bearer API
 * token plus a `CustomerSubDomain` header. Endpoints are region specific:
 *   US: https://api.superops.ai/msp
 *   EU: https://euapi.superops.ai/msp
 * We sync clients for mapping only (no ticket creation — deferred feature).
 */
interface SuperOpsConfig {
  subdomain?: string;
  dataCenter?: "us" | "eu";
  /** Default QBO item id used for invoice lines when pushing to QuickBooks. */
  defaultQboItemId?: string;
  /** Optional override GraphQL query for fetching invoices (advanced). */
  invoicesQuery?: string;
}
interface SuperOpsSecrets {
  apiToken?: string;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** First array-of-objects found in a GraphQL result (top level or one deep). */
function firstObjectArray(obj: unknown): Record<string, unknown>[] | null {
  if (!isObj(obj)) return null;
  for (const v of Object.values(obj)) {
    if (Array.isArray(v) && v.length > 0 && isObj(v[0])) {
      return v as Record<string, unknown>[];
    }
  }
  for (const v of Object.values(obj)) {
    const nested = firstObjectArray(v);
    if (nested) return nested;
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
function pickNum(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number") return v;
    if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  }
  return null;
}
function pickDate(obj: Record<string, unknown>, keys: string[]): Date | null {
  const v = pick(obj, keys);
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function superOpsEndpoint(dc: "us" | "eu" | undefined): string {
  return dc === "eu"
    ? "https://euapi.superops.ai/msp"
    : "https://api.superops.ai/msp";
}

async function superOpsGraphQL(
  ctx: ConnectorContext<SuperOpsConfig, SuperOpsSecrets>,
  action: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data: unknown; errors?: unknown }> {
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
  return {
    ok: res.ok && !parsed.errors,
    status: res.status,
    data: parsed.data,
    errors: parsed.errors,
  };
}

export const superOpsConnector: ConnectorDefinition<
  SuperOpsConfig,
  SuperOpsSecrets
> = {
  type: "SUPEROPS",
  displayName: "SuperOps",
  description: "Sync SuperOps clients for mapping (read-only GraphQL).",
  configFields: [
    {
      key: "subdomain",
      label: "Account Subdomain",
      type: "text",
      required: true,
      secret: false,
      placeholder: "yourcompany",
      helpText: "Sent as the CustomerSubDomain header.",
    },
    {
      key: "dataCenter",
      label: "Data Center",
      type: "select",
      required: true,
      secret: false,
      options: [
        { value: "us", label: "United States (api.superops.ai)" },
        { value: "eu", label: "Europe (euapi.superops.ai)" },
      ],
    },
    {
      key: "defaultQboItemId",
      label: "Default QuickBooks item id (for pushing invoices)",
      type: "text",
      required: false,
      secret: false,
      helpText:
        "QBO item id used for SuperOps invoice lines when pushing to QuickBooks (e.g. a 'Managed Services' service item).",
    },
    {
      key: "invoicesQuery",
      label: "Invoices GraphQL query (advanced, optional)",
      type: "textarea",
      required: false,
      secret: false,
      helpText:
        "Override the default invoice query if your SuperOps schema differs. Leave blank to use the built-in query.",
    },
  ],
  secretFields: [
    {
      key: "apiToken",
      label: "API Token",
      type: "password",
      required: true,
      secret: true,
      helpText: "Generated in SuperOps under My Profile → API Token.",
    },
  ],
  validateReadiness(config, secrets) {
    const c = config as SuperOpsConfig;
    const missing: string[] = [];
    if (!c.subdomain) missing.push("Account Subdomain");
    if (!c.dataCenter) missing.push("Data Center");
    if (!(secrets as SuperOpsSecrets).apiToken) missing.push("API Token");
    return missing;
  },

  async testConnection(ctx): Promise<ConnectorTestResult> {
    const start = Date.now();
    // Request a single client page as a safe read-only probe.
    const res = await superOpsGraphQL(
      ctx,
      "test_connection",
      CLIENT_LIST_QUERY,
      { input: { page: 1, pageSize: 1 } },
    );
    const durationMs = Date.now() - start;
    if (!res.ok) {
      return {
        ok: false,
        message: `SuperOps GraphQL error (HTTP ${res.status})`,
        durationMs,
      };
    }
    return { ok: true, message: "Connected to SuperOps.", durationMs };
  },

  async sync(ctx): Promise<ConnectorSyncResult> {
    let imported = 0;
    let updated = 0;
    let page = 1;
    const pageSize = 100;

    for (;;) {
      const res = await superOpsGraphQL(ctx, "sync_clients", CLIENT_LIST_QUERY, {
        input: { page, pageSize },
      });
      if (!res.ok) throw new Error(`SuperOps client sync failed (HTTP ${res.status})`);
      const clients =
        (res.data as { getClientList?: { clients?: SuperOpsClientRaw[] } })
          ?.getClientList?.clients ?? [];
      if (clients.length === 0) break;

      for (const c of clients) {
        const existing = await prisma.superOpsClient.findUnique({
          where: { superOpsId: String(c.accountId) },
        });
        const data = {
          name: c.name,
          raw: c as unknown as Prisma.InputJsonValue,
          lastSyncedAt: new Date(),
        };
        if (existing) {
          await prisma.superOpsClient.update({
            where: { superOpsId: String(c.accountId) },
            data,
          });
          updated += 1;
        } else {
          await prisma.superOpsClient.create({
            data: { superOpsId: String(c.accountId), ...data },
          });
          imported += 1;
        }
      }
      if (clients.length < pageSize) break;
      page += 1;
    }

    // Invoices (best-effort): import SuperOps invoices for the review/push
    // workflow. A failure here does not abort client sync.
    const invoiceResult = await syncSuperOpsInvoices(ctx);

    return {
      imported: imported + invoiceResult.imported,
      updated: updated + invoiceResult.updated,
      skipped: invoiceResult.skipped,
      summary: {
        clients: imported + updated,
        invoices: invoiceResult.imported + invoiceResult.updated,
        invoiceError: invoiceResult.error,
      },
    };
  },
};

/**
 * Import SuperOps invoices defensively. The exact GraphQL schema varies by
 * tenant, so we run a best-effort query (overridable in config), read the
 * invoice + line arrays from wherever they appear, and map well-known field
 * aliases. Errors are caught and reported in the summary (never abort clients).
 */
async function syncSuperOpsInvoices(
  ctx: ConnectorContext<SuperOpsConfig, SuperOpsSecrets>,
): Promise<{ imported: number; updated: number; skipped: number; error?: string }> {
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  const query = ctx.config.invoicesQuery?.trim() || INVOICE_LIST_QUERY;

  // Map SuperOps accountId -> Wolf365 clientId via stored SuperOps clients.
  const soClients = await prisma.superOpsClient.findMany({
    select: { superOpsId: true, clientId: true },
  });
  const clientByAccount = new Map(
    soClients.map((c) => [c.superOpsId, c.clientId]),
  );

  let page = 1;
  const pageSize = 100;
  try {
    for (;;) {
      const res = await superOpsGraphQL(ctx, "sync_invoices", query, {
        input: { page, pageSize },
      });
      if (!res.ok) {
        return {
          imported,
          updated,
          skipped,
          error: `SuperOps invoice query failed (HTTP ${res.status})`,
        };
      }
      const invoices = firstObjectArray(res.data) ?? [];
      if (invoices.length === 0) break;

      for (const inv of invoices) {
        const result = await upsertSuperOpsInvoice(inv, clientByAccount);
        if (result === "created") imported += 1;
        else if (result === "updated") updated += 1;
        else skipped += 1;
      }
      if (invoices.length < pageSize) break;
      page += 1;
    }
  } catch (err) {
    return {
      imported,
      updated,
      skipped,
      error: err instanceof Error ? err.message : "invoice sync error",
    };
  }
  return { imported, updated, skipped };
}

async function upsertSuperOpsInvoice(
  inv: Record<string, unknown>,
  clientByAccount: Map<string, string | null>,
): Promise<"created" | "updated" | "skipped"> {
  const superOpsId = pick(inv, ["invoiceId", "id", "displayId", "invoiceNumber"]);
  if (!superOpsId) return "skipped";

  const accountId = isObj(inv.client)
    ? pick(inv.client, ["accountId", "id"])
    : pick(inv, ["accountId", "clientId"]);
  const clientName = isObj(inv.client)
    ? pick(inv.client, ["name", "companyName"])
    : pick(inv, ["clientName", "companyName"]);
  const clientId = accountId ? (clientByAccount.get(accountId) ?? null) : null;

  // Find the line-item array within the invoice object.
  const rawLines =
    (["items", "lineItems", "lines", "invoiceItems"]
      .map((k) => (Array.isArray(inv[k]) ? (inv[k] as Record<string, unknown>[]) : null))
      .find(Boolean)) ?? firstObjectArray(inv) ?? [];

  const lines = rawLines.map((l) => {
    const quantity = pickNum(l, ["quantity", "qty", "units"]) ?? 1;
    const unitPrice = pickNum(l, ["unitPrice", "rate", "price"]) ?? 0;
    const amount =
      pickNum(l, ["amount", "total", "lineTotal"]) ?? quantity * unitPrice;
    return {
      description:
        pick(l, ["itemName", "description", "name", "productName"]) ?? "Item",
      quantity,
      unitPrice,
      amount,
      raw: l as unknown as Prisma.InputJsonValue,
    };
  });

  // Totals: prefer explicit fields; otherwise derive from the line amounts.
  const linesTotal = lines.reduce((a, l) => a + l.amount, 0);
  const total = pickNum(inv, ["totalAmount", "total", "grandTotal", "amount"]);
  const data = {
    clientId,
    superOpsClientName: clientName,
    invoiceNumber: pick(inv, ["displayId", "invoiceNumber", "number"]),
    status: pick(inv, ["statusEnum", "status", "state"]),
    invoiceDate: pickDate(inv, ["invoiceDate", "date", "createdTime", "generatedDate"]),
    dueDate: pickDate(inv, ["dueDate", "paymentDueDate"]),
    currency: pick(inv, ["currency", "currencyCode"]),
    subtotal: pickNum(inv, ["subTotalAmount", "subtotal", "subTotal"]),
    tax: pickNum(inv, ["taxAmount", "tax", "totalTax"]),
    total: total ?? (linesTotal > 0 ? linesTotal : null),
    raw: inv as unknown as Prisma.InputJsonValue,
    lastSyncedAt: new Date(),
  };

  const existing = await prisma.superOpsInvoice.findUnique({
    where: { superOpsId },
  });
  if (existing) {
    // Replace lines wholesale to reflect the latest SuperOps state, but keep
    // the Wolf365 review/push status.
    await prisma.$transaction([
      prisma.superOpsInvoiceLine.deleteMany({ where: { invoiceId: existing.id } }),
      prisma.superOpsInvoice.update({
        where: { superOpsId },
        data: { ...data, lines: { create: lines } },
      }),
    ]);
    return "updated";
  }
  await prisma.superOpsInvoice.create({
    data: { superOpsId, ...data, lines: { create: lines } },
  });
  return "created";
}

interface SuperOpsClientRaw {
  accountId: string;
  name: string;
}

// SuperOps client list query. Field/argument names follow the documented MSP
// schema; if the tenant's schema differs the real GraphQL error surfaces.
const CLIENT_LIST_QUERY = `
query getClientList($input: ListInfoInput!) {
  getClientList(input: $input) {
    clients { accountId name }
    listInfo { totalCount }
  }
}`;

// Best-effort invoice query. SuperOps' invoice schema varies by tenant; if this
// doesn't match, override it via the connector's "Invoices GraphQL query" field
// and the defensive parser will still extract invoices/lines from the result.
const INVOICE_LIST_QUERY = `
query getInvoiceList($input: ListInfoInput!) {
  getInvoiceList(input: $input) {
    invoices {
      invoiceId
      displayId
      statusEnum
      invoiceDate
      dueDate
      client { accountId name }
      subTotalAmount
      taxAmount
      totalAmount
      items { itemName quantity unitPrice amount }
    }
    listInfo { totalCount }
  }
}`;
