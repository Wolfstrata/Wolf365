/**
 * Who is allowed to log time against an agreement or a project.
 *
 * The rule that matters most: **an empty list means everyone**. A restriction
 * that switched itself on the moment the feature shipped would have stopped the
 * whole team logging time against every existing agreement, and "nobody can log
 * time and nobody knows why" is a far worse failure than an unrestricted
 * agreement. The restriction exists only once somebody names the techs.
 *
 * The point of the feature is preventing accidents — a tech drawing down another
 * client's prepaid block, or booking hours to a project they are not on. So the
 * check is applied to everyone, administrators included. The escape hatch is not
 * a role bypass; it is that the tech list itself is editable by anyone who can
 * configure SilverFang, and that edit is audited.
 *
 * Pure and tested, because the consequence of getting it wrong is either
 * mis-billed prepaid hours or a team that cannot log time at all.
 */

export interface Restriction {
  /** The user ids named on the agreement or project. Empty = unrestricted. */
  authorizedUserIds: string[];
  /** What is being restricted, for the message: "agreement" or "project". */
  kind: "agreement" | "project";
  /** Its name, for the message. */
  name: string;
}

export interface AuthorizationVerdict {
  allowed: boolean;
  /** True when a list exists at all — what drives the greying in a list view. */
  restricted: boolean;
  /** Why not, phrased for a technician. Null when allowed. */
  reason: string | null;
}

/** Whether this user may log time / edit, and why not if they may not. */
export function checkAuthorized(
  restriction: Restriction,
  userId: string | null | undefined,
): AuthorizationVerdict {
  const ids = restriction.authorizedUserIds;
  if (ids.length === 0) {
    return { allowed: true, restricted: false, reason: null };
  }
  if (userId && ids.includes(userId)) {
    return { allowed: true, restricted: true, reason: null };
  }
  return {
    allowed: false,
    restricted: true,
    reason: describeRefusal(restriction),
  };
}

/**
 * The refusal, written as something a tech can act on.
 *
 * Names who to ask rather than only stating the rule: "not authorised" with no
 * next step is the kind of message that generates a Teams thread.
 */
export function describeRefusal(restriction: Restriction): string {
  const what = restriction.kind === "agreement" ? "agreement" : "project";
  return (
    `“${restriction.name}” has an authorised-technician list and you are not on it, so ` +
    `time cannot be logged against this ${what}. Ask a SilverFang administrator to add ` +
    `you to the ${what}’s authorised technicians. You can still open it and read everything.`
  );
}

/** The badge text for a restricted row in a list. */
export function restrictionLabel(verdict: AuthorizationVerdict): string | null {
  if (!verdict.restricted) return null;
  return verdict.allowed ? "Restricted — you're authorised" : "Restricted — view only";
}

/**
 * Which of a user's candidate time targets block the entry.
 *
 * A ticket can carry both an agreement and a project, and both can be
 * restricted. Every blocking reason is returned rather than only the first,
 * because being told about one and then hitting the other is two round trips for
 * one problem.
 */
export function blockingReasons(
  restrictions: Restriction[],
  userId: string | null | undefined,
): string[] {
  return restrictions
    .map((r) => checkAuthorized(r, userId))
    .filter((v) => !v.allowed)
    .map((v) => v.reason!)
    .filter(Boolean);
}

/**
 * Split a submitted list of user ids into a clean set.
 *
 * Deduped and blank-stripped so a form that posts an empty option, or the same
 * tech twice, cannot produce a composite-key collision on insert.
 */
export function normalizeTechIds(raw: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  for (const value of raw) {
    const id = (value ?? "").trim();
    if (id) seen.add(id);
  }
  return [...seen];
}
