"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { safeErrorMessage } from "@/lib/redact";
import { runNeonBackup, restoreFromBackup } from "@/lib/backup/service";

export interface BackupActionResult {
  ok: boolean;
  message: string;
}

/** Trigger an on-demand Neon backup snapshot. */
export async function triggerBackupAction(
  _prev: BackupActionResult | null,
  _formData: FormData,
): Promise<BackupActionResult> {
  const actor = await requirePermission("backups:manage");
  try {
    const result = await runNeonBackup({
      trigger: "MANUAL",
      actor: { id: actor.id, email: actor.email },
      now: new Date(),
    });
    revalidatePath("/admin/backup");
    return { ok: result.ok, message: result.message };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

/**
 * Restore the production database from a snapshot. DESTRUCTIVE — overwrites all
 * current data. Requires the typed confirmation to match the snapshot name.
 */
export async function restoreBackupAction(
  _prev: BackupActionResult | null,
  formData: FormData,
): Promise<BackupActionResult> {
  const actor = await requirePermission("backups:manage");
  const backupId = String(formData.get("backupId") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");
  if (!backupId) return { ok: false, message: "Missing snapshot id." };
  try {
    const result = await restoreFromBackup({
      backupId,
      confirmation,
      actor: { id: actor.id, email: actor.email },
      now: new Date(),
    });
    revalidatePath("/admin/backup");
    return { ok: result.ok, message: result.message };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}
