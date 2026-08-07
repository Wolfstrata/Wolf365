import "server-only";
import { prisma } from "@/lib/db";

/**
 * What Hudu holds about a client, loaded once and rendered two ways: in full on
 * the client page, and compactly on a ticket.
 *
 * Extracted so both views read the same query. A second copy of this would drift
 * — and the thing most likely to drift is the confidential-field handling, which
 * is the part that must not.
 *
 * Nothing secret is here to leak: the sync never stores password records, asset
 * `raw` blobs or article bodies, and confidential fields are counted rather than
 * copied. Every value below is either non-secret or a link back into Hudu, which
 * stays the system of record.
 */

export interface HuduSafeField {
  label: string;
  value: string;
}

export interface HuduContextAsset {
  id: string;
  name: string;
  assetLayout: string | null;
  serial: string | null;
  model: string | null;
  manufacturer: string | null;
  huduUrl: string | null;
  redactedFieldCount: number;
  fields: HuduSafeField[];
}

export interface HuduContext {
  companyId: string;
  name: string;
  companyType: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  huduUrl: string | null;
  lastSyncedAt: Date;
  assets: HuduContextAsset[];
  assetsByLayout: { layout: string; assets: HuduContextAsset[] }[];
  articles: { id: string; name: string; folder: string | null; huduUrl: string | null }[];
  /** Confidential fields across these assets, held in Hudu only. */
  withheldFields: number;
}

/** Narrow the stored JSON to the {label, value} pairs the sync writes. */
function fieldsOf(value: unknown): HuduSafeField[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (f): f is HuduSafeField =>
      typeof f === "object" &&
      f !== null &&
      typeof (f as HuduSafeField).label === "string" &&
      typeof (f as HuduSafeField).value === "string",
  );
}

/**
 * Hudu context for a client, or null when Hudu holds no company for it — which is
 * the normal state for many clients, so callers render nothing rather than an
 * empty shell.
 */
export async function huduContextFor(clientId: string): Promise<HuduContext | null> {
  const company = await prisma.huduCompany.findUnique({
    where: { clientId },
    include: {
      assets: {
        where: { archived: false },
        orderBy: [{ assetLayout: "asc" }, { name: "asc" }],
        take: 100,
      },
      articles: {
        where: { archived: false },
        orderBy: { name: "asc" },
        take: 50,
      },
    },
  });
  if (!company) return null;

  const assets: HuduContextAsset[] = company.assets.map((a) => ({
    id: a.id,
    name: a.name,
    assetLayout: a.assetLayout,
    serial: a.serial,
    model: a.model,
    manufacturer: a.manufacturer,
    huduUrl: a.huduUrl,
    redactedFieldCount: a.redactedFieldCount,
    fields: fieldsOf(a.fields),
  }));

  const byLayout = new Map<string, HuduContextAsset[]>();
  for (const a of assets) {
    const key = a.assetLayout ?? "Other";
    (byLayout.get(key) ?? byLayout.set(key, []).get(key)!).push(a);
  }

  return {
    companyId: company.id,
    name: company.name,
    companyType: company.companyType,
    phone: company.phone,
    website: company.website,
    address: company.address,
    huduUrl: company.huduUrl,
    lastSyncedAt: company.lastSyncedAt,
    assets,
    assetsByLayout: [...byLayout.entries()].map(([layout, list]) => ({ layout, assets: list })),
    articles: company.articles.map((a) => ({
      id: a.id,
      name: a.name,
      folder: a.folder,
      huduUrl: a.huduUrl,
    })),
    withheldFields: assets.reduce((sum, a) => sum + a.redactedFieldCount, 0),
  };
}
