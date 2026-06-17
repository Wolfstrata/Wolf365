import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { auth } from "@/auth";
import { assertCan, type Permission } from "@/lib/rbac";

export interface CurrentUser {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  image: string | null;
  timezone: string | null;
}

/** Return the current user, or null if not signed in. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) return null;
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name ?? null,
    role: session.user.role,
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
