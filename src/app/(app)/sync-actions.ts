"use server";

import { revalidatePath } from "next/cache";
import type { ConnectorType } from "@prisma/client";
import { requirePermission } from "@/lib/auth/session";
import { runSync } from "@/connectors/runtime";
import { reconcileAllClients } from "@/lib/reconciliation/service";
import { safeErrorMessage } from "@/lib/redact";

export interface SyncActionResult {
  ok: boolean;
  message: string;
}

/** Run a manual sync for a connector, gated by connectors:sync. */
async function runManualSync(
  type: ConnectorType,
  label: string,
): Promise<SyncActionResult> {
  const user = await requirePermission("connectors:sync");
  try {
    const r = await runSync(type, "manual", user.id);
    // Re-evaluate discrepancies with the fresh data + current rules so stale
    // exceptions (name/address near-matches, QBO-only) auto-clear. Best-effort.
    try {
      await reconcileAllClients({ id: user.id, email: user.email });
    } catch {
      /* reconciliation failure must not fail the sync */
    }
    revalidatePath("/");
    revalidatePath("/exceptions");
    return {
      ok: true,
      message: `${label} sync complete — imported ${r.imported}, updated ${r.updated}, skipped ${r.skipped}.`,
    };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

export async function syncTdSynnexAction(
  _prev: SyncActionResult | null,
  _formData: FormData,
): Promise<SyncActionResult> {
  return runManualSync("TD_SYNNEX_STELLR", "TD SYNNEX");
}

export async function syncQboAction(
  _prev: SyncActionResult | null,
  _formData: FormData,
): Promise<SyncActionResult> {
  return runManualSync("QUICKBOOKS_ONLINE", "QuickBooks Online");
}
