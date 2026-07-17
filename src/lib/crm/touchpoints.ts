import "server-only";
import { resolveSso } from "@/lib/auth/sso";
import { getGraphToken, graphGet, domainOf } from "@/lib/crm/graph";

/**
 * Last-touchpoint provider for the My Clients page.
 *
 * A "touchpoint" is the most recent interaction with a client — an email
 * (sent or received) or a calendar meeting — found in the signed-in rep's
 * Microsoft 365 mailbox and read via app-only Microsoft Graph (see graph.ts and
 * the M365 integration guide). Interactions are matched to a client by the other
 * party's email domain.
 *
 * Degrades gracefully: if Entra/Graph isn't configured, or the mailbox can't be
 * read, it reports `live: false` and an empty map, so the page shows "—" for the
 * touchpoint column instead of failing.
 */

/** How far back to look for a touchpoint before treating a client as cold. */
const LOOKBACK_MONTHS = 24;
/** Page cap per source (100 items/page) — bounds the Graph calls. */
const MAX_PAGES = 6;

interface GraphMessage {
  receivedDateTime?: string;
  from?: { emailAddress?: { address?: string } };
  toRecipients?: Array<{ emailAddress?: { address?: string } }>;
  ccRecipients?: Array<{ emailAddress?: { address?: string } }>;
}
interface GraphEvent {
  start?: { dateTime?: string };
  organizer?: { emailAddress?: { address?: string } };
  attendees?: Array<{ emailAddress?: { address?: string } }>;
}
interface GraphList<T> {
  value?: T[];
  "@odata.nextLink"?: string;
}

/** Record the most-recent timestamp per external domain into `domainLast`. */
function record(
  domainLast: Map<string, number>,
  addresses: (string | undefined)[],
  whenMs: number,
  internalDomains: Set<string>,
): void {
  if (!Number.isFinite(whenMs)) return;
  for (const addr of addresses) {
    const d = domainOf(addr);
    if (!d || internalDomains.has(d)) continue;
    const prev = domainLast.get(d) ?? 0;
    if (whenMs > prev) domainLast.set(d, whenMs);
  }
}

async function collectMail(
  token: string,
  mailbox: string,
  sinceIso: string,
  domainLast: Map<string, number>,
  internalDomains: Set<string>,
): Promise<void> {
  const select = "from,toRecipients,ccRecipients,receivedDateTime";
  const filter = encodeURIComponent(`receivedDateTime ge ${sinceIso}`);
  let url: string | undefined =
    `/users/${encodeURIComponent(mailbox)}/messages` +
    `?$select=${select}&$top=100&$orderby=receivedDateTime%20desc&$filter=${filter}`;
  for (let page = 0; page < MAX_PAGES && url; page++) {
    const res: GraphList<GraphMessage> | null = await graphGet<GraphList<GraphMessage>>(token, url);
    if (!res?.value?.length) break;
    for (const m of res.value) {
      const when = m.receivedDateTime ? Date.parse(m.receivedDateTime) : NaN;
      const addrs = [
        m.from?.emailAddress?.address,
        ...(m.toRecipients ?? []).map((r) => r.emailAddress?.address),
        ...(m.ccRecipients ?? []).map((r) => r.emailAddress?.address),
      ];
      record(domainLast, addrs, when, internalDomains);
    }
    url = res["@odata.nextLink"];
  }
}

async function collectCalendar(
  token: string,
  mailbox: string,
  sinceIso: string,
  untilIso: string,
  domainLast: Map<string, number>,
  internalDomains: Set<string>,
): Promise<void> {
  const select = "organizer,attendees,start";
  let url: string | undefined =
    `/users/${encodeURIComponent(mailbox)}/calendarView` +
    `?startDateTime=${encodeURIComponent(sinceIso)}&endDateTime=${encodeURIComponent(untilIso)}` +
    `&$select=${select}&$top=100&$orderby=start/dateTime%20desc`;
  for (let page = 0; page < MAX_PAGES && url; page++) {
    const res: GraphList<GraphEvent> | null = await graphGet<GraphList<GraphEvent>>(token, url);
    if (!res?.value?.length) break;
    for (const e of res.value) {
      const when = e.start?.dateTime ? Date.parse(`${e.start.dateTime}Z`.replace(/Z+$/, "Z")) : NaN;
      const addrs = [
        e.organizer?.emailAddress?.address,
        ...(e.attendees ?? []).map((a) => a.emailAddress?.address),
      ];
      record(domainLast, addrs, when, internalDomains);
    }
    url = res["@odata.nextLink"];
  }
}

/**
 * Most-recent touchpoint per client account.
 *
 * @param mailbox  the rep's mailbox to read (UPN/email).
 * @param accountDomains  account name → the email domain(s) that identify it.
 * @returns `live` (whether Graph was actually queried) and a map of account →
 *          most-recent touchpoint date (null when none found in the window).
 */
export async function getLastTouchpoints(
  mailbox: string,
  accountDomains: Map<string, string[]>,
): Promise<{ live: boolean; touchpoints: Map<string, Date | null> }> {
  const empty = new Map<string, Date | null>();
  if (!mailbox || accountDomains.size === 0) return { live: false, touchpoints: empty };

  const token = await getGraphToken();
  if (!token) return { live: false, touchpoints: empty };

  const now = Date.now();
  const since = new Date(now);
  since.setUTCMonth(since.getUTCMonth() - LOOKBACK_MONTHS);
  const sinceIso = since.toISOString();
  const untilIso = new Date(now).toISOString();

  // Exclude our own/internal domains so internal mail isn't mistaken for a client.
  const sso = await resolveSso();
  const internalDomains = new Set<string>(
    [domainOf(mailbox), ...(sso?.allowedDomains ?? []).map((d) => d.trim().toLowerCase())].filter(
      (d): d is string => Boolean(d),
    ),
  );

  const domainLast = new Map<string, number>();
  // Mail and calendar are independent — fetch concurrently.
  await Promise.all([
    collectMail(token, mailbox, sinceIso, domainLast, internalDomains),
    collectCalendar(token, mailbox, sinceIso, untilIso, domainLast, internalDomains),
  ]);

  const touchpoints = new Map<string, Date | null>();
  for (const [account, domains] of accountDomains) {
    let best = 0;
    for (const d of domains) {
      const ms = domainLast.get(d.trim().toLowerCase()) ?? 0;
      if (ms > best) best = ms;
    }
    touchpoints.set(account, best > 0 ? new Date(best) : null);
  }
  return { live: true, touchpoints };
}
