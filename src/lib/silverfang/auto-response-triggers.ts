/**
 * Auto-response triggers, and which of them can never reach a client.
 *
 * Its own module so the enforcement (`runAutoResponses`) and the UI that labels a
 * rule read the same list. If the page hard-coded its own copy, a trigger added to
 * one and not the other would either leak client mail or mislabel a rule as safe.
 */

export type AutoResponseTrigger =
  | "TICKET_CREATED"
  | "STATUS_CHANGED"
  | "NOTE_ADDED"
  | "SLA_AT_RISK"
  | "SLA_BREACHED";

/**
 * Triggers that must never mail the client, whatever a rule's audience says.
 *
 * Telling a customer "we are about to miss your SLA" automatically is a promise
 * nobody made and an escalation nobody chose. The warning exists so a technician
 * can still meet the target; sending it outward defeats its purpose.
 *
 * Enforced in `runAutoResponses` rather than left to convention, so a rule saved
 * with audience CONTACT or BOTH cannot leak it.
 */
export const INTERNAL_ONLY_RULE_TRIGGERS: string[] = ["SLA_AT_RISK"];

export function isInternalOnlyTrigger(trigger: string): boolean {
  return INTERNAL_ONLY_RULE_TRIGGERS.includes(trigger);
}
