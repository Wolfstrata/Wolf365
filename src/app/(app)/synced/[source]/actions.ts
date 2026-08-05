"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { safeErrorMessage } from "@/lib/redact";
import { runSync } from "@/connectors/runtime";
import { runSuperOpsTicketSync } from "@/lib/superops/tickets";

export interface SyncActionResult {
  ok: boolean;
  message: string;
}

/** Sync SuperOps account-level data (clients, sites, contacts, assets, contracts, invoices). */
export async function syncSuperOpsAction(
  _prev: SyncActionResult | null,
  _formData: FormData,
): Promise<SyncActionResult> {
  const user = await requirePermission("connectors:sync");
  try {
    const r = await runSync("SUPEROPS", "manual", user.id);
    const s = (r.summary ?? {}) as Record<string, unknown>;
    revalidatePath("/synced/superops");
    return {
      ok: true,
      message: `Synced ${s.clients ?? 0} clients, ${s.sites ?? 0} sites, ${s.contacts ?? 0} contacts, ${s.assets ?? 0} assets, ${s.contracts ?? 0} contracts, ${s.invoices ?? 0} invoices.`,
    };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

/** Run one bounded chunk of the resumable tickets + worklogs backfill. */
export async function syncSuperOpsTicketsAction(
  _prev: SyncActionResult | null,
  _formData: FormData,
): Promise<SyncActionResult> {
  await requirePermission("connectors:sync");
  try {
    const r = await runSuperOpsTicketSync();
    revalidatePath("/synced/superops");
    const done = r.ticketsDone && r.worklogsDone;
    const errNote = r.error ? ` (partial: ${r.error})` : "";
    return {
      ok: !r.error,
      message: `Synced ${r.tickets} tickets + ${r.worklogs} worklogs.${done ? " Backfill complete." : " Click again to continue."}${errNote}`,
    };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}
