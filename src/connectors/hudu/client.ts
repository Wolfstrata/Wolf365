import { connectorFetch } from "@/connectors/http";
import type { ConnectorContext } from "@/connectors/types";

/**
 * Hudu transport. Hudu exposes a REST API under `<baseUrl>/api/v1` authenticated
 * with an `x-api-key` header, and paginates with `page` / `page_size`.
 */

export interface HuduConfig {
  baseUrl?: string;
}
export interface HuduSecrets {
  apiKey?: string;
}
export type HuduCtx = ConnectorContext<HuduConfig, HuduSecrets>;

export const PAGE_SIZE = 100;
/** Safety cap: an API that ignores `page` must not spin forever. */
export const MAX_PAGES = 500;

/**
 * Hudu's documented limit is 300 requests/minute per key. Staying well under it
 * matters more here than raw speed — a 429 storm against a documentation system
 * an MSP relies on during an incident is a self-inflicted outage.
 */
const REQUESTS_PER_MINUTE = 200;
export const REQUEST_GAP_MS = Math.ceil(60_000 / REQUESTS_PER_MINUTE);

export function huduHeaders(apiKey: string): Record<string, string> {
  return { "x-api-key": apiKey, Accept: "application/json" };
}

/** Base URL with any trailing slash removed, so path joins are predictable. */
export function huduBase(ctx: HuduCtx): string {
  return (ctx.config.baseUrl ?? "").replace(/\/$/, "");
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type Obj = Record<string, unknown>;

/**
 * One GET against the Hudu API. `connectorFetch` does not throw on a 4xx/5xx, so
 * a non-ok response is turned into an error here — a caller that forgot to check
 * would otherwise parse an error page as data.
 */
export async function huduGet(
  ctx: HuduCtx,
  action: string,
  path: string,
  query: Record<string, string | number> = {},
): Promise<Obj> {
  const search = new URLSearchParams(
    Object.entries(query).map(([k, v]) => [k, String(v)]),
  ).toString();
  const url = `${huduBase(ctx)}/api/v1/${path}${search ? `?${search}` : ""}`;
  const res = await connectorFetch(url, {
    connectorType: "HUDU",
    connectorId: ctx.connectorId,
    action,
    headers: huduHeaders(ctx.secrets.apiKey ?? ""),
  });
  if (!res.ok) {
    throw new Error(`Hudu ${action} failed (HTTP ${res.status})`);
  }
  const parsed: unknown = JSON.parse(res.body || "{}");
  return typeof parsed === "object" && parsed !== null ? (parsed as Obj) : {};
}

/**
 * Page through a Hudu collection endpoint. Stops on an empty page, a short page,
 * a page whose first record repeats (an endpoint ignoring `page`), or the page
 * cap — whichever comes first.
 */
export async function huduList(
  ctx: HuduCtx,
  action: string,
  path: string,
  key: string,
  extraQuery: Record<string, string | number> = {},
): Promise<Obj[]> {
  const all: Obj[] = [];
  let firstSeen: string | null = null;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    if (page > 1) await sleep(REQUEST_GAP_MS);
    const body = await huduGet(ctx, action, path, {
      ...extraQuery,
      page,
      page_size: PAGE_SIZE,
    });
    const rows = Array.isArray(body[key]) ? (body[key] as unknown[]) : [];
    const objects = rows.filter(
      (r): r is Obj => typeof r === "object" && r !== null,
    );
    if (objects.length === 0) break;

    // Guard against an endpoint that returns page 1 forever.
    const marker = JSON.stringify(objects[0]?.id ?? objects[0]?.name ?? "");
    if (firstSeen !== null && marker === firstSeen) break;
    firstSeen = marker;

    all.push(...objects);
    if (objects.length < PAGE_SIZE) break;
  }
  return all;
}
