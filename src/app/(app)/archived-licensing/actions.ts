"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/session";
import { safeErrorMessage } from "@/lib/redact";
import { ensureArchiveColumn } from "@/lib/licensing/archive";

export interface ArchiveActionResult {
  ok: boolean;
  message: string;
}

/**
 * Archive or restore a single M365 (TD SYNNEX) subscription. Archiving files the
 * license away — it disappears from the expired report, dashboard counts, and the
 * client profile, and shows only under "M365 Archived Clients". Restoring returns
 * it everywhere. Per-subscription only; never touches the rest of the client.
 * Gated by billing:edit and audited.
 */
export async function setLicenseArchivedAction(
  subscriptionId: string,
  archived: boolean,
): Promise<ArchiveActionResult> {
  const user = await requirePermission("billing:edit");
  try {
    await ensureArchiveColumn();
    await prisma.tdSynnexSubscription.update({
      where: { id: subscriptionId },
      data: { archived },
    });
    await audit({
      action: archived ? "LICENSE_ARCHIVED" : "LICENSE_UNARCHIVED",
      actorId: user.id,
      actorEmail: user.email,
      target: `tdSynnexSubscription:${subscriptionId}`,
    });
    revalidatePath("/reports/expired");
    revalidatePath("/archived-licensing");
    revalidatePath("/");
    revalidatePath("/clients/[id]", "page");
    return { ok: true, message: archived ? "License archived." : "License restored." };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}
