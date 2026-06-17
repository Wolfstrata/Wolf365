import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { connectorFetch } from "@/connectors/http";
import type {
  ConnectorContext,
  ConnectorDefinition,
  ConnectorSyncResult,
  ConnectorTestResult,
} from "@/connectors/types";
import {
  getValidAccessToken,
  qboApiBase,
  type QboEnvironment,
  type QboSecrets,
} from "@/connectors/quickbooks/oauth";

interface QboConfig {
  environment?: QboEnvironment;
}

/**
 * Issue an authenticated QBO API GET and parse the JSON response. Centralizes
 * token handling, base-URL selection, and the minorversion parameter.
 */
async function qboGet(
  ctx: ConnectorContext<QboConfig, QboSecrets>,
  path: string,
  action: string,
): Promise<{ status: number; ok: boolean; json: unknown }> {
  const env = ctx.config.environment ?? "sandbox";
  const accessToken = await getValidAccessToken(ctx.secrets, (next) =>
    ctx.saveSecrets(next),
  );
  const base = qboApiBase(env);
  const url = `${base}${path}${path.includes("?") ? "&" : "?"}minorversion=73`;
  const res = await connectorFetch(url, {
    connectorType: "QUICKBOOKS_ONLINE",
    connectorId: ctx.connectorId,
    environment: env,
    action,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    correlationHeader: "intuit_tid",
  });
  return {
    status: res.status,
    ok: res.ok,
    json: res.body ? JSON.parse(res.body) : null,
  };
}

export const quickbooksConnector: ConnectorDefinition<QboConfig, QboSecrets> = {
  type: "QUICKBOOKS_ONLINE",
  displayName: "QuickBooks Online",
  description:
    "Sync QBO customers and items, and push approved invoices via OAuth 2.0.",
  configFields: [
    {
      key: "environment",
      label: "Environment",
      type: "select",
      required: true,
      secret: false,
      options: [
        { value: "sandbox", label: "Sandbox — testing (sandbox-quickbooks.api.intuit.com)" },
        { value: "production", label: "Production — live invoices (quickbooks.api.intuit.com)" },
      ],
      helpText:
        "Credentials and the QuickBooks connection are stored SEPARATELY per environment. Sandbox needs your Development keys; Production needs Production keys.",
    },
  ],
  secretFields: [
    {
      key: "clientId",
      label: "OAuth Client ID",
      type: "password",
      required: true,
      secret: true,
      helpText: "From your Intuit developer app keys.",
    },
    {
      key: "clientSecret",
      label: "OAuth Client Secret",
      type: "password",
      required: true,
      secret: true,
    },
  ],
  validateReadiness(_config, secrets) {
    const s = secrets as QboSecrets;
    const missing: string[] = [];
    if (!s.clientId) missing.push("OAuth Client ID");
    if (!s.clientSecret) missing.push("OAuth Client Secret");
    if (!s.realmId || !s.refreshToken) {
      missing.push("QuickBooks connection (click Connect QuickBooks)");
    }
    return missing;
  },

  async testConnection(ctx): Promise<ConnectorTestResult> {
    const realmId = ctx.secrets.realmId!;
    const start = Date.now();
    // CompanyInfo is the canonical, side-effect-free probe call.
    const res = await qboGet(
      ctx,
      `/v3/company/${realmId}/companyinfo/${realmId}`,
      "test_connection",
    );
    const durationMs = Date.now() - start;
    if (!res.ok) {
      return {
        ok: false,
        message: `QuickBooks returned HTTP ${res.status} for CompanyInfo`,
        durationMs,
      };
    }
    const company = (res.json as { CompanyInfo?: { CompanyName?: string } })
      ?.CompanyInfo;
    return {
      ok: true,
      message: `Connected to "${company?.CompanyName ?? realmId}"`,
      details: { realmId, companyName: company?.CompanyName ?? "" },
      durationMs,
    };
  },

  async sync(ctx): Promise<ConnectorSyncResult> {
    const realmId = ctx.secrets.realmId!;
    let imported = 0;
    let updated = 0;
    const skipped = 0;

    // --- Customers (paged via QBO query language) ---------------------------
    let startPosition = 1;
    const pageSize = 100;
    for (;;) {
      const query = encodeURIComponent(
        `select * from Customer startposition ${startPosition} maxresults ${pageSize}`,
      );
      const res = await qboGet(
        ctx,
        `/v3/company/${realmId}/query?query=${query}`,
        "sync_customers",
      );
      if (!res.ok) {
        throw new Error(`QBO customer query failed (HTTP ${res.status})`);
      }
      const customers =
        (res.json as { QueryResponse?: { Customer?: QboCustomerRaw[] } })
          ?.QueryResponse?.Customer ?? [];
      if (customers.length === 0) break;

      for (const c of customers) {
        const result = await upsertQboCustomer(realmId, c);
        if (result === "created") imported += 1;
        else updated += 1;
      }
      if (customers.length < pageSize) break;
      startPosition += pageSize;
    }

    // --- Items (products/services) for invoice lines + SKU mapping ----------
    let itemStart = 1;
    for (;;) {
      const query = encodeURIComponent(
        `select * from Item startposition ${itemStart} maxresults ${pageSize}`,
      );
      const res = await qboGet(
        ctx,
        `/v3/company/${realmId}/query?query=${query}`,
        "sync_items",
      );
      if (!res.ok) break; // items are best-effort; customers already synced
      const items =
        (res.json as { QueryResponse?: { Item?: QboItemRaw[] } })?.QueryResponse
          ?.Item ?? [];
      if (items.length === 0) break;
      for (const it of items) {
        const result = await upsertQboItem(realmId, it);
        if (result === "created") imported += 1;
        else updated += 1;
      }
      if (items.length < pageSize) break;
      itemStart += pageSize;
    }

    return {
      imported,
      updated,
      skipped,
      summary: { entity: "customers+items", realmId },
    };
  },
};

interface QboItemRaw {
  Id: string;
  Name?: string;
  FullyQualifiedName?: string;
  Type?: string;
  UnitPrice?: number;
  Active?: boolean;
}

async function upsertQboItem(
  realmId: string,
  it: QboItemRaw,
): Promise<"created" | "updated"> {
  const existing = await prisma.qboItem.findUnique({ where: { qboId: it.Id } });
  const data = {
    realmId,
    name: it.Name ?? `Item ${it.Id}`,
    fullyQualifiedName: it.FullyQualifiedName ?? null,
    type: it.Type ?? null,
    unitPrice: it.UnitPrice ?? null,
    active: it.Active ?? true,
    raw: it as unknown as Prisma.InputJsonValue,
    lastSyncedAt: new Date(),
  };
  if (existing) {
    await prisma.qboItem.update({ where: { qboId: it.Id }, data });
    return "updated";
  }
  await prisma.qboItem.create({ data: { qboId: it.Id, ...data } });
  return "created";
}

interface QboCustomerRaw {
  Id: string;
  DisplayName?: string;
  CompanyName?: string;
  PrimaryEmailAddr?: { Address?: string };
  BillAddr?: Record<string, unknown>;
  Taxable?: boolean;
  CurrencyRef?: { value?: string };
  SalesTermRef?: { name?: string };
  Active?: boolean;
}

/** Upsert a QBO customer snapshot. Returns whether it was created or updated. */
async function upsertQboCustomer(
  realmId: string,
  c: QboCustomerRaw,
): Promise<"created" | "updated"> {
  const existing = await prisma.qboCustomer.findUnique({
    where: { qboId: c.Id },
  });
  const data = {
    realmId,
    displayName: c.DisplayName ?? c.CompanyName ?? `Customer ${c.Id}`,
    companyName: c.CompanyName ?? null,
    billingEmail: c.PrimaryEmailAddr?.Address ?? null,
    billingAddress: (c.BillAddr ?? undefined) as Prisma.InputJsonValue | undefined,
    taxable: c.Taxable ?? null,
    currency: c.CurrencyRef?.value ?? null,
    paymentTerms: c.SalesTermRef?.name ?? null,
    active: c.Active ?? true,
    raw: c as unknown as Prisma.InputJsonValue,
    lastSyncedAt: new Date(),
  };
  if (existing) {
    await prisma.qboCustomer.update({ where: { qboId: c.Id }, data });
    return "updated";
  }
  await prisma.qboCustomer.create({ data: { qboId: c.Id, ...data } });
  return "created";
}
