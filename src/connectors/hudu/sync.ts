import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeDebugLog } from "@/lib/debug-log";
import { safeErrorMessage } from "@/lib/redact";
import { huduBase, huduList, type HuduCtx, type Obj } from "./client";
import { parseArticle, parseAsset, parseCompany } from "./parse";

/**
 * Hudu sync: companies, their assets, and their article titles.
 *
 * The point is to surface in SilverFang what Hudu already knows about a client —
 * their kit, their documentation — so a tech on a ticket does not have to go
 * looking. It stays strictly read-only; Wolf365 never writes to Hudu.
 *
 * SECURITY: Hudu is also a credential vault. This sync never touches
 * `/api/v1/asset_passwords`, stores no article bodies, and drops every asset
 * field that Hudu marks confidential or whose label reads like a secret (see
 * `parse.ts`). Assets and articles keep no `raw` blob on purpose — a raw copy
 * would reinstate exactly what was stripped.
 *
 * One entity failing never aborts the others: each is isolated and its error is
 * reported in the summary, so a Hudu instance without articles enabled still
 * gets its companies and assets.
 */

type Counts = { imported: number; updated: number; skipped: number; error?: string };
const zero = (): Counts => ({ imported: 0, updated: 0, skipped: 0 });

async function logEntity(ctx: HuduCtx, action: string, counts: Counts): Promise<void> {
  await writeDebugLog({
    type: "HUDU",
    connectorId: ctx.connectorId,
    action: `${action}_parsed`,
    endpoint: "api/v1",
    outcome: counts.error ? "failure" : "success",
    recordsCreated: counts.imported,
    recordsUpdated: counts.updated,
    recordsSkipped: counts.skipped,
    error: counts.error,
  });
}

/** Companies: the parent every other Hudu record hangs off. */
async function syncCompanies(ctx: HuduCtx): Promise<Counts> {
  const base = huduBase(ctx);
  const rows = await huduList(ctx, "sync_companies", "companies", "companies");
  const counts = zero();

  for (const raw of rows) {
    const c = parseCompany(raw, base);
    if (!c) {
      counts.skipped += 1;
      continue;
    }
    const data = {
      name: c.name,
      nickname: c.nickname,
      companyType: c.companyType,
      address: c.address,
      phone: c.phone,
      website: c.website,
      idNumber: c.idNumber,
      huduUrl: c.huduUrl,
      archived: c.archived,
      raw: raw as Prisma.InputJsonValue,
      lastSyncedAt: new Date(),
    };
    const existing = await prisma.huduCompany.findUnique({
      where: { huduId: c.huduId },
      select: { id: true },
    });
    if (existing) {
      await prisma.huduCompany.update({ where: { huduId: c.huduId }, data });
      counts.updated += 1;
    } else {
      await prisma.huduCompany.create({ data: { huduId: c.huduId, ...data } });
      counts.imported += 1;
    }
  }
  return counts;
}

/** Maps a Hudu company id to our local `HuduCompany.id`. */
type CompanyResolver = (huduCompanyId: string) => string | null;

async function buildCompanyResolver(): Promise<CompanyResolver> {
  const rows = await prisma.huduCompany.findMany({ select: { id: true, huduId: true } });
  const byHuduId = new Map(rows.map((r) => [r.huduId, r.id]));
  return (huduCompanyId) => byHuduId.get(huduCompanyId) ?? null;
}

/**
 * Assets. An asset whose company we do not hold is skipped and counted — storing
 * it loose would put kit on screen with no client to attribute it to.
 */
async function syncAssets(ctx: HuduCtx, resolve: CompanyResolver): Promise<Counts> {
  const base = huduBase(ctx);
  const rows = await huduList(ctx, "sync_assets", "assets", "assets");
  const counts = zero();

  for (const raw of rows) {
    const a = parseAsset(raw, base);
    if (!a) {
      counts.skipped += 1;
      continue;
    }
    const companyId = resolve(a.companyHuduId);
    if (!companyId) {
      counts.skipped += 1;
      continue;
    }
    // NB: no `raw` — see the security note at the top of this file.
    const data = {
      companyId,
      name: a.name,
      assetLayout: a.assetLayout,
      serial: a.serial,
      model: a.model,
      manufacturer: a.manufacturer,
      primaryMail: a.primaryMail,
      huduUrl: a.huduUrl,
      archived: a.archived,
      fields: a.fields as unknown as Prisma.InputJsonValue,
      redactedFieldCount: a.redactedFieldCount,
      huduUpdatedAt: a.huduUpdatedAt,
      lastSyncedAt: new Date(),
    };
    const existing = await prisma.huduAsset.findUnique({
      where: { huduId: a.huduId },
      select: { id: true },
    });
    if (existing) {
      await prisma.huduAsset.update({ where: { huduId: a.huduId }, data });
      counts.updated += 1;
    } else {
      await prisma.huduAsset.create({ data: { huduId: a.huduId, ...data } });
      counts.imported += 1;
    }
  }
  return counts;
}

/**
 * Article titles and links. Global articles (no company) are kept with a null
 * company so a general runbook is still findable; only bodies are excluded.
 */
async function syncArticles(ctx: HuduCtx, resolve: CompanyResolver): Promise<Counts> {
  const base = huduBase(ctx);
  const rows = await huduList(ctx, "sync_articles", "articles", "articles");
  const counts = zero();

  for (const raw of rows) {
    const a = parseArticle(raw, base);
    if (!a) {
      counts.skipped += 1;
      continue;
    }
    // A company-scoped article whose company we do not hold is skipped; a truly
    // global one is kept with no company.
    const companyId = a.companyHuduId ? resolve(a.companyHuduId) : null;
    if (a.companyHuduId && !companyId) {
      counts.skipped += 1;
      continue;
    }
    const data = {
      companyId,
      name: a.name,
      folder: a.folder,
      huduUrl: a.huduUrl,
      global: a.global,
      archived: a.archived,
      huduUpdatedAt: a.huduUpdatedAt,
      lastSyncedAt: new Date(),
    };
    const existing = await prisma.huduArticle.findUnique({
      where: { huduId: a.huduId },
      select: { id: true },
    });
    if (existing) {
      await prisma.huduArticle.update({ where: { huduId: a.huduId }, data });
      counts.updated += 1;
    } else {
      await prisma.huduArticle.create({ data: { huduId: a.huduId, ...data } });
      counts.imported += 1;
    }
  }
  return counts;
}

export interface HuduSyncSummary {
  companies: number;
  assets: number;
  articles: number;
  /** Fields withheld as confidential across every asset touched this run. */
  redactedFields: number;
  errors: Record<string, string>;
  skippedByEntity: Record<string, number>;
}

/**
 * Sync everything, in dependency order. Companies come first because assets and
 * articles resolve against them.
 */
export async function syncHuduData(ctx: HuduCtx): Promise<{
  imported: number;
  updated: number;
  skipped: number;
  summary: HuduSyncSummary;
}> {
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  const summary: HuduSyncSummary = {
    companies: 0,
    assets: 0,
    articles: 0,
    redactedFields: 0,
    errors: {},
    skippedByEntity: {},
  };

  const fold = (key: keyof HuduSyncSummary, counts: Counts): number => {
    imported += counts.imported;
    updated += counts.updated;
    skipped += counts.skipped;
    if (counts.error) summary.errors[key as string] = counts.error;
    if (counts.skipped > 0) summary.skippedByEntity[key as string] = counts.skipped;
    return counts.imported + counts.updated;
  };

  // Companies are the parent; if they fail there is nothing to hang the rest on,
  // so that error is reported and the run stops early rather than reporting a
  // pile of "unknown company" skips that hide the real cause.
  let companyCounts = zero();
  try {
    companyCounts = await syncCompanies(ctx);
  } catch (err) {
    companyCounts.error = safeErrorMessage(err);
  }
  await logEntity(ctx, "companies", companyCounts);
  summary.companies = fold("companies", companyCounts);
  if (companyCounts.error) {
    return { imported, updated, skipped, summary };
  }

  const resolve = await buildCompanyResolver();

  const run = async (
    key: "assets" | "articles",
    fn: (ctx: HuduCtx, resolve: CompanyResolver) => Promise<Counts>,
  ): Promise<Counts> => {
    let counts = zero();
    try {
      counts = await fn(ctx, resolve);
    } catch (err) {
      counts.error = safeErrorMessage(err);
    }
    await logEntity(ctx, key, counts);
    summary[key] = fold(key, counts);
    return counts;
  };

  await run("assets", syncAssets);
  await run("articles", syncArticles);

  const redacted = await prisma.huduAsset.aggregate({ _sum: { redactedFieldCount: true } });
  summary.redactedFields = redacted._sum.redactedFieldCount ?? 0;

  return { imported, updated, skipped, summary };
}

/** Re-exported for tests that want to exercise a single entity. */
export type { Obj };
