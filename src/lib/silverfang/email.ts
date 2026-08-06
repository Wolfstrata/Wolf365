/**
 * Pure email logic for SilverFang ticket mail — no I/O, no Prisma, no fetch.
 *
 * Everything that decides *which ticket an email belongs to*, *what a reply
 * looks like*, and *whether replying would start a mail loop* lives here so it
 * can be unit-tested exhaustively. The transport and database edges are in
 * mail.ts / email-ingest.ts.
 *
 * Threading strategy (deliberate): the ticket tag in the subject — `[SF-1042]`
 * — is the primary key, backed by an `x-silverfang-ticket` header we set on
 * outbound mail, with RFC 5322 In-Reply-To/References as the last resort.
 * Subject-first is what ConnectWise/Halo do, and it survives clients that
 * rewrite headers. It matters here because Microsoft Graph's sendMail only
 * accepts custom `x-*` headers, so we cannot set In-Reply-To on the Graph path.
 */

/** Prefix of the ticket tag placed in every outbound subject. */
export const TICKET_TAG_PREFIX = "SF";

/** Header we stamp on outbound mail so replies route even if the subject changes. */
export const TICKET_HEADER = "x-silverfang-ticket";

/** `[SF-1042]` — the tag appended to outbound subjects. */
export function formatTicketTag(number: number): string {
  return `[${TICKET_TAG_PREFIX}-${number}]`;
}

// Tolerates `[SF-1042]`, `[ sf - 1042 ]` and a bare `SF-1042` anywhere in the line.
const TAG_RE = /\[?\s*SF\s*-\s*(\d{1,10})\s*\]?/i;

/**
 * The ticket number carried by a subject line, or null when there isn't one.
 * Survives any number of `Re:`/`Fwd:` prefixes because it matches anywhere.
 */
export function parseTicketNumber(subject: string | null | undefined): number | null {
  if (!subject) return null;
  const m = TAG_RE.exec(subject);
  if (!m?.[1]) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Strip every leading `Re:`/`RE:`/`Fwd:`/`FW:` and the ticket tag from a subject. */
export function stripSubjectDecorations(subject: string | null | undefined): string {
  let s = (subject ?? "").trim();
  // Repeatedly, because mail clients stack prefixes ("Re: Fwd: Re: …").
  for (;;) {
    const next = s.replace(/^\s*(re|fw|fwd|aw|antw|sv|vs)\s*(\[\d+\])?\s*:\s*/i, "");
    if (next === s) break;
    s = next;
  }
  return s.replace(TAG_RE, "").replace(/\s{2,}/g, " ").trim();
}

/**
 * Subject for an outbound message on a ticket: the ticket tag exactly once,
 * followed by the summary. `Re:` is added when we're answering inbound mail.
 */
export function buildOutboundSubject(
  number: number,
  summary: string,
  opts: { reply?: boolean } = {},
): string {
  const clean = stripSubjectDecorations(summary) || "(no subject)";
  const prefix = opts.reply ? "Re: " : "";
  return `${prefix}${formatTicketTag(number)} ${clean}`.trim();
}

/**
 * A ticket summary derived from an inbound subject. Tag and reply prefixes are
 * removed so a threaded reply never creates "Re: Re: [SF-1] …" as a summary.
 */
export function summaryFromSubject(subject: string | null | undefined, max = 300): string {
  const clean = stripSubjectDecorations(subject);
  if (!clean) return "(no subject)";
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

// Lines that mean "everything below is the quoted original".
const QUOTE_MARKERS: RegExp[] = [
  /^-{2,}\s*original message\s*-{2,}/i,
  /^-{2,}\s*forwarded message\s*-{2,}/i,
  /^_{5,}$/,
  /^from:\s.+$/i,
  /^sent from my \w+/i,
  // "On Mon, 4 Aug 2026 at 10:12, Someone <a@b.c> wrote:" — possibly wrapped, so
  // the trailing "wrote:" is optional on the marker line itself.
  /^on\s.{0,200}\bwrote:\s*$/i,
  /^\s*at .{0,120}\bwrote:\s*$/i,
  /^<[^>]+>\s+wrote:\s*$/i,
];

/**
 * Drop the quoted history from a plain-text reply, keeping only what the sender
 * actually typed. Conservative by design: if no marker is found the body is
 * returned untouched, because losing content is worse than keeping a quote.
 */
export function stripQuotedReply(text: string | null | undefined): string {
  if (!text) return "";
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let cut = lines.length;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!.trim();
    if (QUOTE_MARKERS.some((re) => re.test(line))) {
      cut = i;
      break;
    }
    // A run of `>` quoted lines also marks the start of history, but only once
    // we've already seen some real content — a top-quoting reply starts with it.
    if (line.startsWith(">") && i > 0) {
      cut = i;
      break;
    }
  }

  return lines
    .slice(0, cut)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/** Escape text for safe interpolation into an HTML email body. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Wrap plain text as a minimal HTML body (escaped, newlines preserved). */
export function textToHtml(text: string): string {
  return escapeHtml(text).replace(/\r?\n/g, "<br />");
}

/**
 * Best-effort HTML → plain text, used when a provider gives us only HTML.
 * Not a full parser: it drops script/style, turns block ends into newlines and
 * decodes the handful of entities that actually show up in mail.
 */
export function htmlToPlainText(html: string | null | undefined): string {
  if (!html) return "";
  let out = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "");
  for (const [entity, char] of Object.entries(HTML_ENTITIES)) {
    out = out.split(entity).join(char);
  }
  out = out.replace(/&#(\d{1,6});/g, (_m, code: string) =>
    String.fromCodePoint(Number.parseInt(code, 10)),
  );
  return out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The bare address from a mail header value, lowercased. Returns null for input
 * with no plausible address so callers skip rather than store rubbish.
 */
export function normalizeAddress(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  // Prefer the <angle-bracketed> form when present.
  const angled = /<([^<>]+)>/.exec(value);
  const candidate = (angled?.[1] ?? value).trim().replace(/^mailto:/i, "").toLowerCase();
  // Deliberately loose: mail addresses in the wild defy strict validation, but
  // one @ with something either side is the floor.
  if (!/^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(candidate)) return null;
  return candidate;
}

/** Parse a To/Cc header (or array) into de-duplicated, normalized addresses. */
export function parseAddressList(raw: string | string[] | null | undefined): string[] {
  if (!raw) return [];
  const parts = Array.isArray(raw)
    ? raw
    : // Split on comma/semicolon that is not inside a quoted display name.
      raw.split(/[,;]/);
  const out: string[] = [];
  for (const part of parts) {
    const addr = normalizeAddress(part);
    if (addr && !out.includes(addr)) out.push(addr);
  }
  return out;
}

/** Case-insensitive address comparison. */
export function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeAddress(a);
  const nb = normalizeAddress(b);
  return na != null && nb != null && na === nb;
}

/** The domain of an address, lowercased; null when unparseable. */
export function addressDomain(raw: string | null | undefined): string | null {
  const addr = normalizeAddress(raw);
  if (!addr) return null;
  const at = addr.lastIndexOf("@");
  return at > 0 ? addr.slice(at + 1) : null;
}

/**
 * Consumer mail domains. A sender at one of these must never be matched to a
 * client by domain: one client contact with a gmail address would otherwise
 * capture every gmail sender in the system.
 */
const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "hotmail.ca",
  "live.com",
  "live.ca",
  "msn.com",
  "yahoo.com",
  "yahoo.ca",
  "ymail.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "protonmail.com",
  "proton.me",
  "gmx.com",
  "zoho.com",
  "shaw.ca",
  "sympatico.ca",
  "telus.net",
  "rogers.com",
  "bell.net",
  "mts.net",
]);

/** Whether a domain is a consumer mail provider (never usable for client matching). */
export function isPublicEmailDomain(domain: string | null | undefined): boolean {
  return domain != null && PUBLIC_EMAIL_DOMAINS.has(domain.trim().toLowerCase());
}

/**
 * Message-IDs referenced by an inbound message, most recent first, for the
 * fallback threading lookup. Handles both `<a@b>` lists and bare ids.
 */
export function referencedMessageIds(input: {
  inReplyTo?: string | null;
  references?: string | null;
}): string[] {
  const ids: string[] = [];
  const push = (value: string | null | undefined) => {
    if (!value) return;
    const matches = value.match(/<[^<>\s]+>/g);
    const found = matches ?? value.split(/\s+/).filter(Boolean);
    for (const id of found) {
      const trimmed = id.trim();
      if (trimmed && !ids.includes(trimmed)) ids.push(trimmed);
    }
  };
  // In-Reply-To is the direct parent, so it goes first; References is oldest-first
  // in the wire format, hence reversed for "most recent first".
  push(input.inReplyTo);
  const refs: string[] = [];
  const matches = input.references?.match(/<[^<>\s]+>/g) ?? null;
  if (matches) refs.push(...matches.reverse());
  for (const id of refs) if (!ids.includes(id)) ids.push(id);
  return ids;
}

/** RFC 5322 References chain for a reply to `parentMessageId`. */
export function buildReferences(
  parentReferences: string | null | undefined,
  parentMessageId: string | null | undefined,
): string | null {
  const parts = [
    ...(parentReferences?.match(/<[^<>\s]+>/g) ?? []),
    ...(parentMessageId ? [parentMessageId.trim()] : []),
  ].filter((v, i, all) => v && all.indexOf(v) === i);
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * Whether an inbound message is machine-generated (out-of-office, bounce,
 * another ticket system's acknowledgement). Auto-replies must never *open* a
 * ticket or trigger an auto-response, or two robots will mail each other
 * forever.
 */
export function isAutoSubmitted(input: {
  headers?: Record<string, string | undefined> | null;
  subject?: string | null;
}): boolean {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers ?? {})) {
    if (typeof v === "string") headers[k.toLowerCase()] = v.toLowerCase();
  }
  const autoSubmitted = headers["auto-submitted"];
  if (autoSubmitted && autoSubmitted !== "no") return true;
  if (headers["x-autoreply"] || headers["x-autorespond"]) return true;
  if (headers["precedence"] && ["bulk", "auto_reply", "junk", "list"].includes(headers["precedence"]))
    return true;
  // Exchange/Outlook mark OOF replies this way.
  if (headers["x-auto-response-suppress"]) return true;
  const subject = (input.subject ?? "").trim().toLowerCase();
  return (
    subject.startsWith("automatic reply") ||
    subject.startsWith("auto-reply") ||
    subject.startsWith("out of office") ||
    subject.startsWith("undeliverable") ||
    subject.startsWith("delivery status notification")
  );
}

/**
 * Substitute `{{placeholders}}` in an auto-response template. Unknown keys are
 * left as-is rather than blanked, so a typo in a template is visible in the
 * preview instead of silently producing an empty sentence.
 */
export function renderTemplate(
  template: string,
  vars: Record<string, string | number | null | undefined>,
): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, key: string) => {
    const value = vars[key];
    if (value === null || value === undefined || value === "") return whole;
    return String(value);
  });
}

/** Placeholders an auto-response template may use, for the settings UI. */
export const TEMPLATE_VARIABLES = [
  "ticket.number",
  "ticket.summary",
  "ticket.status",
  "ticket.priority",
  "ticket.url",
  "client.name",
  "contact.firstName",
  "contact.name",
  "assignee.name",
  "mailbox.name",
] as const;

/**
 * The address outbound mail is sent from: the explicit reply-as address when set
 * and usable, else the polled mailbox address. Used for the Graph sendMail
 * target, so a bad value would silently mail from the wrong place — hence the
 * validation rather than a bare `??`.
 */
export function outboundAddress(mailbox: {
  address: string;
  sendAsAddress?: string | null;
}): string {
  return normalizeAddress(mailbox.sendAsAddress) ?? mailbox.address;
}

/**
 * Every address that counts as "us" for loop detection. Inbound mail from any of
 * these is our own traffic coming back and must never be filed.
 */
export function ownAddresses(mailbox: {
  address: string;
  sendAsAddress?: string | null;
}): string[] {
  const own = [normalizeAddress(mailbox.address), normalizeAddress(mailbox.sendAsAddress)];
  return own.filter((a): a is string => a != null).filter((a, i, all) => all.indexOf(a) === i);
}

/**
 * The floor for a mailbox poll: only mail newer than this is fetched. Takes the
 * later of the watermark and the configured cutoff, so raising the cutoff can
 * skip history but lowering it can never re-process what has already been filed.
 */
export function pollFloor(
  lastMessageAt: Date | null | undefined,
  ignoreBefore: Date | null | undefined,
): Date | null {
  if (!lastMessageAt) return ignoreBefore ?? null;
  if (!ignoreBefore) return lastMessageAt;
  return lastMessageAt > ignoreBefore ? lastMessageAt : ignoreBefore;
}

/** Append a mailbox signature below a separator, when one is configured. */
export function withSignature(body: string, signature: string | null | undefined): string {
  const sig = (signature ?? "").trim();
  if (!sig) return body;
  return `${body.trimEnd()}\n\n--\n${sig}`;
}
