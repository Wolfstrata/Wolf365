"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import type { Role } from "@prisma/client";
import { auth } from "@/auth";
import { audit } from "@/lib/audit";
import { ASSIGNABLE_ROLES } from "@/lib/rbac";
import { VIEW_AS_COOKIE } from "@/lib/auth/session";

/**
 * Start or stop previewing the app as another role ("View as"). Authorized by
 * the caller's TRUE session role — only an administrator may preview, and the
 * preview only ever reduces what they can see/do. Passing ADMINISTRATOR (or any
 * unknown value) exits the preview. Audited either way.
 *
 * The real role is read straight from the session (not from the effective,
 * possibly-lowered role) so an admin already previewing as a lesser role can
 * still switch roles or exit.
 */
export async function setViewAsAction(role: string): Promise<void> {
  const session = await auth();
  const realRole = session?.user?.role;
  if (realRole !== "ADMINISTRATOR") return; // only admins may impersonate

  const actorId = session?.user?.id ?? null;
  const actorEmail = session?.user?.email ?? "";
  const jar = await cookies();

  const target =
    role !== "ADMINISTRATOR" && ASSIGNABLE_ROLES.includes(role as Role)
      ? (role as Role)
      : null;

  if (target) {
    jar.set(VIEW_AS_COOKIE, target, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
    await audit({
      action: "VIEW_AS_STARTED",
      actorId,
      actorEmail,
      target: `role:${target}`,
    });
  } else {
    jar.delete(VIEW_AS_COOKIE);
    await audit({ action: "VIEW_AS_STOPPED", actorId, actorEmail, target: "self" });
  }

  revalidatePath("/", "layout");
}
