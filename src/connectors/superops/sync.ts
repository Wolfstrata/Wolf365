import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeDebugLog } from "@/lib/debug-log";
import {
  superOpsGraphQL,
  describeGraphQLErrors,
  introspectTypeFields,
  introspectQueryReturnType,
  introspectFieldType,
  introspectScalarFieldNames,
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

/** Find `listInfo.totalCount` anywhere in a GraphQL result (the true row count). */
function findTotalCount(data: unknown): number | undefined {
  if (!data || typeof data !== "object") return undefined;
  for (const v of Object.values(data as Record<string, unknown>)) {
    if (v && typeof v === "object") {
      const li = (v as Record<string, unknown>).listInfo;
      if (li && typeof li === "object" && typeof (li as Record<string, unknown>).totalCount === "number") {
        return (li as Record<string, unknown>).totalCount as number;
      }
      const nested = findTotalCount(v);
      if (nested != null) return nested;
    }
  }
  return undefined;
}

/** Stable-ish identity of the first record in a page, to detect non-advancing pagination. */
function firstRecordKey(records: Obj[]): string | undefined {
  const r = records[0];
  if (!r) return undefined;
  return (
    pick(r, [
      "id",
      "accountId",
      "ticketId",
      "contractId",
      "assetId",
      "userId",
      "invoiceId",
      "worklogId",
    ]) ?? JSON.stringify(r).slice(0, 80)
  );
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
  let total: number | undefined;
  let prevKey: string | undefined;
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
    const t = findTotalCount(res.data);
    if (t != null) total = t;
    if (records.length === 0) break; // no more rows

    // Guard: if a page repeats the previous page's first record, the API isn't
    // honoring `page` — stop rather than loop/duplicate.
    const key = firstRecordKey(records);
    if (key !== undefined && key === prevKey) break;
    prevKey = key;

    all.push(...records);

    // Prefer the reported total; fall back to a short page only when it's unknown.
    if (total != null) {
      if (all.length >= total) break;
    } else if (records.length < PAGE_SIZE) {
      break;
    }
  }
  return all;
}

/**
 * Resolve the scalar/enum field names of a list query's item type: query ->
 * return type -> wrapper field's element type -> its scalar fields. Returns null
 * if any introspection step is unavailable (falls back to the static query).
 */
async function resolveScalarSelection(
  ctx: SuperOpsCtx,
  queryName: string,
  wrapper: string,
): Promise<string[] | null> {
  const returnType = await introspectQueryReturnType(ctx, queryName);
  if (!returnType) return null;
  const elemType = await introspectFieldType(ctx, returnType, wrapper);
  if (!elemType) return null;
  return introspectScalarFieldNames(ctx, elemType);
}

/**
 * Build a list query that selects EVERY scalar field of the item type (maximum
 * detail), plus any `extra` nested selection. Falls back to the hand-written
 * static query if introspection is unavailable, so the sync never regresses.
 */
async function buildListQuery(
  ctx: SuperOpsCtx,
  o: { queryName: string; inputType: string; wrapper: string; fallback: string; extra?: string },
): Promise<string> {
  const scalars = await resolveScalarSelection(ctx, o.queryName, o.wrapper);
  if (!scalars || scalars.length === 0) return o.fallback;
  const sel = [scalars.join("\n      "), o.extra].filter(Boolean).join("\n      ");
  return `query ($input: ${o.inputType}!) {
  ${o.queryName}(input: $input) {
    ${o.wrapper} {
      ${sel}
    }
    listInfo { totalCount }
  }
}`;
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
  // Log the actual shape of a ticket's `client` JSON scalar so child→client
  // linkage can be wired to the real id key (accountId? id? bare string?).
  try {
    const res = await superOpsGraphQL(ctx, "sample_ticket", Q.TICKET_LIST_QUERY, {
      input: { page: 1, pageSize: 1 },
    });
    const rec = (firstObjectArray(res.data) ?? [])[0];
    if (rec) {
      await writeDebugLog({
        type: "SUPEROPS",
        connectorId: ctx.connectorId,
        action: "sample_ticket_client_shape",
        endpoint: "api.superops.ai/msp",
        outcome: "success",
        error: `client=${JSON.stringify(rec.client)}`,
      });
    }
  } catch {
    /* best-effort */
  }
}

/** Resolves a child record's parent SuperOpsClient.id from its `client` field. */
export type ClientResolver = (raw: Obj) => string | null;

/**
 * Build a resolver that maps a child record to its parent SuperOpsClient. Tries
 * the client accountId first, then falls back to matching the client name — the
 * name fallback guards against big-integer accountId precision loss (SuperOps
 * account ids exceed JS safe-integer range if ever returned unquoted).
 */
async function buildClientResolver(): Promise<ClientResolver> {
  const rows = await prisma.superOpsClient.findMany({
    select: { superOpsId: true, id: true, name: true },
  });
  const norm = (s: string) => s.trim().toLowerCase();
  const byId = new Map(rows.map((r) => [r.superOpsId, r.id]));
  const byName = new Map(rows.map((r) => [norm(r.name), r.id]));
  return (raw: Obj) => {
    const c = raw.client;
    let accountId: string | null = null;
    let name: string | null = null;
    if (isObj(c)) {
      accountId = pick(c, ["accountId", "id"]);
      name = pick(c, ["name", "companyName"]);
    } else if (typeof c === "string" && c.trim()) {
      accountId = c;
    } else if (typeof c === "number") {
      accountId = String(c);
    }
    if (!accountId) accountId = pick(raw, ["accountId", "clientId"]);
    if (accountId && byId.has(accountId)) return byId.get(accountId) ?? null;
    if (name) {
      const id = byName.get(norm(name));
      if (id) return id;
    }
    return null;
  };
}

// ---------------------------------------------------------------------------
// Clients (enriched)
// ---------------------------------------------------------------------------

export async function syncSuperOpsClients(ctx: SuperOpsCtx): Promise<Counts> {
  const counts = zero();
  const query = await buildListQuery(ctx, {
    queryName: "getClientList",
    inputType: "ListInfoInput",
    wrapper: "clients",
    fallback: Q.CLIENT_LIST_QUERY,
  });
  const records = await fetchAll(ctx, "sync_clients", query);
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

export async function syncSuperOpsSites(ctx: SuperOpsCtx, resolve: ClientResolver): Promise<Counts> {
  const counts = zero();
  const query = await buildListQuery(ctx, {
    queryName: "getClientSiteList",
    inputType: "GetClientSiteListInput",
    wrapper: "sites",
    fallback: Q.SITE_LIST_QUERY,
  });
  const records = await fetchAll(ctx, "sync_sites", query, wrappedListInfoInput);
  for (const raw of records) {
    const p = parseSite(raw);
    const parent = resolve(raw);
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

export async function syncSuperOpsContacts(ctx: SuperOpsCtx, resolve: ClientResolver): Promise<Counts> {
  const counts = zero();
  const query = await buildListQuery(ctx, {
    queryName: "getClientUserList",
    inputType: "GetClientUserListInput",
    wrapper: "userList",
    fallback: Q.CONTACT_LIST_QUERY,
  });
  const records = await fetchAll(ctx, "sync_contacts", query, wrappedListInfoInput);
  for (const raw of records) {
    const p = parseContact(raw);
    const parent = resolve(raw);
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

export async function syncSuperOpsAssets(ctx: SuperOpsCtx, resolve: ClientResolver): Promise<Counts> {
  const counts = zero();
  const query = await buildListQuery(ctx, {
    queryName: "getAssetList",
    inputType: "ListInfoInput",
    wrapper: "assets",
    fallback: Q.ASSET_LIST_QUERY,
  });
  const records = await fetchAll(ctx, "sync_assets", query);
  for (const raw of records) {
    const p = parseAsset(raw);
    const parent = resolve(raw);
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

export async function syncSuperOpsContracts(ctx: SuperOpsCtx, resolve: ClientResolver): Promise<Counts> {
  const counts = zero();
  const query = await buildListQuery(ctx, {
    queryName: "getClientContractList",
    inputType: "ListInfoInput",
    wrapper: "clientContracts",
    fallback: Q.CONTRACT_LIST_QUERY,
    extra: "contract { name }",
  });
  const records = await fetchAll(ctx, "sync_contracts", query);
  for (const raw of records) {
    const p = parseContract(raw);
    const parent = resolve(raw);
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

  const resolve = await buildClientResolver();
  const ticketQuery = await buildListQuery(ctx, {
    queryName: "getTicketList",
    inputType: "ListInfoInput",
    wrapper: "tickets",
    fallback: Q.TICKET_LIST_QUERY,
  });
  const worklogQuery = await buildListQuery(ctx, {
    queryName: "getWorklogEntries",
    inputType: "GetWorklogEntriesInput",
    wrapper: "entries",
    fallback: Q.WORKLOG_LIST_QUERY,
  });

  // --- Tickets ---
  try {
    let page = await nextPage("tickets");
    let done = false;
    let total: number | undefined;
    let prevKey: string | undefined;
    for (; result.tickets < maxTickets && page <= MAX_PAGES; page += 1) {
      const res = await superOpsGraphQL(ctx, "sync_tickets", ticketQuery, {
        input: { page, pageSize: PAGE_SIZE },
      });
      if (!res.ok)
        throw new Error(
          `SuperOps sync_tickets failed (HTTP ${res.status})${res.errors ? `: ${describeGraphQLErrors(res.errors)}` : ""}`,
        );
      const records = firstObjectArray(res.data) ?? [];
      const t = findTotalCount(res.data);
      if (t != null) total = t;
      if (records.length === 0) {
        done = true;
        page += 1;
        break;
      }
      const key = firstRecordKey(records);
      if (key !== undefined && key === prevKey) {
        done = true;
        page += 1;
        break;
      }
      prevKey = key;
      for (const raw of records) {
        const p = parseTicket(raw);
        if (!p) continue;
        const soClientId = resolve(raw);
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
      if (total != null ? page * PAGE_SIZE >= total : records.length < PAGE_SIZE) {
        done = true;
        page += 1; // checkpoint past the end
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
      select: { superOpsId: true, id: true, superOpsClientId: true },
    });
    // WorklogEntry has no client field — derive the client via the linked ticket.
    const ticketByExternal = new Map(
      ticketRows.map((t) => [t.superOpsId, { id: t.id, clientId: t.superOpsClientId }]),
    );

    let page = await nextPage("worklogs");
    let done = false;
    let total: number | undefined;
    let prevKey: string | undefined;
    for (; result.worklogs < maxWorklogs && page <= MAX_PAGES; page += 1) {
      const res = await superOpsGraphQL(ctx, "sync_worklogs", worklogQuery, {
        input: { listInfo: { page, pageSize: PAGE_SIZE } },
      });
      if (!res.ok)
        throw new Error(
          `SuperOps sync_worklogs failed (HTTP ${res.status})${res.errors ? `: ${describeGraphQLErrors(res.errors)}` : ""}`,
        );
      const records = firstObjectArray(res.data) ?? [];
      const t = findTotalCount(res.data);
      if (t != null) total = t;
      if (records.length === 0) {
        done = true;
        page += 1;
        break;
      }
      const key = firstRecordKey(records);
      if (key !== undefined && key === prevKey) {
        done = true;
        page += 1;
        break;
      }
      prevKey = key;
      for (const raw of records) {
        const p = parseWorklog(raw);
        if (!p) continue;
        const ticket = p.ticketId ? ticketByExternal.get(p.ticketId) : undefined;
        const data = {
          ticketId: ticket?.id ?? null,
          // No client field on a worklog — inherit it from the linked ticket.
          superOpsClientId: ticket?.clientId ?? resolve(raw),
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
      if (total != null ? page * PAGE_SIZE >= total : records.length < PAGE_SIZE) {
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
  let query = ctx.config.invoicesQuery?.trim();
  if (!query) {
    const itemScalars = await introspectScalarFieldNames(ctx, "InvoiceItem");
    const itemSel = (itemScalars && itemScalars.length
      ? itemScalars
      : ["itemId", "details", "quantity", "unitPrice", "amount"]
    ).join(" ");
    query = await buildListQuery(ctx, {
      queryName: "getInvoiceList",
      inputType: "ListInfoInput",
      wrapper: "invoices",
      fallback: Q.INVOICE_LIST_QUERY,
      extra: `items { ${itemSel} }`,
    });
  }

  const soClients = await prisma.superOpsClient.findMany({
    select: { superOpsId: true, clientId: true },
  });
  const clientByAccount = new Map(soClients.map((c) => [c.superOpsId, c.clientId]));

  try {
    let total: number | undefined;
    let prevKey: string | undefined;
    let seen = 0;
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const res = await superOpsGraphQL(ctx, "sync_invoices", query, {
        input: { page, pageSize: PAGE_SIZE },
      });
      if (!res.ok) {
        counts.error = `SuperOps invoice query failed (HTTP ${res.status})${res.errors ? `: ${describeGraphQLErrors(res.errors)}` : ""}`;
        break;
      }
      const invoices = firstObjectArray(res.data) ?? [];
      const t = findTotalCount(res.data);
      if (t != null) total = t;
      if (invoices.length === 0) break;
      const key = firstRecordKey(invoices);
      if (key !== undefined && key === prevKey) break;
      prevKey = key;
      for (const inv of invoices) {
        const r = await upsertSuperOpsInvoice(inv, clientByAccount);
        if (r === "created") counts.imported += 1;
        else if (r === "updated") counts.updated += 1;
        else counts.skipped += 1;
      }
      seen += invoices.length;
      if (total != null ? seen >= total : invoices.length < PAGE_SIZE) break;
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

  const lines = rawLines.filter(isObj).map((l) => {
    const quantity = pickNum(l, ["quantity", "qty", "units"]) ?? 1;
    const unitPrice = pickNum(l, ["unitPrice", "rate", "price"]) ?? 0;
    const amount = pickNum(l, ["amount", "total", "lineTotal"]) ?? quantity * unitPrice;
    return {
      description:
        pick(l, ["details", "itemName", "description", "name", "productName"]) ?? "Item",
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

  const resolve = await buildClientResolver();
  const run = async (
    key: keyof AccountSyncSummary,
    fn: (ctx: SuperOpsCtx, resolve: ClientResolver) => Promise<Counts>,
  ): Promise<number> => {
    try {
      const c = await fn(ctx, resolve);
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
