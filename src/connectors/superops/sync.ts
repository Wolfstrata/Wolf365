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
  introspectTypeFieldsDetailed,
  introspectInputFields,
  type SuperOpsCtx,
} from "@/connectors/superops/client";
import * as Q from "@/connectors/superops/queries";
import { extractEmbeddedNotes, parseNote } from "@/lib/silverfang/ticket-notes";
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

/** Resolve a list query's item type: query -> return type -> wrapper element type. */
async function resolveElementType(
  ctx: SuperOpsCtx,
  queryName: string,
  wrapper: string,
): Promise<string | null> {
  const returnType = await introspectQueryReturnType(ctx, queryName);
  if (!returnType) return null;
  return introspectFieldType(ctx, returnType, wrapper);
}

/**
 * Recursively build a GraphQL selection for a type: all its scalar/enum fields,
 * plus nested object fields expanded to `depth` more levels (so nested detail
 * like contract billing/line-item amounts is pulled). Skips fields that require
 * arguments and guards against type cycles. Depth-limited to bound query size.
 */
async function buildTypeSelection(
  ctx: SuperOpsCtx,
  typeName: string,
  depth: number,
  seen: Set<string>,
): Promise<string> {
  const fields = await introspectTypeFieldsDetailed(ctx, typeName);
  if (!fields) return "";
  const parts: string[] = [];
  for (const f of fields) {
    if (f.requiredArgs) continue;
    if (f.base.kind === "SCALAR" || f.base.kind === "ENUM") {
      parts.push(f.name);
    } else if (f.base.kind === "OBJECT" && depth > 0 && f.base.name && !seen.has(f.base.name)) {
      const sub = await buildTypeSelection(ctx, f.base.name, depth - 1, new Set([...seen, f.base.name]));
      if (sub) parts.push(`${f.name} { ${sub} }`);
    }
  }
  return parts.join(" ");
}

/**
 * Build a list query for maximum detail. Selects every scalar field of the item
 * type; when `depth`/`extra` enrich it with nested objects, the richer query is
 * validated with a 1-record probe and used only if the tenant accepts it —
 * otherwise it falls back to the flat scalar query, then the static query. So a
 * too-complex enrichment can never break a working entity.
 */
async function buildListQuery(
  ctx: SuperOpsCtx,
  o: {
    queryName: string;
    inputType: string;
    wrapper: string;
    fallback: string;
    extra?: string;
    depth?: number;
    buildInput?: (page: number, pageSize: number) => Record<string, unknown>;
  },
): Promise<string> {
  const elemType = await resolveElementType(ctx, o.queryName, o.wrapper);
  if (!elemType) return o.fallback;
  const buildInput = o.buildInput ?? listInfoInput;
  const wrap = (sel: string) =>
    `query ($input: ${o.inputType}!) { ${o.queryName}(input: $input) { ${o.wrapper} { ${sel} } listInfo { totalCount } } }`;

  const scalars = await introspectScalarFieldNames(ctx, elemType);
  const flatQuery = scalars && scalars.length ? wrap(scalars.join(" ")) : o.fallback;

  // Build the enriched candidate (deep nested selection and/or an explicit extra).
  let candidateSel = "";
  if (o.depth && o.depth >= 1) {
    candidateSel = await buildTypeSelection(ctx, elemType, o.depth, new Set([elemType]));
  } else if (scalars && scalars.length) {
    candidateSel = scalars.join(" ");
  }
  candidateSel = [candidateSel, o.extra].filter(Boolean).join(" ");
  if (!candidateSel.trim() || (!o.depth && !o.extra)) return flatQuery;

  // Probe the richer query with a single record; use it only if accepted.
  const candidate = wrap(candidateSel);
  try {
    const res = await superOpsGraphQL(ctx, `${o.queryName}_probe`, candidate, {
      input: buildInput(1, 1),
    });
    if (res.ok) return candidate;
  } catch {
    /* fall through to flat */
  }
  return flatQuery;
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
    if (!accountId) accountId = pick(raw, ["accountId", "clientId", "clientAccountId"]);
    if (!name) name = pick(raw, ["clientName", "companyName"]);
    // Some child records carry the client only via their site.
    const site = raw.site;
    if ((!accountId || !byId.has(accountId)) && isObj(site)) {
      const siteClient = site.client;
      if (isObj(siteClient)) {
        accountId = pick(siteClient, ["accountId", "id"]) ?? accountId;
        name = name ?? pick(siteClient, ["name", "companyName"]);
      } else if (typeof siteClient === "string" && siteClient.trim()) {
        accountId = siteClient;
      }
      name = name ?? pick(site, ["clientName"]);
    }
    if (accountId && byId.has(accountId)) return byId.get(accountId) ?? null;
    if (name) {
      const id = byName.get(norm(name));
      if (id) return id;
    }
    return null;
  };
}

/**
 * Record the *shape* of a record the resolver couldn't place, so a skip storm
 * explains itself instead of costing another sync-and-ask cycle. Field names and
 * the client-ish field structure only — never values, which carry PII.
 */
async function logSkipShape(
  ctx: SuperOpsCtx,
  action: string,
  raw: Obj,
  cause = "could not link record to a client",
): Promise<void> {
  const describe = (v: unknown): string => {
    if (v === undefined) return "absent";
    if (v === null) return "null";
    if (Array.isArray(v)) return `array[${v.length}]`;
    if (isObj(v)) return `object{${Object.keys(v).join(",")}}`;
    return typeof v;
  };
  try {
    await writeDebugLog({
      type: "SUPEROPS",
      connectorId: ctx.connectorId,
      action: `${action}_skip_shape`,
      endpoint: "api.superops.ai/msp",
      outcome: "failure",
      error:
        `${cause}. keys=[${Object.keys(raw).join(",")}] ` +
        `client=${describe(raw.client)} site=${describe(raw.site)} ` +
        `accountId=${describe(raw.accountId)} clientId=${describe(raw.clientId)}`,
    });
  } catch {
    /* best-effort diagnostic */
  }
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

/** How `getClientUserList` can be narrowed to one client. */
interface ClientFilter {
  key: string;
  /** Wrap a client's SuperOps account id into the value the input expects. */
  wrap: (accountId: string) => unknown;
  described: string;
}

/**
 * Work out how to scope the client-user list to a single client.
 *
 * This is needed because the `ClientUser` type carries no client reference at
 * all — confirmed by introspection and by a skipped record's own field list — so
 * a flat list of users cannot be attributed to anyone. The filter is discovered
 * from the input type rather than guessed, and the discovery is logged so a
 * schema that does not support it is visible instead of silent.
 */
async function resolveClientUserFilter(
  ctx: SuperOpsCtx,
  sampleAccountId: string,
): Promise<ClientFilter | null> {
  const fields = await introspectInputFields(ctx, "GetClientUserListInput");
  await writeDebugLog({
    type: "SUPEROPS",
    connectorId: ctx.connectorId,
    action: "introspect_GetClientUserListInput",
    endpoint: "api.superops.ai/msp",
    outcome: fields ? "success" : "failure",
    error: fields
      ? fields
          .map((f) => `${f.name}:${f.base.kind}${f.base.name ? `(${f.base.name})` : ""}`)
          .join(", ")
      : "input introspection unavailable for this type",
  });

  // 1. Schema-driven: any input field whose name mentions a client or account is a
  //    candidate, rather than a fixed list of guessed names — that is what missed
  //    the real field last time. Most specific name first.
  const candidates: ClientFilter[] = [];
  for (const f of fields ?? []) {
    if (!/client|account/i.test(f.name)) continue;
    if (f.base.kind === "INPUT_OBJECT" && f.base.name) {
      const inner = await introspectInputFields(ctx, f.base.name);
      const idKey = inner?.find((i) => /^(accountId|id|clientId)$/i.test(i.name))?.name;
      if (idKey) {
        candidates.push({
          key: f.name,
          wrap: (accountId) => ({ [idKey]: accountId }),
          described: `${f.name}: { ${idKey} }`,
        });
      }
    } else if (f.base.kind === "SCALAR" || f.base.kind === "ENUM") {
      // A plural name almost always wants a list.
      const plural = /s$/i.test(f.name);
      candidates.push({
        key: f.name,
        wrap: (accountId) => (plural ? [accountId] : accountId),
        described: `${f.name}: ${plural ? "[scalar]" : "scalar"}`,
      });
    }
  }

  // 2. Blind fallbacks, only if introspection told us nothing. These are *probed*
  //    below, never assumed, so an unaccepted shape costs one request rather than
  //    silently syncing nothing.
  if (candidates.length === 0) {
    candidates.push(
      { key: "client", wrap: (a) => ({ accountId: a }), described: "client: { accountId }" },
      { key: "clientId", wrap: (a) => a, described: "clientId: scalar" },
      { key: "accountId", wrap: (a) => a, described: "accountId: scalar" },
      { key: "clientIds", wrap: (a) => [a], described: "clientIds: [scalar]" },
    );
  }

  // 3. Accept the first candidate the API actually honours. A filter the server
  //    ignores is worse than none, so require that it also returns a usable page.
  for (const candidate of candidates) {
    const probe = `query ($input: GetClientUserListInput!) { getClientUserList(input: $input) { userList { userId } listInfo { totalCount } } }`;
    try {
      const res = await superOpsGraphQL(ctx, "probe_client_user_filter", probe, {
        input: {
          listInfo: { page: 1, pageSize: 1 },
          [candidate.key]: candidate.wrap(sampleAccountId),
        },
      });
      if (res.ok) {
        await writeDebugLog({
          type: "SUPEROPS",
          connectorId: ctx.connectorId,
          action: "sync_contacts_strategy",
          endpoint: "api.superops.ai/msp",
          outcome: "success",
          error: `per-client fetch using ${candidate.described}`,
        });
        return candidate;
      }
    } catch {
      /* try the next candidate */
    }
  }

  await writeDebugLog({
    type: "SUPEROPS",
    connectorId: ctx.connectorId,
    action: "sync_contacts_strategy",
    endpoint: "api.superops.ai/msp",
    outcome: "failure",
    error:
      `no accepted way to scope getClientUserList to one client; tried ` +
      `${candidates.map((c) => c.described).join(" | ") || "(none)"}. ` +
      `Falling back to the flat fetch, which cannot attribute users to a client.`,
  });
  return null;
}

/** SuperOps allows 100 requests/minute; stay comfortably under it. */
const REQUESTS_PER_MINUTE = 80;
const REQUEST_GAP_MS = Math.ceil(60_000 / REQUESTS_PER_MINUTE);

/**
 * Sync client users (contacts).
 *
 * Fetched per client, because a ClientUser record has no client field: querying
 * the flat list returns every user with nothing to attribute them to, which is
 * why this previously stored none of 164 records. When the schema offers no way
 * to scope the query, this falls back to the flat fetch and reports the skips
 * rather than pretending to have synced.
 */
export async function syncSuperOpsContacts(ctx: SuperOpsCtx, resolve: ClientResolver): Promise<Counts> {
  const counts = zero();
  const clients = await prisma.superOpsClient.findMany({
    select: { id: true, superOpsId: true },
    orderBy: { superOpsId: "asc" },
  });
  const filter = clients[0]
    ? await resolveClientUserFilter(ctx, clients[0].superOpsId)
    : null;

  if (!filter || clients.length === 0) {
    const flat = await syncContactsFlat(ctx, resolve);
    await logEntity(ctx, "sync_contacts", flat);
    return flat;
  }

  // The probe needs a filter value that resolves, so build the query against the
  // first real client rather than a placeholder.
  const probeInput = (page: number, pageSize: number) => ({
    listInfo: { page, pageSize },
    [filter.key]: filter.wrap(clients[0]!.superOpsId),
  });
  const query = await buildListQuery(ctx, {
    queryName: "getClientUserList",
    inputType: "GetClientUserListInput",
    wrapper: "userList",
    fallback: Q.CONTACT_LIST_QUERY,
    depth: 1,
    buildInput: probeInput,
  });

  let loggedShape = false;
  for (const client of clients) {
    const startedAt = Date.now();
    let records: Obj[] = [];
    try {
      records = await fetchAll(ctx, "sync_contacts", query, (page, pageSize) => ({
        listInfo: { page, pageSize },
        [filter.key]: filter.wrap(client.superOpsId),
      }));
    } catch (err) {
      // One client failing must not lose the other 155.
      counts.error = err instanceof Error ? err.message : "contact fetch error";
      continue;
    }

    for (const raw of records) {
      const p = parseContact(raw);
      if (!p) {
        counts.skipped += 1;
        if (!loggedShape) {
          loggedShape = true;
          await logSkipShape(ctx, "sync_contacts", raw);
        }
        continue;
      }
      // Parent is known from the query itself — no resolution, nothing to guess.
      const data = {
        superOpsClientId: client.id,
        name: p.name,
        email: p.email,
        phone: p.phone,
        role: p.role,
        raw: raw as unknown as Prisma.InputJsonValue,
        lastSyncedAt: new Date(),
      };
      const existing = await prisma.superOpsContact.findUnique({
        where: { superOpsId: p.superOpsId },
        select: { id: true },
      });
      if (existing) {
        await prisma.superOpsContact.update({ where: { id: existing.id }, data });
        counts.updated += 1;
      } else {
        await prisma.superOpsContact.create({ data: { superOpsId: p.superOpsId, ...data } });
        counts.imported += 1;
      }
    }

    // Pace the per-client calls so a 156-client tenant cannot trip the API's
    // rate limit partway through and lose the rest.
    const gap = REQUEST_GAP_MS - (Date.now() - startedAt);
    if (gap > 0) await new Promise((r) => setTimeout(r, gap));
  }

  await logEntity(ctx, "sync_contacts", counts);
  return counts;
}

/** Legacy flat fetch, kept as the fallback when the list cannot be scoped. */
async function syncContactsFlat(ctx: SuperOpsCtx, resolve: ClientResolver): Promise<Counts> {
  const counts = zero();
  const query = await buildListQuery(ctx, {
    queryName: "getClientUserList",
    inputType: "GetClientUserListInput",
    wrapper: "userList",
    fallback: Q.CONTACT_LIST_QUERY,
    depth: 1,
    buildInput: wrappedListInfoInput,
  });
  const records = await fetchAll(ctx, "sync_contacts", query, wrappedListInfoInput);
  let loggedShape = false;
  for (const raw of records) {
    const p = parseContact(raw);
    const parent = resolve(raw);
    if (!p || !parent) {
      counts.skipped += 1;
      if (!loggedShape) {
        loggedShape = true;
        await logSkipShape(ctx, "sync_contacts", raw);
      }
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
  return counts;
}

export async function syncSuperOpsAssets(ctx: SuperOpsCtx, resolve: ClientResolver): Promise<Counts> {
  const counts = zero();
  const query = await buildListQuery(ctx, {
    queryName: "getAssetList",
    inputType: "ListInfoInput",
    wrapper: "assets",
    fallback: Q.ASSET_LIST_QUERY,
    // Same reason as contacts: without the nested client the resolver can't place
    // an asset, which is why only one of them ever landed.
    depth: 1,
  });
  const records = await fetchAll(ctx, "sync_assets", query);
  let loggedShape = false;
  for (const raw of records) {
    const p = parseAsset(raw);
    const parent = resolve(raw);
    if (!p || !parent) {
      counts.skipped += 1;
      if (!loggedShape) {
        loggedShape = true;
        await logSkipShape(ctx, "sync_assets", raw);
      }
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
  // The contract's pricing/terms live in the nested `contract` object (and its
  // line items), so expand that object one level deep instead of just its name.
  const contractType = await introspectFieldType(ctx, "ClientContract", "contract");
  const contractSel = contractType
    ? await buildTypeSelection(ctx, contractType, 1, new Set([contractType]))
    : "";
  const query = await buildListQuery(ctx, {
    queryName: "getClientContractList",
    inputType: "ListInfoInput",
    wrapper: "clientContracts",
    fallback: Q.CONTRACT_LIST_QUERY,
    extra: `contract { ${contractSel || "name"} }`,
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
    depth: 1, // pull nested ticket detail (requester, site, status, resolution, …)
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
  /**
   * Records the API returned that could not be stored, per entity. Reported
   * because "0 contacts" and "0 contacts, 312 skipped" are completely different
   * problems and used to look identical.
   */
  skippedByEntity: Record<string, number>;
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
  const skippedByEntity: Record<string, number> = {};
  const run = async (
    key: keyof AccountSyncSummary,
    fn: (ctx: SuperOpsCtx, resolve: ClientResolver) => Promise<Counts>,
  ): Promise<number> => {
    try {
      const c = await fn(ctx, resolve);
      imported += c.imported;
      updated += c.updated;
      skipped += c.skipped;
      if (c.skipped > 0) skippedByEntity[key] = c.skipped;
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
    if (inv.skipped > 0) skippedByEntity.invoices = inv.skipped;
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
      skippedByEntity: {
        ...(clientCounts.skipped > 0 ? { clients: clientCounts.skipped } : {}),
        ...skippedByEntity,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Ticket conversations / notes
// ---------------------------------------------------------------------------

/**
 * Query names that plausibly return a ticket's conversation, best first.
 *
 * Discovered rather than hardcoded: SuperOps' schema differs between tenants, and
 * a hardcoded name that does not exist fails the whole query. The first one this
 * tenant actually exposes is used.
 */
const NOTE_QUERY_CANDIDATES = [
  "getTicketConversation",
  "getConversationList",
  "getTicketConversationList",
  "getTicketNotes",
  "getNoteList",
  "getTicketComments",
];

/** Every top-level query name this tenant exposes. */
async function queryNames(ctx: SuperOpsCtx): Promise<string[]> {
  const q = `query { __schema { queryType { fields { name } } } }`;
  const res = await superOpsGraphQL(ctx, "introspect_queries", q, {});
  const fields = (
    res.data as { __schema?: { queryType?: { fields?: { name: string }[] } } } | null
  )?.__schema?.queryType?.fields;
  if (!res.ok || !Array.isArray(fields)) return [];
  return fields.map((f) => f.name);
}

export interface NoteSyncResult {
  notes: number;
  ticketsScanned: number;
  /** Notes found already embedded in the ticket JSON, costing no extra call. */
  fromEmbedded: number;
  /** The discovered query name, or null when this tenant exposes none. */
  queryUsed: string | null;
  error?: string;
}

/**
 * Mirror ticket conversations into `SuperOpsTicketNote`.
 *
 * Two paths, in this order:
 *
 *  1. **Embedded.** The ticket query is introspection-built and expands nested
 *     objects, so on many tenants the conversation is already in the stored ticket
 *     JSON. Reading it costs nothing and cannot fail.
 *  2. **Fetched.** For tenants where it is not embedded, the conversation query is
 *     discovered by introspection and called per ticket.
 *
 * When neither yields anything the result says so — `queryUsed: null` with zero
 * notes is "this tenant exposes no conversation API", which is a different problem
 * from "these tickets have no conversation", and the caller reports the difference
 * rather than showing a silent zero.
 */
export async function syncSuperOpsTicketNotes(
  ctx: SuperOpsCtx,
  opts: { maxTickets?: number } = {},
): Promise<NoteSyncResult> {
  const maxTickets = opts.maxTickets ?? 500;
  const result: NoteSyncResult = {
    notes: 0,
    ticketsScanned: 0,
    fromEmbedded: 0,
    queryUsed: null,
  };

  try {
    const tickets = await prisma.superOpsTicket.findMany({
      orderBy: { updatedTime: "desc" },
      take: maxTickets,
      select: { id: true, superOpsId: true, raw: true },
    });
    if (tickets.length === 0) return result;

    // Path 1: whatever is already in the stored ticket JSON.
    const needFetch: { id: string; superOpsId: string }[] = [];
    for (const ticket of tickets) {
      result.ticketsScanned += 1;
      const embedded = extractEmbeddedNotes(ticket.raw, ticket.superOpsId);
      if (embedded.length === 0) {
        needFetch.push({ id: ticket.id, superOpsId: ticket.superOpsId });
        continue;
      }
      for (const note of embedded) {
        await storeNote(ticket.id, note, null);
        result.notes += 1;
        result.fromEmbedded += 1;
      }
    }

    if (needFetch.length === 0) return result;

    // Path 2: discover a conversation query and call it per ticket.
    const available = new Set(await queryNames(ctx));
    const queryName = NOTE_QUERY_CANDIDATES.find((n) => available.has(n)) ?? null;
    result.queryUsed = queryName;
    if (!queryName) return result;

    const returnType = await introspectQueryReturnType(ctx, queryName);
    if (!returnType) return result;
    // The collection field on the return type — its name varies with the query.
    const detail = (await introspectTypeFieldsDetailed(ctx, returnType)) ?? [];
    const listField = detail.find(
      (f) => f.base.kind === "OBJECT" && /conversation|note|comment|repl|message/i.test(f.name),
    );
    const elementType = listField?.base.name ?? returnType;
    const selection = await buildTypeSelection(ctx, elementType, 1, new Set([elementType]));
    if (!selection.trim()) return result;

    const wrapped = listField
      ? `${listField.name} { ${selection} }`
      : selection;
    const query = `query ($id: ID!) { ${queryName}(ticketId: $id) { ${wrapped} } }`;

    for (const ticket of needFetch) {
      const res = await superOpsGraphQL(ctx, "sync_ticket_notes", query, {
        id: ticket.superOpsId,
      });
      // One ticket failing must not abort the run: a migration of thousands
      // cannot be held up by a single unreadable record.
      if (!res.ok) continue;
      const records = firstObjectArray(res.data) ?? [];
      // A plain loop, not forEach: an async callback there is not awaited, so the
      // writes would race the counter and the function would return before they
      // landed.
      for (const [i, raw] of records.entries()) {
        const parsed = parseNote(raw, `${ticket.superOpsId}:${i}`);
        if (!parsed) continue;
        await storeNote(ticket.id, parsed, raw);
        result.notes += 1;
      }
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : "ticket note sync error";
  }

  return result;
}

/** Upsert one mirrored note, keyed on its SuperOps id. */
async function storeNote(
  ticketId: string,
  note: ReturnType<typeof parseNote> & object,
  raw: unknown,
): Promise<void> {
  const data = {
    ticketId,
    kind: note.kind,
    isPrivate: note.isPrivate,
    author: note.author,
    authorEmail: note.authorEmail,
    body: note.body,
    createdTime: note.createdAt,
    ...(raw != null ? { raw: raw as Prisma.InputJsonValue } : {}),
    lastSyncedAt: new Date(),
  };
  await prisma.superOpsTicketNote.upsert({
    where: { superOpsId: note.externalId },
    create: { superOpsId: note.externalId, ...data },
    update: data,
  });
}
