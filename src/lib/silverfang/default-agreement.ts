/**
 * Which agreement time lands on when nobody picked one.
 *
 * A managed-services client has one answer for almost every ticket: the managed
 * agreement. Making a tech choose it on every ticket is how hours end up on no
 * agreement at all, unrated and unbilled. So this picks it for them.
 *
 * What it will *not* do is pick a block-time agreement. Block time is prepaid
 * hours drawn down by every entry; silently spending someone's prepaid balance
 * because nothing else matched is a real, invoiceable mistake, and unlike a
 * missing rate it is not obvious after the fact. Block time stays a deliberate
 * choice.
 *
 * Pure and tested — the money consequences of getting this wrong are the reason
 * it does not live inline in an action.
 */

export interface AgreementChoice {
  id: string;
  /** SfAgreementType as a string, so this module needs no Prisma import. */
  type: string;
  /** SfAgreementStatus. Anything other than ACTIVE is never auto-selected. */
  status?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
}

export type DefaultAgreementReason =
  | "profile"
  | "managed-services"
  | "managed-noc";

export interface DefaultAgreementPick {
  id: string;
  reason: DefaultAgreementReason;
}

/** Preference order. Managed services outranks NOC: it is the broader cover. */
const AUTO_TYPES: { type: string; reason: DefaultAgreementReason }[] = [
  { type: "MANAGED_SERVICES", reason: "managed-services" },
  { type: "MANAGED_NOC", reason: "managed-noc" },
];

/** Live today: active, started, and not yet ended. */
function usable(a: AgreementChoice, now: Date): boolean {
  if (a.status != null && a.status !== "ACTIVE") return false;
  if (a.startDate && a.startDate.getTime() > now.getTime()) return false;
  if (a.endDate && a.endDate.getTime() < now.getTime()) return false;
  return true;
}

/**
 * Pick the agreement to default to, or null to leave it unset.
 *
 * A client's explicitly configured default wins when it is still usable —
 * somebody chose it, and this function's job is to fill a gap, not to overrule a
 * decision. Ties within a type go to the most recently started term, so a
 * renewal replaces the term it renewed rather than the pick flapping between them.
 */
export function pickDefaultAgreement(
  agreements: AgreementChoice[],
  opts: { profileDefaultId?: string | null; now?: Date } = {},
): DefaultAgreementPick | null {
  const now = opts.now ?? new Date();
  const live = agreements.filter((a) => usable(a, now));

  if (opts.profileDefaultId) {
    const chosen = live.find((a) => a.id === opts.profileDefaultId);
    if (chosen) return { id: chosen.id, reason: "profile" };
  }

  for (const { type, reason } of AUTO_TYPES) {
    const matches = live
      .filter((a) => a.type === type)
      .sort((x, y) => startMs(y) - startMs(x) || (x.id < y.id ? -1 : 1));
    const first = matches[0];
    if (first) return { id: first.id, reason };
  }

  return null;
}

function startMs(a: AgreementChoice): number {
  return a.startDate ? a.startDate.getTime() : 0;
}

const REASON_TEXT: Record<DefaultAgreementReason, string> = {
  profile: "the client's configured default agreement",
  "managed-services": "the client's managed services agreement",
  "managed-noc": "the client's managed NOC agreement",
};

/** How the pick is explained in a note or a change-log entry. */
export function describeDefaultAgreement(reason: DefaultAgreementReason): string {
  return REASON_TEXT[reason];
}
