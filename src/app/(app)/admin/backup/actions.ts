"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { safeErrorMessage } from "@/lib/redact";
import { runNeonBackup, restoreFromBackup, dryRunRestore } from "@/lib/backup/service";
import { checkNeonAccess } from "@/lib/backup/neon";

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
 * Validate the restore API end-to-end on disposable test branches. Never
 * touches production; cleans up after itself.
 */
export async function dryRunRestoreAction(
  _prev: BackupActionResult | null,
  _formData: FormData,
): Promise<BackupActionResult> {
  await requirePermission("backups:manage");
  try {
    const result = await dryRunRestore({ now: new Date() });
    return { ok: result.ok, message: result.message };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

/** Read-only Neon connectivity check (GET-only; never restores or mutates). */
export async function checkNeonAccessAction(
  _prev: BackupActionResult | null,
  _formData: FormData,
): Promise<BackupActionResult> {
  await requirePermission("backups:manage");
  try {
    const result = await checkNeonAccess();
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
