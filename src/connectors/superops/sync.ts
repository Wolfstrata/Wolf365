import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeDebugLog } from "@/lib/debug-log";
import {
  superOpsGraphQL,
  describeGraphQLErrors,
  introspectTypeFields,
  type SuperOpsCtx,
} from "@/connectors/superops/client";
import * as Q from "@/connectors/superops/queries";
import {
  firstObjectArray,
  pick,
  pickNum,
  pickDate,
  isObj,
  parseClient,
  parseSite,
  parseContact,
  parseAsset,
  parseContract,
  parseTicket,
  parseWorklog,
  type Obj,
} from "@/connectors/superops/parse";

const PAGE_SIZE = 100;
const MAX_PAGES = 1000; // safety cap against pathological loops

type Counts = { imported: number; updated: number; skipped: number; error?: string };

const zero = (): Counts => ({ imported: 0, updated: 0, skipped: 0 });

/** Emit one redacted summary log line per entity pull (no PII). */
async function logEntity(
  ctx: SuperOpsCtx,
  action: string,
  counts: Counts,
): Promise<void> {
  await writeDebugLog({
    type: "SUPEROPS",
    connectorId: ctx.connectorId,
    action: `${action}_parsed`,
    endpoint: "api.superops.ai/msp",
    outcome: counts.error ? "failure" : "success",
    recordsCreated: counts.imported,
    recordsUpdated: counts.updated,
    recordsSkipped: counts.skipped,
    error: counts.error,
  });
}

/** Default GraphQL input: ListInfoInput-shaped `{ page, pageSize }`. */
const listInfoInput = (page: number, pageSize: number): Record<string, unknown> => ({
  page,
  pageSize,
});
/** Get*Input-shaped input that wraps pagination under `listInfo`. */
const wrappedListInfoInput = (page: number, pageSize: number): Record<string, unknown> => ({
  listInfo: { page, pageSize },
});

/** Fetch every page of a SuperOps list query, defensively unwrapping the array. */
async function fetchAll(
  ctx: SuperOpsCtx,
  action: string,
  query: string,
  buildInput: (page: number, pageSize: number) => Record<string, unknown> = listInfoInput,
): Promise<Obj[]> {
  const all: Obj[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const res = await superOpsGraphQL(ctx, action, query, {
      input: buildInput(page, PAGE_SIZE),
    });
    if (!res.ok) {
      throw new Error(
        `SuperOps ${action} failed (HTTP ${res.status})${res.errors ? `: ${describeGraphQLErrors(res.errors)}` : ""}`,
      );
    }
    const records = firstObjectArray(res.data) ?? [];
    all.push(...records);
    if (records.length < PAGE_SIZE) break;
  }
  return all;
}

/**
 * One-time schema diagnostic: introspect the field names of the types whose
 * enrichment fields we couldn't confirm (WorklogEntry id/time/date, ClientSite
 * timezone, ClientContract name, InvoiceItem description) and write them to the
 * debug-log viewer so the exact names can be wired up without guessing. No-ops
 * gracefully if the tenant disables introspection.
 */
async function logSchemaFields(ctx: SuperOpsCtx): Promise<void> {
  for (const typeName of ["WorklogEntry", "ClientSite", "ClientContract", "InvoiceItem"]) {
    try {
      const fields = await introspectTypeFields(ctx, typeName);
      await writeDebugLog({
        type: "SUPEROPS",
        connectorId: ctx.connectorId,
        action: `introspect_${typeName}`,
        endpoint: "api.superops.ai/msp",
        outcome: fields ? "success" : "failure",
        error: fields ? fields.join(", ") : "introspection unavailable for this type",
      });
    } catch {
      /* best-effort diagnostic */
    }
  }
}

/** Map SuperOps accountId -> internal SuperOpsClient.id. */
async function accountMap(): Promise<Map<string, string>> {
  const rows = await prisma.superOpsClient.findMany({
    select: { superOpsId: true, id: true },
  });
  return new Map(rows.map((r) => [r.superOpsId, r.id]));
}

// ---------------------------------------------------------------------------
// Clients (enriched)
// ---------------------------------------------------------------------------

export async function syncSuperOpsClients(ctx: SuperOpsCtx): Promise<Counts> {
  const counts = zero();
  const records = await fetchAll(ctx, "sync_clients", Q.CLIENT_LIST_QUERY);
  for (const raw of records) {
    const p = parseClient(raw);
    if (!p) {
      counts.skipped += 1;
      continue;
    }
    const data = {
      name: p.name,
      stage: p.stage,
      status: p.status,
      accountManager: p.accountManager,
      emailDomains: p.emailDomains,
      raw: raw as unknown as Prisma.InputJsonValue,
      lastSyncedAt: new Date(),
    };
    const existing = await prisma.superOpsClient.findUnique({
      where: { superOpsId: p.superOpsId },
    });
    if (existing) {
      await prisma.superOpsClient.update({ where: { superOpsId: p.superOpsId }, data });
      counts.updated += 1;
    } else {
      await prisma.superOpsClient.create({ data: { superOpsId: p.superOpsId, ...data } });
      counts.imported += 1;
    }
  }
  await logEntity(ctx, "sync_clients", counts);
  return counts;
}

// ---------------------------------------------------------------------------
// Account-level child entities (require a synced parent client)
// ---------------------------------------------------------------------------

export async function syncSuperOpsSites(ctx: SuperOpsCtx, clients: Map<string, string>): Promise<Counts> {
  const counts = zero();
  const records = await fetchAll(ctx, "sync_sites", Q.SITE_LIST_QUERY, wrappedListInfoInput);
  for (const raw of records) {
    const p = parseSite(raw);
    const accountId = isObj(raw.client) ? pick(raw.client, ["accountId", "id"]) : pick(raw, ["accountId"]);
    const parent = accountId ? clients.get(accountId) : undefined;
    if (!p || !parent) {
      counts.skipped += 1;
      continue;
    }
    const data = {
      superOpsClientId: parent,
      name: p.name,
      timezone: p.timezone,
      address: (p.address ?? undefined) as Prisma.InputJsonValue | undefined,
      raw: raw as unknown as Prisma.InputJsonValue,
      lastSyncedAt: new Date(),
    };
    await prisma.superOpsSite.upsert({
      where: { superOpsId: p.superOpsId },
      create: { superOpsId: p.superOpsId, ...data },
      update: data,
    });
    counts.updated += 1;
  }
  await logEntity(ctx, "sync_sites", counts);
  return counts;
}

export async function syncSuperOpsContacts(ctx: SuperOpsCtx, clients: Map<string, string>): Promise<Counts> {
  const counts = zero();
  const records = await fetchAll(ctx, "sync_contacts", Q.CONTACT_LIST_QUERY, wrappedListInfoInput);
  for (const raw of records) {
    const p = parseContact(raw);
    const accountId = isObj(raw.client) ? pick(raw.client, ["accountId", "id"]) : pick(raw, ["accountId"]);
    const parent = accountId ? clients.get(accountId) : undefined;
    if (!p || !parent) {
      counts.skipped += 1;
      continue;
    }
    const data = {
      superOpsClientId: parent,
      name: p.name,
      email: p.email,
      phone: p.phone,
      role: p.role,
      raw: raw as unknown as Prisma.InputJsonValue,
      lastSyncedAt: new Date(),
    };
    await prisma.superOpsContact.upsert({
      where: { superOpsId: p.superOpsId },
      create: { superOpsId: p.superOpsId, ...data },
      update: data,
    });
    counts.updated += 1;
  }
  await logEntity(ctx, "sync_contacts", counts);
  return counts;
}

export async function syncSuperOpsAssets(ctx: SuperOpsCtx, clients: Map<string, string>): Promise<Counts> {
  const counts = zero();
  const records = await fetchAll(ctx, "sync_assets", Q.ASSET_LIST_QUERY);
  for (const raw of records) {
    const p = parseAsset(raw);
    const accountId = isObj(raw.client) ? pick(raw.client, ["accountId", "id"]) : pick(raw, ["accountId"]);
    const parent = accountId ? clients.get(accountId) : undefined;
    if (!p || !parent) {
      counts.skipped += 1;
      continue;
    }
    const data = {
      superOpsClientId: parent,
      name: p.name,
      serialNumber: p.serialNumber,
      platform: p.platform,
      status: p.status,
      lastCommunicatedTime: p.lastCommunicatedTime,
      raw: raw as unknown as Prisma.InputJsonValue,
      lastSyncedAt: new Date(),
    };
    await prisma.superOpsAsset.upsert({
      where: { superOpsId: p.superOpsId },
      create: { superOpsId: p.superOpsId, ...data },
      update: data,
    });
    counts.updated += 1;
  }
  await logEntity(ctx, "sync_assets", counts);
  return counts;
}

export async function syncSuperOpsContracts(ctx: SuperOpsCtx, clients: Map<string, string>): Promise<Counts> {
  const counts = zero();
  const records = await fetchAll(ctx, "sync_contracts", Q.CONTRACT_LIST_QUERY);
  for (const raw of records) {
    const p = parseContract(raw);
    const accountId = isObj(raw.client) ? pick(raw.client, ["accountId", "id"]) : pick(raw, ["accountId"]);
    const parent = accountId ? clients.get(accountId) : undefined;
    if (!p || !parent) {
      counts.skipped += 1;
      continue;
    }
    const data = {
      superOpsClientId: parent,
      name: p.name,
      status: p.status,
      startDate: p.startDate,
      endDate: p.endDate,
      raw: raw as unknown as Prisma.InputJsonValue,
      lastSyncedAt: new Date(),
    };
    await prisma.superOpsContract.upsert({
      where: { superOpsId: p.superOpsId },
      create: { superOpsId: p.superOpsId, ...data },
      update: data,
    });
    counts.updated += 1;
  }
  await logEntity(ctx, "sync_contracts", counts);
  return counts;
}

// ---------------------------------------------------------------------------
// Tickets + worklogs — resumable full-history backfill (bounded per run)
// ---------------------------------------------------------------------------

/** Read the next page to fetch for an entity's backfill (defaults to 1). */
async function nextPage(entity: string): Promise<number> {
  const s = await prisma.superOpsSyncState.findUnique({ where: { entity } });
  const n = s?.cursor ? Number(s.cursor) : 1;
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

async function saveCursor(entity: string, page: number | null, done: boolean): Promise<void> {
  const data = { cursor: page != null ? String(page) : null, completedAt: done ? new Date() : null };
  await prisma.superOpsSyncState.upsert({
    where: { entity },
    create: { entity, ...data },
    update: data,
  });
}

export interface TicketSyncResult {
  tickets: number;
  worklogs: number;
  ticketsDone: boolean;
  worklogsDone: boolean;
  error?: string;
}

/**
 * Resumable backfill of tickets and worklogs. Each call processes a bounded
 * number of pages from a stored page cursor, then checkpoints so a re-run (or
 * the daily cron) continues. Paginates in the tenant's default order (same
 * `{page,pageSize}` shape the working client/invoice sync uses — no unverified
 * sort/condition input). When a short page is reached the cursor resets to 1 and
 * `completedAt` is stamped, so subsequent runs re-scan and pick up updates
 * (upserts dedupe by SuperOps id).
 */
export async function syncSuperOpsTickets(
  ctx: SuperOpsCtx,
  opts: { maxTickets?: number; maxWorklogs?: number } = {},
): Promise<TicketSyncResult> {
  const maxTickets = opts.maxTickets ?? 500;
  const maxWorklogs = opts.maxWorklogs ?? 1000;
  const result: TicketSyncResult = { tickets: 0, worklogs: 0, ticketsDone: false, worklogsDone: false };

  const clients = await accountMap();

  // --- Tickets ---
  try {
    let page = await nextPage("tickets");
    let done = false;
    for (; result.tickets < maxTickets && page <= MAX_PAGES; page += 1) {
      const res = await superOpsGraphQL(ctx, "sync_tickets", Q.TICKET_LIST_QUERY, {
        input: { page, pageSize: PAGE_SIZE },
      });
      if (!res.ok)
        throw new Error(
          `SuperOps sync_tickets failed (HTTP ${res.status})${res.errors ? `: ${describeGraphQLErrors(res.errors)}` : ""}`,
        );
      const records = firstObjectArray(res.data) ?? [];
      for (const raw of records) {
        const p = parseTicket(raw);
        if (!p) continue;
        const soClientId = p.accountId ? clients.get(p.accountId) ?? null : null;
        const data = {
          superOpsClientId: soClientId,
          displayId: p.displayId,
          subject: p.subject,
          status: p.status,
          priority: p.priority,
          technician: p.technician,
          createdTime: p.createdTime,
          updatedTime: p.updatedTime,
          raw: raw as unknown as Prisma.InputJsonValue,
          lastSyncedAt: new Date(),
        };
        await prisma.superOpsTicket.upsert({
          where: { superOpsId: p.superOpsId },
          create: { superOpsId: p.superOpsId, ...data },
          update: data,
        });
        result.tickets += 1;
      }
      if (records.length < PAGE_SIZE) {
        done = true;
        page += 1; // so the checkpoint below records "past the end"
        break;
      }
    }
    await saveCursor("tickets", done ? null : page, done);
    result.ticketsDone = done;
  } catch (err) {
    result.error = err instanceof Error ? err.message : "ticket sync error";
  }

  // --- Worklogs (link to already-synced tickets by SuperOps ticket id) ---
  try {
    const ticketRows = await prisma.superOpsTicket.findMany({
      select: { superOpsId: true, id: true },
    });
    const ticketByExternal = new Map(ticketRows.map((t) => [t.superOpsId, t.id]));

    let page = await nextPage("worklogs");
    let done = false;
    for (; result.worklogs < maxWorklogs && page <= MAX_PAGES; page += 1) {
      const res = await superOpsGraphQL(ctx, "sync_worklogs", Q.WORKLOG_LIST_QUERY, {
        input: { listInfo: { page, pageSize: PAGE_SIZE } },
      });
      if (!res.ok)
        throw new Error(
          `SuperOps sync_worklogs failed (HTTP ${res.status})${res.errors ? `: ${describeGraphQLErrors(res.errors)}` : ""}`,
        );
      const records = firstObjectArray(res.data) ?? [];
      for (const raw of records) {
        const p = parseWorklog(raw);
        if (!p) continue;
        const data = {
          ticketId: p.ticketId ? ticketByExternal.get(p.ticketId) ?? null : null,
          superOpsClientId: p.accountId ? clients.get(p.accountId) ?? null : null,
          technician: p.technician,
          minutes: p.minutes,
          billable: p.billable,
          notes: p.notes,
          entryTime: p.entryTime,
          raw: raw as unknown as Prisma.InputJsonValue,
          lastSyncedAt: new Date(),
        };
        await prisma.superOpsWorklog.upsert({
          where: { superOpsId: p.superOpsId },
          create: { superOpsId: p.superOpsId, ...data },
          update: data,
        });
        result.worklogs += 1;
      }
      if (records.length < PAGE_SIZE) {
        done = true;
        page += 1;
        break;
      }
    }
    await saveCursor("worklogs", done ? null : page, done);
    result.worklogsDone = done;
  } catch (err) {
    result.error = (result.error ? result.error + "; " : "") + (err instanceof Error ? err.message : "worklog sync error");
  }

  await writeDebugLog({
    type: "SUPEROPS",
    connectorId: ctx.connectorId,
    action: "sync_tickets_worklogs",
    endpoint: "api.superops.ai/msp",
    outcome: result.error ? "failure" : "success",
    recordsUpdated: result.tickets + result.worklogs,
    error: result.error,
  });
  return result;
}

// ---------------------------------------------------------------------------
// Invoices (best-effort; overridable query) — moved from the old index.ts.
// ---------------------------------------------------------------------------

export async function syncSuperOpsInvoices(ctx: SuperOpsCtx): Promise<Counts> {
  const counts = zero();
  const query = ctx.config.invoicesQuery?.trim() || Q.INVOICE_LIST_QUERY;

  const soClients = await prisma.superOpsClient.findMany({
    select: { superOpsId: true, clientId: true },
  });
  const clientByAccount = new Map(soClients.map((c) => [c.superOpsId, c.clientId]));

  try {
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const res = await superOpsGraphQL(ctx, "sync_invoices", query, {
        input: { page, pageSize: PAGE_SIZE },
      });
      if (!res.ok) {
        counts.error = `SuperOps invoice query failed (HTTP ${res.status})${res.errors ? `: ${describeGraphQLErrors(res.errors)}` : ""}`;
        break;
      }
      const invoices = firstObjectArray(res.data) ?? [];
      if (invoices.length === 0) break;
      for (const inv of invoices) {
        const r = await upsertSuperOpsInvoice(inv, clientByAccount);
        if (r === "created") counts.imported += 1;
        else if (r === "updated") counts.updated += 1;
        else counts.skipped += 1;
      }
      if (invoices.length < PAGE_SIZE) break;
    }
  } catch (err) {
    counts.error = err instanceof Error ? err.message : "invoice sync error";
  }
  await logEntity(ctx, "sync_invoices", counts);
  return counts;
}

async function upsertSuperOpsInvoice(
  inv: Obj,
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

  const rawLines =
    ["items", "lineItems", "lines", "invoiceItems"]
      .map((k) => (Array.isArray(inv[k]) ? (inv[k] as Obj[]) : null))
      .find(Boolean) ??
    firstObjectArray(inv) ??
    [];

  const lines = rawLines.map((l) => {
    const quantity = pickNum(l, ["quantity", "qty", "units"]) ?? 1;
    const unitPrice = pickNum(l, ["unitPrice", "rate", "price"]) ?? 0;
    const amount = pickNum(l, ["amount", "total", "lineTotal"]) ?? quantity * unitPrice;
    return {
      description: pick(l, ["itemName", "description", "name", "productName"]) ?? "Item",
      quantity,
      unitPrice,
      amount,
      raw: l as unknown as Prisma.InputJsonValue,
    };
  });

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

  const existing = await prisma.superOpsInvoice.findUnique({ where: { superOpsId } });
  if (existing) {
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

// ---------------------------------------------------------------------------
// Account-level orchestration (bounded — fits the main "Sync Now").
// ---------------------------------------------------------------------------

export interface AccountSyncSummary {
  clients: number;
  sites: number;
  contacts: number;
  assets: number;
  contracts: number;
  invoices: number;
  errors: Record<string, string>;
}

/**
 * Sync all account-level SuperOps entities. Clients first (children need the
 * parent map); every other entity is best-effort and isolated so one failure
 * doesn't abort the rest.
 */
export async function syncSuperOpsAccountData(ctx: SuperOpsCtx): Promise<{
  imported: number;
  updated: number;
  skipped: number;
  summary: AccountSyncSummary;
}> {
  const errors: Record<string, string> = {};
  let imported = 0;
  let updated = 0;
  let skipped = 0;

  // One-time schema diagnostic (best-effort) to reveal remaining field names.
  await logSchemaFields(ctx);

  const clientCounts = await syncSuperOpsClients(ctx);
  imported += clientCounts.imported;
  updated += clientCounts.updated;
  skipped += clientCounts.skipped;
  if (clientCounts.error) errors.clients = clientCounts.error;

  const clients = await accountMap();
  const run = async (
    key: keyof AccountSyncSummary,
    fn: (ctx: SuperOpsCtx, clients: Map<string, string>) => Promise<Counts>,
  ): Promise<number> => {
    try {
      const c = await fn(ctx, clients);
      imported += c.imported;
      updated += c.updated;
      skipped += c.skipped;
      if (c.error) errors[key] = c.error;
      return c.imported + c.updated;
    } catch (err) {
      errors[key] = err instanceof Error ? err.message : `${key} sync error`;
      return 0;
    }
  };

  const sites = await run("sites", syncSuperOpsSites);
  const contacts = await run("contacts", syncSuperOpsContacts);
  const assets = await run("assets", syncSuperOpsAssets);
  const contracts = await run("contracts", syncSuperOpsContracts);

  // Invoices don't need the client map argument.
  let invoices = 0;
  try {
    const inv = await syncSuperOpsInvoices(ctx);
    imported += inv.imported;
    updated += inv.updated;
    skipped += inv.skipped;
    invoices = inv.imported + inv.updated;
    if (inv.error) errors.invoices = inv.error;
  } catch (err) {
    errors.invoices = err instanceof Error ? err.message : "invoice sync error";
  }

  return {
    imported,
    updated,
    skipped,
    summary: {
      clients: clientCounts.imported + clientCounts.updated,
      sites,
      contacts,
      assets,
      contracts,
      invoices,
      errors,
    },
  };
}
