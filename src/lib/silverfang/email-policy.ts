/**
 * The client-email gate.
 *
 * HARD RULE: SilverFang never sends email to a client's contacts unless someone
 * has explicitly enabled it for that client. This is deliberately fail-safe in
 * every direction:
 *
 *  - the column defaults to false, so a new client is off;
 *  - a client with no profile row at all is off (absence is a refusal, never a
 *    "not configured, assume yes");
 *  - the check lives in the mail transport, so a future send path cannot forget
 *    to call it and quietly start mailing customers.
 *
 * Internal mail — to a technician or assignee, who is a Wolf365 user — is not
 * gated by this. The rule protects *clients*.
 *
 * Pure and unit-tested on purpose: this is the last thing that should ever break
 * silently, so it must not depend on Prisma, config or environment.
 */

/** The only shape the rule needs. `null`/`undefined` means "no profile row". */
export interface ClientEmailSetting {
  allowClientEmail?: boolean | null;
}

/**
 * Whether a client's contacts may be emailed. Anything other than an explicit
 * `true` is a no.
 */
export function clientEmailAllowed(
  profile: ClientEmailSetting | null | undefined,
): boolean {
  return profile?.allowClientEmail === true;
}

/**
 * Why a send was refused, phrased for whoever is looking at the ticket. Names the
 * client and the exact setting, so it reads as a deliberate safety stop rather
 * than a bug.
 */
export function clientEmailBlockedReason(clientName: string): string {
  return (
    `Email to ${clientName} is turned off. Nothing has been sent. ` +
    `Enable “Allow email to client” on the client’s SilverFang profile first — ` +
    `it is off by default for every client so customers can never be mailed by accident.`
  );
}

/** Short label for lists and badges. */
export function clientEmailLabel(profile: ClientEmailSetting | null | undefined): string {
  return clientEmailAllowed(profile) ? "Email allowed" : "Email off";
}

// ---------------------------------------------------------------------------
// Master switch
// ---------------------------------------------------------------------------

/**
 * Whether outbound email is enabled at all. Deliberately scoped to *everything*
 * — client and internal alike. A kill switch that leaves some mail flowing is
 * not a kill switch, and "which half is still on?" is exactly the question you
 * don't want to be asking when you flip it.
 *
 * A missing policy row means off, so email cannot begin flowing merely because
 * the table has never been written to.
 */
export function outboundEnabled(
  policy: { outboundEnabled?: boolean | null } | null | undefined,
): boolean {
  return policy?.outboundEnabled === true;
}

export type BlockReason = "MASTER_OFF" | "CLIENT_OFF";

export type EmailDecision =
  | { allowed: true }
  | { allowed: false; reason: BlockReason; message: string };

/**
 * The single decision for whether one message may be sent. Both gates apply and
 * the master switch is checked first, so a disabled system reports the real
 * reason rather than blaming a per-client setting.
 */
export function decideOutbound(input: {
  policy: { outboundEnabled?: boolean | null } | null | undefined;
  audience: "CLIENT" | "INTERNAL";
  /** Required for a CLIENT audience; ignored otherwise. */
  clientProfile?: ClientEmailSetting | null;
  clientName?: string;
}): EmailDecision {
  if (!outboundEnabled(input.policy)) {
    return { allowed: false, reason: "MASTER_OFF", message: masterOffReason() };
  }
  if (input.audience === "CLIENT" && !clientEmailAllowed(input.clientProfile)) {
    return {
      allowed: false,
      reason: "CLIENT_OFF",
      message: clientEmailBlockedReason(input.clientName ?? "this client"),
    };
  }
  return { allowed: true };
}

export function masterOffReason(): string {
  return (
    "Outbound email is switched off for all of SilverFang. Nothing has been sent, " +
    "to anyone. A SilverFang administrator can enable it under SilverFang → Email; " +
    "each client still needs its own “Allow email to client” as well."
  );
}

/** Short label for the settings UI. */
export function outboundLabel(
  policy: { outboundEnabled?: boolean | null } | null | undefined,
): string {
  return outboundEnabled(policy) ? "Enabled" : "Off — nothing is sent";
}

/** Typed exactly, so enabling can never be a stray truthy value. */
export const ENABLE_CONFIRMATION = "ENABLE";
