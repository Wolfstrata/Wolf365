"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { safeErrorMessage } from "@/lib/redact";
import { reconcileAllClients } from "@/lib/reconciliation/service";

export interface ExceptionActionResult {
  ok: boolean;
  message: string;
}

/** Re-run discrepancy detection across all clients and refresh the queue. */
export async function runReconciliationAction(
  _prev: ExceptionActionResult | null,
  _formData: FormData,
): Promise<ExceptionActionResult> {
  const user = await requirePermission("mappings:propose");
  try {
    const r = await reconcileAllClients({ id: user.id, email: user.email });
    revalidatePath("/exceptions");
    revalidatePath("/");
    const suffix = r.suppressed
      ? ` · ${r.suppressed} suppressed via parent/subsidiary links`
      : "";
    return {
      ok: true,
      message: `Reconciled ${r.scanned} clients — ${r.flagged} open discrepanc${
        r.flagged === 1 ? "y" : "ies"
      }${suffix}.`,
    };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

/** Dismiss (resolve) or acknowledge a single exception. */
export async function setExceptionStatusAction(formData: FormData): Promise<void> {
  await requirePermission("mappings:propose");
  const id = String(formData.get("id"));
  if (!id) return;
  const status = String(formData.get("status")) === "ACKNOWLEDGED" ? "ACKNOWLEDGED" : "RESOLVED";
  await prisma.exception.update({
    where: { id },
    data: { status, resolvedAt: status === "RESOLVED" ? new Date() : null },
  });
  revalidatePath("/exceptions");
  revalidatePath("/");
}
