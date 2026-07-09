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
}

export interface SendEmailResult {
  sent: boolean;
  /** Why an email was not sent (e.g. not configured), when applicable. */
  reason?: string;
  /** Recipients the email was addressed to, for the cron summary. */
  to?: string[];
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
  const from = env.ALERT_EMAIL_FROM || DEFAULT_ADDRESS;
  const to = alertRecipients();
  if (to.length === 0) return { sent: false, reason: "No alert recipients configured" };

  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject: input.subject, html: input.html, text: input.text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend send failed (HTTP ${res.status}): ${safeErrorMessage(body, 200)}`);
  }
  return { sent: true, to };
}
