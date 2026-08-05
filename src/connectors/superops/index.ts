import type {
  ConnectorDefinition,
  ConnectorSyncResult,
  ConnectorTestResult,
} from "@/connectors/types";
import {
  superOpsGraphQL,
  describeGraphQLErrors,
  type SuperOpsConfig,
  type SuperOpsSecrets,
} from "@/connectors/superops/client";
import { CLIENT_PROBE_QUERY } from "@/connectors/superops/queries";
import { syncSuperOpsAccountData } from "@/connectors/superops/sync";

/**
 * SuperOps connector.
 *
 * SuperOps exposes a single GraphQL endpoint authenticated with a Bearer API
 * token plus a `CustomerSubDomain` header (region: US api.superops.ai / EU
 * euapi.superops.ai). "Sync Now" pulls account-level data (clients, sites,
 * contacts, assets, contracts, invoices). Tickets + worklogs are a resumable
 * full-history backfill run separately (`runSuperOpsTicketSync`) so the main
 * sync stays within the serverless time limit.
 */
export const superOpsConnector: ConnectorDefinition<
  SuperOpsConfig,
  SuperOpsSecrets
> = {
  type: "SUPEROPS",
  displayName: "SuperOps",
  description: "Sync SuperOps clients, sites, contacts, assets, contracts, tickets, timesheets, and invoices (read-only GraphQL).",
  configFields: [
    {
      key: "subdomain",
      label: "Account Subdomain",
      type: "text",
      required: true,
      secret: false,
      placeholder: "yourcompany",
      helpText: "Sent as the CustomerSubDomain header (Settings → MSP Information).",
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
      helpText: "Generated in SuperOps under My Profile → API Token (one active token per user).",
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
    const res = await superOpsGraphQL(ctx, "test_connection", CLIENT_PROBE_QUERY, {
      input: { page: 1, pageSize: 1 },
    });
    const durationMs = Date.now() - start;
    if (!res.ok) {
      const detail = describeGraphQLErrors(res.errors);
      return {
        ok: false,
        message: `SuperOps GraphQL error (HTTP ${res.status})${detail ? `: ${detail}` : ""}`,
        durationMs,
      };
    }
    return { ok: true, message: "Connected to SuperOps.", durationMs };
  },

  async sync(ctx): Promise<ConnectorSyncResult> {
    const account = await syncSuperOpsAccountData(ctx);
    return {
      imported: account.imported,
      updated: account.updated,
      skipped: account.skipped,
      summary: account.summary as unknown as Record<string, unknown>,
    };
  },
};

/**
 * Run one bounded chunk of the resumable tickets + worklogs backfill. Exposed
 * separately from the connector's `sync()` (which the generic runtime wraps in a
 * single SyncRun) so it can be triggered on demand from the SuperOps Clients
 * page and re-run to continue, and called incrementally from the daily cron.
 */
export { syncSuperOpsTickets } from "@/connectors/superops/sync";
export type { SuperOpsConfig, SuperOpsSecrets } from "@/connectors/superops/client";
