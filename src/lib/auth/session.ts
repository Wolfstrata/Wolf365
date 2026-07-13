import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import type { Role } from "@prisma/client";
import { auth } from "@/auth";
import { assertCan, ASSIGNABLE_ROLES, type Permission } from "@/lib/rbac";

/** Cookie holding an administrator's "View as" role override (view-only preview). */
export const VIEW_AS_COOKIE = "wolf365_view_as";

export interface CurrentUser {
  id: string;
  email: string;
  /**
   * Effective role used for ALL permission checks and nav filtering. Equal to
   * {@link realRole} unless an administrator is previewing the app as another
   * role via "View as" (see {@link viewingAs}).
   */
  role: Role;
  /** The user's true role from the session — never lowered by "View as". */
  realRole: Role;
  /** The role an administrator is previewing as, or null when not previewing. */
  viewingAs: Role | null;
  name: string | null;
  image: string | null;
  timezone: string | null;
}

/**
 * Resolve the "View as" override. Only an administrator may preview another
 * role, and the override can only ever REDUCE privileges (an admin sees exactly
 * what the chosen role sees) — never escalate. A forged cookie on a non-admin
 * account is ignored.
 */
async function resolveViewAs(realRole: Role): Promise<Role | null> {
  if (realRole !== "ADMINISTRATOR") return null;
  const value = (await cookies()).get(VIEW_AS_COOKIE)?.value;
  if (!value || value === realRole) return null;
  return ASSIGNABLE_ROLES.includes(value as Role) ? (value as Role) : null;
}

/** Return the current user, or null if not signed in. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) return null;
  const realRole = session.user.role;
  const viewingAs = await resolveViewAs(realRole);
  return {
    id: session.user.id,
    email: session.user.email,
    role: viewingAs ?? realRole,
    realRole,
    viewingAs,
    name: session.user.name ?? null,
    image: session.user.image ?? null,
    timezone: session.user.timezone ?? null,
  };
}

/** Require an authenticated user; redirect to sign-in otherwise. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  return user;
}

/**
 * Require an authenticated user with a specific permission. Throws
 * ForbiddenError (server-side enforcement) if the user lacks it.
 */
export async function requirePermission(
  perm: Permission,
): Promise<CurrentUser> {
  const user = await requireUser();
  assertCan(user.role, perm);
  return user;
}
