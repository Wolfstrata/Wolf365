import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEnv } from "@/env";
import { safeEqual } from "@/lib/crypto";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { safeErrorMessage } from "@/lib/redact";
import { ingestInboundEmail, type InboundEmail } from "@/lib/silverfang/email-ingest";
import { TICKET_HEADER } from "@/lib/silverfang/email";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * SilverFang inbound-email webhook.
 *
 * POST here with `Authorization: Bearer <WOLF365_SILVERFANG_EMAIL_TOKEN>` and a
 * JSON body describing one message (or an array of them). Field names are mapped
 * defensively across the shapes common forwarders emit (Power Automate, Mailgun,
 * SendGrid inbound parse, a custom Graph subscription), so the same endpoint
 * works whatever is in front of it.
 *
 * This is the alternative to Graph polling — use whichever fits the mailbox. The
 * response reports per-message outcomes rather than a bare 200, so a forwarder's
 * logs show what actually happened to each message.
 */

const MAX_MESSAGES_PER_REQUEST = 50;

function pickStr(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function pickList(o: Record<string, unknown>, keys: string[]): string[] | string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v;
    if (Array.isArray(v)) {
      const strings = v.filter((x): x is string => typeof x === "string");
      if (strings.length > 0) return strings;
    }
  }
  return null;
}

function pickHeaders(o: Record<string, unknown>): Record<string, string> {
  const raw = o["headers"] ?? o["Headers"] ?? o["internetMessageHeaders"];
  const out: Record<string, string> = {};
  if (Array.isArray(raw)) {
    // Graph-style [{ name, value }].
    for (const item of raw) {
      if (item && typeof item === "object") {
        const rec = item as Record<string, unknown>;
        const name = typeof rec.name === "string" ? rec.name : null;
        const value = typeof rec.value === "string" ? rec.value : null;
        if (name && value) out[name.toLowerCase()] = value;
      }
    }
  } else if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === "string") out[k.toLowerCase()] = v;
    }
  }
  return out;
}

function mapMessage(o: Record<string, unknown>): InboundEmail {
  const headers = pickHeaders(o);
  const hintRaw =
    pickStr(o, ["ticketNumber", "ticket_number"]) ?? headers[TICKET_HEADER] ?? null;
  const hint = hintRaw ? Number.parseInt(hintRaw, 10) : NaN;
  const receivedRaw = pickStr(o, ["receivedAt", "received_at", "receivedDateTime", "date", "timestamp"]);
  const received = receivedRaw ? new Date(receivedRaw) : null;
  return {
    mailboxAddress:
      pickStr(o, ["mailbox", "mailboxAddress", "recipient", "deliveredTo", "delivered_to"]) ??
      null,
    from: pickStr(o, ["from", "fromAddress", "sender", "From"]),
    fromName: pickStr(o, ["fromName", "senderName"]),
    to: pickList(o, ["to", "toAddresses", "To", "toRecipients"]),
    cc: pickList(o, ["cc", "ccAddresses", "Cc", "ccRecipients"]),
    subject: pickStr(o, ["subject", "Subject"]),
    text: pickStr(o, ["text", "bodyText", "body-plain", "plainBody", "textBody"]),
    html: pickStr(o, ["html", "bodyHtml", "body-html", "htmlBody"]),
    messageId:
      pickStr(o, ["messageId", "message_id", "internetMessageId", "Message-Id"]) ??
      headers["message-id"] ??
      null,
    inReplyTo: pickStr(o, ["inReplyTo", "in_reply_to"]) ?? headers["in-reply-to"] ?? null,
    references: pickStr(o, ["references", "References"]) ?? headers["references"] ?? null,
    externalId: pickStr(o, ["externalId", "id", "graphId"]),
    receivedAt: received && !Number.isNaN(received.getTime()) ? received : null,
    headers,
    ticketNumberHint: Number.isSafeInteger(hint) && hint > 0 ? hint : null,
    raw: o,
  };
}

export async function POST(request: Request) {
  const env = getEnv();
  if (!env.WOLF365_SILVERFANG_EMAIL_TOKEN) {
    return NextResponse.json(
      {
        ok: false,
        error: "SilverFang email ingestion is not configured (WOLF365_SILVERFANG_EMAIL_TOKEN)",
      },
      { status: 503 },
    );
  }
  const authHeader = request.headers.get("authorization") ?? "";
  if (!safeEqual(authHeader, `Bearer ${env.WOLF365_SILVERFANG_EMAIL_TOKEN}`)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const rl = await rateLimit(`sf-email:${clientIp(request)}`, 120, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ ok: false, error: "rate limited" }, { status: 429 });
  }

  // Refuse rather than half-work when the desk has no mailbox configured — an
  // operator needs to know the message had nowhere to go.
  const mailboxes = await prisma.sfMailbox.count({ where: { active: true, inbound: true } });
  if (mailboxes === 0) {
    return NextResponse.json(
      { ok: false, error: "No active inbound SilverFang mailbox is configured" },
      { status: 503 },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  // Some forwarders wrap the batch in { messages: [...] } or { value: [...] }.
  const unwrapped =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? ((payload as Record<string, unknown>).messages ??
        (payload as Record<string, unknown>).value ??
        payload)
      : payload;
  const items = Array.isArray(unwrapped) ? unwrapped : [unwrapped];
  if (items.length > MAX_MESSAGES_PER_REQUEST) {
    return NextResponse.json(
      { ok: false, error: `Too many messages in one request (max ${MAX_MESSAGES_PER_REQUEST})` },
      { status: 413 },
    );
  }

  const counts = { created: 0, appended: 0, deduped: 0, skipped: 0 };
  const outcomes: unknown[] = [];
  try {
    for (const item of items) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        counts.skipped += 1;
        outcomes.push({ ok: false, reason: "not-an-object" });
        continue;
      }
      const result = await ingestInboundEmail(mapMessage(item as Record<string, unknown>));
      if (result.ok) {
        if (result.action === "created") counts.created += 1;
        else if (result.action === "appended") counts.appended += 1;
        else counts.deduped += 1;
      } else {
        counts.skipped += 1;
      }
      outcomes.push(result);
    }
    return NextResponse.json({ ok: true, ...counts, outcomes });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: safeErrorMessage(err), ...counts, outcomes },
      { status: 500 },
    );
  }
}
