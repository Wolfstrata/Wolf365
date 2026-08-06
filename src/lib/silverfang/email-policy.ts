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
