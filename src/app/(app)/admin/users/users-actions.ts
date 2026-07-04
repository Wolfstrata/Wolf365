"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { safeErrorMessage } from "@/lib/redact";

export interface UserActionResult {
  ok: boolean;
  message: string;
}

const createSchema = z.object({
  email: z.string().trim().email("Enter a valid email address"),
  name: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().optional(),
  ),
  role: z.enum(Role),
});

const roleSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(Role),
});

const disableSchema = z.object({
  userId: z.string().min(1),
  disabled: z.enum(["true", "false"]),
});

/** Count of enabled administrators — used to prevent locking everyone out. */
async function enabledAdminCount(): Promise<number> {
  return prisma.user.count({
    where: { role: "ADMINISTRATOR", disabled: false },
  });
}

/** Pre-create (invite) a user so they can sign in. Sign-in is invite-only:
 *  only users that exist here (or a bootstrap admin) may authenticate. */
export async function createUserAction(
  _prev: UserActionResult | null,
  formData: FormData,
): Promise<UserActionResult> {
  const actor = await requirePermission("users:manage");
  try {
    const { email, name, role } = createSchema.parse({
      email: formData.get("email"),
      name: formData.get("name"),
      role: formData.get("role"),
    });
    const lower = email.toLowerCase();

    const existing = await prisma.user.findUnique({ where: { email: lower } });
    if (existing) {
      return { ok: false, message: `${lower} already exists.` };
    }

    await prisma.user.create({
      data: { email: lower, name: name ?? null, role },
    });
    await audit({
      action: "USER_CREATED",
      actorId: actor.id,
      actorEmail: actor.email,
      target: `user:${lower}`,
      metadata: { email: lower, role },
    });
    revalidatePath("/admin/users");
    return {
      ok: true,
      message: `Invited ${lower} as ${role}. They can now sign in with Microsoft 365.`,
    };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

/** Change a user's role. Admin-only; guards against removing the last admin. */
export async function setUserRoleAction(
  _prev: UserActionResult | null,
  formData: FormData,
): Promise<UserActionResult> {
  const actor = await requirePermission("users:manage");
  try {
    const { userId, role } = roleSchema.parse({
      userId: formData.get("userId"),
      role: formData.get("role"),
    });

    const target = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (target.role === role) {
      return { ok: true, message: `${target.email} is already ${role}.` };
    }

    // Don't allow demoting the last remaining enabled administrator.
    if (
      target.role === "ADMINISTRATOR" &&
      role !== "ADMINISTRATOR" &&
      !target.disabled &&
      (await enabledAdminCount()) <= 1
    ) {
      return {
        ok: false,
        message:
          "This is the only active Administrator. Promote another user first.",
      };
    }

    await prisma.user.update({ where: { id: userId }, data: { role } });
    await audit({
      action: "USER_ROLE_CHANGED",
      actorId: actor.id,
      actorEmail: actor.email,
      target: `user:${userId}`,
      metadata: { email: target.email, from: target.role, to: role },
    });
    revalidatePath("/admin/users");
    return { ok: true, message: `${target.email} is now ${role}.` };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

/** Enable or disable a user's access. Admin-only; cannot disable yourself or
 *  the last active administrator. */
export async function setUserDisabledAction(
  _prev: UserActionResult | null,
  formData: FormData,
): Promise<UserActionResult> {
  const actor = await requirePermission("users:manage");
  try {
    const { userId, disabled } = disableSchema.parse({
      userId: formData.get("userId"),
      disabled: formData.get("disabled"),
    });
    const wantDisabled = disabled === "true";

    if (userId === actor.id && wantDisabled) {
      return { ok: false, message: "You cannot disable your own account." };
    }

    const target = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (target.disabled === wantDisabled) {
      return { ok: true, message: "No change." };
    }

    if (
      wantDisabled &&
      target.role === "ADMINISTRATOR" &&
      (await enabledAdminCount()) <= 1
    ) {
      return {
        ok: false,
        message:
          "This is the only active Administrator. Promote another user first.",
      };
    }

    await prisma.user.update({
      where: { id: userId },
      data: { disabled: wantDisabled },
    });
    // Disabling a user kills their active sessions immediately.
    if (wantDisabled) {
      await prisma.session.deleteMany({ where: { userId } });
    }
    await audit({
      action: wantDisabled ? "USER_DISABLED" : "USER_ENABLED",
      actorId: actor.id,
      actorEmail: actor.email,
      target: `user:${userId}`,
      metadata: { email: target.email },
    });
    revalidatePath("/admin/users");
    return {
      ok: true,
      message: `${target.email} ${wantDisabled ? "disabled" : "enabled"}.`,
    };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}
