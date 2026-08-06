import "server-only";
import { getEnv } from "@/env";
import { safeErrorMessage } from "@/lib/redact";

/**
 * Minimal Resend email sender (REST API via fetch — no SDK dependency).
 *
 * Gated on RESEND_API_KEY: with no key configured, sending is skipped and
 * reported as `sent: false` rather than throwing, so the app runs fine before
 * email is set up. The API key is sent only as a Bearer header and is never
 * logged; failures are surfaced through the redacting error helper.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_ADDRESS = "wolf365@wolfstrata.com";

export interface SendEmailInput {
  subject: string;
  html: string;
  text: string;
  /**
   * Explicit recipients. Omit to use the configured alert list — that is what
   * the cron digests do. SilverFang ticket mail always passes real recipients.
   */
  to?: string[];
  cc?: string[];
  /** Override the From address (e.g. a SilverFang support mailbox). */
  from?: string;
  replyTo?: string;
  /** Extra headers, used for RFC 5322 threading on ticket replies. */
  headers?: Record<string, string>;
}

export interface SendEmailResult {
  sent: boolean;
  /** Why an email was not sent (e.g. not configured), when applicable. */
  reason?: string;
  /** Recipients the email was addressed to, for the cron summary. */
  to?: string[];
  /** Provider message id, when the provider returns one. */
  providerId?: string;
}

/** Configured (or default) recipient list, comma-separated in ALERT_EMAIL_TO. */
export function alertRecipients(): string[] {
  const raw = getEnv().ALERT_EMAIL_TO || DEFAULT_ADDRESS;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const env = getEnv();
  if (!env.RESEND_API_KEY) {
    return { sent: false, reason: "RESEND_API_KEY not configured" };
  }
  const from = input.from || env.ALERT_EMAIL_FROM || DEFAULT_ADDRESS;
  const to = input.to && input.to.length > 0 ? input.to : alertRecipients();
  if (to.length === 0) return { sent: false, reason: "No recipients" };

  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      ...(input.cc && input.cc.length > 0 ? { cc: input.cc } : {}),
      ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      ...(input.headers && Object.keys(input.headers).length > 0
        ? { headers: input.headers }
        : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend send failed (HTTP ${res.status}): ${safeErrorMessage(body, 200)}`);
  }
  const json = (await res.json().catch(() => null)) as { id?: string } | null;
  return { sent: true, to, ...(json?.id ? { providerId: json.id } : {}) };
}
