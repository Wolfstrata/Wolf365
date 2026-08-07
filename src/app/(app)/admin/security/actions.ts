"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { safeErrorMessage } from "@/lib/redact";

export interface SsoActionResult {
  ok: boolean;
  message: string;
}

const ssoInputSchema = z.object({
  tenantId: z.string().min(1, "Tenant ID is required"),
  clientId: z.string().min(1, "Client ID is required"),
  allowedDomains: z.string().optional().default(""),
  groupMappings: z.string().optional().default(""),
});

/** Parse "groupObjectId:ROLE" lines into a validated mapping object. */
function parseGroupMappings(raw: string): Record<string, Role> {
  const out: Record<string, Role> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [group, role] = trimmed.split(/[:=]/).map((s) => s?.trim());
    if (!group || !role) continue;
    if (!(role in Role)) {
      throw new Error(`Invalid role "${role}" (use one of ${Object.keys(Role).join(", ")})`);
    }
    out[group] = role as Role;
  }
  return out;
}

export async function saveSsoSettingsAction(
  _prev: SsoActionResult | null,
  formData: FormData,
): Promise<SsoActionResult> {
  const user = await requirePermission("sso:configure");
  try {
    const parsed = ssoInputSchema.parse({
      tenantId: formData.get("tenantId"),
      clientId: formData.get("clientId"),
      allowedDomains: formData.get("allowedDomains") ?? "",
      groupMappings: formData.get("groupMappings") ?? "",
    });
    const clientSecret = (formData.get("clientSecret") as string | null)?.trim() ?? "";

    const allowedDomains = parsed.allowedDomains
      .split(/[,\n]/)
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
    const groupRoleMappings = parseGroupMappings(parsed.groupMappings);

    const existing = await prisma.ssoSettings.findFirst({
      where: { active: true },
      orderBy: { updatedAt: "desc" },
    });

    // Require a secret on first setup; allow keeping the stored one on edit.
    if (!existing && !clientSecret) {
      return { ok: false, message: "Client Secret is required for initial setup." };
    }

    const clientSecretEnc = clientSecret
      ? encrypt(clientSecret)
      : existing!.clientSecretEnc;

    if (existing) {
      await prisma.ssoSettings.update({
        where: { id: existing.id },
        data: {
          tenantId: parsed.tenantId,
          clientId: parsed.clientId,
          clientSecretEnc,
          allowedDomains,
          groupRoleMappings,
          updatedBy: user.email,
        },
      });
    } else {
      await prisma.ssoSettings.create({
        data: {
          tenantId: parsed.tenantId,
          clientId: parsed.clientId,
          clientSecretEnc,
          allowedDomains,
          groupRoleMappings,
          updatedBy: user.email,
        },
      });
    }

    await audit({
      action: "SSO_SETTINGS_CHANGED",
      actorId: user.id,
      actorEmail: user.email,
      target: "sso",
      metadata: {
        tenantId: parsed.tenantId,
        domains: allowedDomains.length,
        groupMappings: Object.keys(groupRoleMappings).length,
      },
    });
    revalidatePath("/admin/security");
    return { ok: true, message: "SSO settings saved. New sign-ins will use them." };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

/**
 * Re-encrypt stored secrets under the current WOLF365_ENCRYPTION_KEY.
 *
 * Lives here rather than in a local script because the keys are Vercel
 * environment variables: rotation has to run where the app runs, not on a laptop
 * that happens to have a copy of them.
 *
 * Bounded per click and resumable, so a large database is rotated by pressing it
 * again rather than by holding a request open.
 */
export async function rotateEncryptionKeysAction(
  _prev: SsoActionResult | null,
  _formData: FormData,
): Promise<SsoActionResult> {
  const user = await requirePermission("sso:configure");
  try {
    const { rotateWithAudit } = await import("@/lib/crypto-rotate");
    const r = await rotateWithAudit({ id: user.id, email: user.email });
    revalidatePath("/admin/security");

    const parts = [
      `${r.rotated} re-encrypted`,
      r.encrypted > 0 ? `${r.encrypted} newly encrypted` : null,
      `${r.skipped} already current`,
      r.failed > 0 ? `${r.failed} failed` : null,
    ].filter(Boolean);

    return {
      ok: r.failed === 0,
      message:
        `${parts.join(", ")}. ` +
        (r.status.complete
          ? "Everything is under the current key — you can now remove WOLF365_ENCRYPTION_KEYS_OLD."
          : `${r.status.outstanding} value(s) still on a retired key — run it again.`) +
        (r.errors.length > 0 ? ` First error: ${r.errors[0]}` : ""),
    };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}
