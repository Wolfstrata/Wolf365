import { CrmLine, CrmStage, CrmOpportunityType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { connectorFetch } from "@/connectors/http";
import { writeDebugLog } from "@/lib/debug-log";
import type {
  ConnectorContext,
  ConnectorDefinition,
  ConnectorSyncResult,
  ConnectorTestResult,
} from "@/connectors/types";
import { CRM_LINES, forecastCategoryForProbability } from "@/lib/crm/constants";
import { computeMarginPercentage } from "@/lib/crm/forecast";
import { commissionAmount } from "@/lib/crm/pricing";
import {
  getSalesforceAuth,
  type SalesforceConfig,
  type SalesforceSecrets,
} from "@/connectors/salesforce/auth";

/**
 * Salesforce connector — import existing Opportunities into the Wolf365 CRM.
 *
 * Auth is OAuth 2.0 client-credentials (see ./auth.ts). The import maps the
 * STANDARD Opportunity fields confidently; anything Salesforce-org-specific
 * (which opportunities count as "Managed Services", whether Amount is monthly /
 * annual / total, the API names of custom Margin & Term fields) is CONFIGURED by
 * the admin rather than guessed — so we never invent a field that may not exist.
 */
export const salesforceConnector: ConnectorDefinition<
  SalesforceConfig,
  SalesforceSecrets
> = {
  type: "SALESFORCE",
  displayName: "Salesforce",
  description:
    "Import existing CRM opportunities (e.g. Managed Services) from Salesforce into the sales forecast.",
  configFields: [
    {
      key: "loginUrl",
      label: "My Domain URL",
      type: "url",
      required: true,
      secret: false,
      placeholder: "https://yourco.my.salesforce.com",
      helpText:
        "Your Salesforce My Domain URL. The connector posts a client-credentials token request to its /services/oauth2/token endpoint.",
    },
    {
      key: "apiVersion",
      label: "API Version",
      type: "text",
      required: false,
      secret: false,
      placeholder: "60.0",
      default: "60.0",
      helpText: "Salesforce REST API version (default 60.0).",
    },
    {
      key: "targetLine",
      label: "Import into CRM line",
      type: "select",
      required: true,
      secret: false,
      options: [
        { value: "MANAGED_SERVICES", label: "Managed Services" },
        { value: "MANAGED_NOC", label: "Managed NOC" },
        { value: "M365", label: "Microsoft 365" },
      ],
      helpText: "Imported opportunities are added to this line of business.",
    },
    {
      key: "soqlFilter",
      label: "Opportunity filter (SOQL WHERE)",
      type: "textarea",
      required: false,
      secret: false,
      placeholder: "Revenue_Type__c = 'Managed Services'",
      default: "Revenue_Type__c = 'Managed Services'",
      helpText:
        "SOQL WHERE clause selecting which opportunities to import (no 'WHERE' keyword). Pre-filled to match by Revenue Type = Managed Services — adjust the custom field's API name if yours differs (check Setup → Object Manager → Opportunity → Fields). Leave blank to import all.",
    },
    {
      key: "defaultOwnerEmail",
      label: "Default owner email",
      type: "text",
      required: true,
      secret: false,
      placeholder: "you@yourco.com",
      helpText:
        "Wolf365 user who owns imported opportunities when the Salesforce owner's email doesn't match a Wolf365 user. Must be an existing Wolf365 user.",
    },
    {
      key: "amountField",
      label: "Amount field",
      type: "text",
      required: false,
      secret: false,
      placeholder: "Amount",
      helpText:
        "Salesforce field to read the deal amount from (default Amount). The Amount is stored as the total contract value (TCV); MRR is derived as TCV ÷ 12.",
    },
    {
      key: "marginField",
      label: "Margin field (optional)",
      type: "text",
      required: false,
      secret: false,
      helpText:
        "Optional Salesforce field holding the total margin amount. Stored as the margin TCV; monthly margin is derived as field ÷ 12. Left blank, margin is imported empty.",
    },
    {
      key: "termField",
      label: "Term field (optional, years)",
      type: "text",
      required: false,
      secret: false,
      helpText:
        "Optional Salesforce field giving the agreement length in YEARS (1–3). Left blank, the default term below is used.",
    },
    {
      key: "defaultTermYears",
      label: "Default term",
      type: "select",
      required: false,
      secret: false,
      options: [
        { value: "1", label: "1 year" },
        { value: "2", label: "2 years" },
        { value: "3", label: "3 years" },
      ],
      default: "1",
      helpText:
        "Agreement length used when no Term field is set. With Amount = Total contract value, this is how the total is split into months (MRR = Amount ÷ 12 ÷ term). Most deals are 1 year; correct any multi-year deals on the opportunity after import.",
    },
  ],
  secretFields: [
    {
      key: "clientId",
      label: "Consumer Key",
      type: "password",
      required: true,
      secret: true,
    },
    {
      key: "clientSecret",
      label: "Consumer Secret",
      type: "password",
      required: true,
      secret: true,
    },
  ],
  validateReadiness(config, secrets) {
    const c = config as SalesforceConfig;
    const s = secrets as SalesforceSecrets;
    const missing: string[] = [];
    if (!c.loginUrl) missing.push("My Domain URL");
    if (!c.defaultOwnerEmail) missing.push("Default owner email");
    if (!s.clientId) missing.push("Consumer Key");
    if (!s.clientSecret) missing.push("Consumer Secret");
    return missing;
  },

  async testConnection(ctx): Promise<ConnectorTestResult> {
    const start = Date.now();
    const auth = await getSalesforceAuth(ctx.config, ctx.secrets, (next) =>
      ctx.saveSecrets(next),
    );
    // Real probe: count opportunities matching the configured filter.
    const where = (ctx.config.soqlFilter ?? "").trim();
    const soql = `SELECT COUNT() FROM Opportunity${where ? ` WHERE ${where}` : ""}`;
    const { totalSize } = await runQuery(ctx, soql, "test_count");
    return {
      ok: true,
      message: `Connected to Salesforce. ${totalSize} matching opportunit${totalSize === 1 ? "y" : "ies"} visible.`,
      details: { instance: hostOf(auth.instanceUrl), matchingOpportunities: totalSize },
      durationMs: Date.now() - start,
    };
  },

  async sync(ctx): Promise<ConnectorSyncResult> {
    const line = resolveLine(ctx.config.targetLine);
    const ownerEmail = (ctx.config.defaultOwnerEmail ?? "").trim().toLowerCase();
    if (!ownerEmail) {
      throw new Error("A default owner email must be configured before importing.");
    }
    const defaultOwner = await prisma.user.findUnique({ where: { email: ownerEmail } });
    if (!defaultOwner) {
      throw new Error(
        `Default owner "${ownerEmail}" is not a Wolf365 user. Add them (sign-in once) or set a different default owner.`,
      );
    }

    // Build an email → Wolf365 user map so we can attribute owners when possible.
    const users = await prisma.user.findMany({
      where: { disabled: false },
      select: { id: true, email: true },
    });
    const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));

    const amountField = (ctx.config.amountField ?? "Amount").trim() || "Amount";
    const marginField = (ctx.config.marginField ?? "").trim();
    const termField = (ctx.config.termField ?? "").trim();
    const defaultTerm = clampTerm(Number(ctx.config.defaultTermYears ?? "1"));
    const where = (ctx.config.soqlFilter ?? "").trim();

    // Standard fields + any configured custom fields (deduped).
    const fields = [
      "Id",
      "Name",
      "Account.Name",
      "StageName",
      "Probability",
      "CloseDate",
      "Type",
      "LeadSource",
      "NextStep",
      "Description",
      "IsClosed",
      "IsWon",
      "Owner.Email",
      amountField,
      ...(marginField ? [marginField] : []),
      ...(termField ? [termField] : []),
    ];
    const soql =
      `SELECT ${[...new Set(fields)].join(", ")} FROM Opportunity` +
      (where ? ` WHERE ${where}` : "") +
      ` ORDER BY CloseDate DESC`;

    const records = await runQueryAll(ctx, soql, "import_opportunities");

    let imported = 0;
    let updated = 0;
    let skipped = 0;

    for (const r of records) {
      const externalId = getStr(r, "Id");
      if (!externalId) {
        skipped += 1;
        continue;
      }

      const termYears = termField
        ? clampTerm(Number(getNum(r, termField) ?? defaultTerm))
        : defaultTerm;

      // The Salesforce Amount IS the total contract value; MRR is TCV ÷ 12.
      // Margin is likewise the total margin, with monthly margin = margin ÷ 12.
      const tcv = getNum(r, amountField);
      const monthlyAmount = tcv != null ? round2(tcv / 12) : null;
      const tcvMargin = marginField ? getNum(r, marginField) : null;
      const monthlyMargin = tcvMargin != null ? round2(tcvMargin / 12) : null;
      const marginPct = computeMarginPercentage(monthlyAmount ?? 0, monthlyMargin ?? 0);
      const commission =
        monthlyAmount != null ? commissionAmount(line, termYears, monthlyAmount) : null;

      const stage = mapStage(r);
      const probability = clampPct(getNum(r, "Probability"), stage);
      const ownerId =
        userByEmail.get((getStr(r, "Owner.Email") ?? "").toLowerCase()) ??
        defaultOwner.id;

      const data = {
        line,
        name: getStr(r, "Name") ?? "(Untitled opportunity)",
        accountName: getStr(r, "Account.Name") ?? "(No account)",
        monthlyAmount,
        monthlyMargin,
        amount: tcv,
        marginAmount: tcvMargin,
        marginPercentage: marginPct,
        commissionAmount: commission,
        termYears,
        billingFrequency: "MONTHLY" as const,
        stage,
        probability,
        forecastCategory: forecastCategoryForProbability(stage, probability),
        closeDate: parseDate(getStr(r, "CloseDate")) ?? new Date(),
        type: mapType(getStr(r, "Type")),
        leadSource: getStr(r, "LeadSource"),
        nextStep: getStr(r, "NextStep"),
        description: getStr(r, "Description"),
      };

      const existing = await prisma.crmOpportunity.findUnique({
        where: { sourceSystem_externalId: { sourceSystem: "salesforce", externalId } },
        select: { id: true },
      });
      if (existing) {
        await prisma.crmOpportunity.update({ where: { id: existing.id }, data });
        updated += 1;
      } else {
        await prisma.crmOpportunity.create({
          data: { ...data, sourceSystem: "salesforce", externalId, ownerId },
        });
        imported += 1;
      }
    }

    return {
      imported,
      updated,
      skipped,
      summary: { line, fetched: records.length },
    };
  },
};

// ---------------------------------------------------------------------------
// Salesforce REST query helpers.
// ---------------------------------------------------------------------------

interface QueryResponse {
  totalSize: number;
  done: boolean;
  nextRecordsUrl?: string;
  records: Record<string, unknown>[];
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "?";
  }
}

function apiVersion(ctx: ConnectorContext<SalesforceConfig, SalesforceSecrets>): string {
  return (ctx.config.apiVersion ?? "60.0").trim().replace(/^v/i, "") || "60.0";
}

/**
 * Perform an authenticated GET, retrying ONCE on 401 with a force-refreshed
 * token. Salesforce client-credentials tokens can expire before our cache
 * window (org session policy), so a 401 means "re-auth and try again", not
 * "give up". `buildUrl` is given the (possibly refreshed) instance URL.
 */
async function authedGet(
  ctx: ConnectorContext<SalesforceConfig, SalesforceSecrets>,
  buildUrl: (instanceUrl: string) => string,
  action: string,
): Promise<string> {
  const save = (next: SalesforceSecrets) => ctx.saveSecrets(next);
  let auth = await getSalesforceAuth(ctx.config, ctx.secrets, save);
  let res = await connectorFetch(buildUrl(auth.instanceUrl), {
    connectorType: "SALESFORCE",
    connectorId: ctx.connectorId,
    action,
    headers: { Authorization: `Bearer ${auth.accessToken}`, Accept: "application/json" },
    directConnection: true,
  });
  if (res.status === 401) {
    auth = await getSalesforceAuth(ctx.config, ctx.secrets, save, true);
    res = await connectorFetch(buildUrl(auth.instanceUrl), {
      connectorType: "SALESFORCE",
      connectorId: ctx.connectorId,
      action: `${action}_retry`,
      headers: { Authorization: `Bearer ${auth.accessToken}`, Accept: "application/json" },
      directConnection: true,
    });
  }
  if (!res.ok) {
    throw new Error(
      `Salesforce request failed (HTTP ${res.status}). Check credentials, the Run-As user on the connected app, and the filter/field names.`,
    );
  }
  return res.body;
}

/** Run a single SOQL query, returning the parsed first page. */
async function runQuery(
  ctx: ConnectorContext<SalesforceConfig, SalesforceSecrets>,
  soql: string,
  action: string,
): Promise<QueryResponse> {
  const body = await authedGet(
    ctx,
    (instanceUrl) =>
      `${instanceUrl.replace(/\/$/, "")}/services/data/v${apiVersion(ctx)}/query/?q=${encodeURIComponent(soql)}`,
    action,
  );
  return JSON.parse(body) as QueryResponse;
}

/** Run a SOQL query and follow nextRecordsUrl until all records are collected. */
async function runQueryAll(
  ctx: ConnectorContext<SalesforceConfig, SalesforceSecrets>,
  soql: string,
  action: string,
): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  let page = await runQuery(ctx, soql, action);
  all.push(...page.records);

  let guard = 0;
  while (!page.done && page.nextRecordsUrl && guard < 1000) {
    guard += 1;
    const nextPath = page.nextRecordsUrl;
    const body = await authedGet(
      ctx,
      (instanceUrl) => `${instanceUrl.replace(/\/$/, "")}${nextPath}`,
      `${action}_page`,
    );
    page = JSON.parse(body) as QueryResponse;
    all.push(...page.records);
  }

  await writeDebugLog({
    type: "SALESFORCE",
    connectorId: ctx.connectorId,
    action: `${action}_parsed`,
    recordsReturned: all.length,
    outcome: "success",
    error: `fetched ${all.length} opportunity record(s)`,
  });
  return all;
}

// ---------------------------------------------------------------------------
// Field access + mapping (pure).
// ---------------------------------------------------------------------------

/** Read a field that may be a dot path into nested relationship objects. */
function getRaw(record: Record<string, unknown>, path: string): unknown {
  let cur: unknown = record;
  for (const part of path.split(".")) {
    if (cur && typeof cur === "object" && !Array.isArray(cur)) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return cur;
}

function getStr(record: Record<string, unknown>, path: string): string | null {
  const v = getRaw(record, path);
  if (typeof v === "string" && v.trim()) return v;
  if (typeof v === "number") return String(v);
  return null;
}

function getNum(record: Record<string, unknown>, path: string): number | null {
  const v = getRaw(record, path);
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

function resolveLine(value: string | undefined): CrmLine {
  if (value && value in CRM_LINES) return value as CrmLine;
  return "MANAGED_SERVICES";
}

function clampTerm(n: number): number {
  if (!Number.isFinite(n)) return 1;
  const r = Math.round(n);
  return r <= 1 ? 1 : r >= 3 ? 3 : 2;
}

function clampPct(n: number | null, stage: CrmStage): number {
  if (n == null || !Number.isFinite(n)) {
    return stage === "CLOSED_WON" ? 100 : stage === "CLOSED_LOST" ? 0 : 10;
  }
  return Math.max(0, Math.min(100, Math.round(n)));
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Map a Salesforce opportunity to our stage, trusting IsWon/IsClosed first. */
function mapStage(r: Record<string, unknown>): CrmStage {
  if (getRaw(r, "IsWon") === true) return "CLOSED_WON";
  if (getRaw(r, "IsClosed") === true) return "CLOSED_LOST";
  const s = (getStr(r, "StageName") ?? "").toLowerCase();
  if (s.includes("negoti")) return "NEGOTIATION";
  if (s.includes("propos") || s.includes("quote")) return "PROPOSAL";
  if (s.includes("qualif")) return "QUALIFICATION";
  return "PROSPECTING";
}

function mapType(value: string | null): CrmOpportunityType | null {
  const s = (value ?? "").toLowerCase();
  if (!s) return null;
  if (s.includes("renew")) return "RENEWAL";
  if (s.includes("upsell") || s.includes("expansion") || s.includes("existing"))
    return "UPSELL";
  if (s.includes("new")) return "NEW_BUSINESS";
  return null;
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
