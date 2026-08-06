"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { safeErrorMessage } from "@/lib/redact";
import { runSync } from "@/connectors/runtime";
import { runSuperOpsTicketSync } from "@/lib/superops/tickets";
import { materializeClients } from "@/lib/mapping/service";

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

    // A zero that means "the API returned none" and a zero that means "hundreds
    // came back and none could be stored" used to read identically. Name the
    // skips so a silent drop can't hide behind a clean-looking count.
    const skipped = (s.skippedByEntity ?? {}) as Record<string, number>;
    const skipNote = Object.entries(skipped)
      .filter(([, n]) => n > 0)
      .map(([entity, n]) => `${n} ${entity}`)
      .join(", ");

    return {
      ok: true,
      message:
        `Synced ${s.clients ?? 0} clients, ${s.sites ?? 0} sites, ${s.contacts ?? 0} contacts, ${s.assets ?? 0} assets, ${s.contracts ?? 0} contracts, ${s.invoices ?? 0} invoices.` +
        (skipNote
          ? ` Could not store: ${skipNote} — see Debug Logs for the "_skip_shape" entry, which records why.`
          : ""),
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

/**
 * Sync Hudu companies, assets and documentation links, then link companies to
 * Wolf365 clients by name so the data reaches the SilverFang client pages.
 */
export async function syncHuduAction(
  _prev: SyncActionResult | null,
  _formData: FormData,
): Promise<SyncActionResult> {
  const user = await requirePermission("connectors:sync");
  try {
    const r = await runSync("HUDU", "manual", user.id);
    const s = (r.summary ?? {}) as Record<string, unknown>;

    // Linking is what makes the sync visible in SilverFang, so it runs here
    // rather than waiting for a separate mapping pass. Best-effort: a failure to
    // link must not present the sync itself as failed.
    let linked: number | null = null;
    try {
      const m = await materializeClients({ id: user.id, email: user.email });
      linked = m.merged;
    } catch {
      linked = null;
    }

    revalidatePath("/synced/hudu");
    revalidatePath("/silverfang/clients");

    const skipped = (s.skippedByEntity ?? {}) as Record<string, number>;
    const skipNote = Object.entries(skipped)
      .filter(([, n]) => n > 0)
      .map(([entity, n]) => `${n} ${entity}`)
      .join(", ");
    const errors = (s.errors ?? {}) as Record<string, string>;
    const errNote = Object.keys(errors).length
      ? ` Some entities failed: ${Object.entries(errors)
          .map(([k, v]) => `${k} (${v})`)
          .join("; ")}.`
      : "";

    return {
      ok: Object.keys(errors).length === 0,
      message:
        `Synced ${s.companies ?? 0} companies, ${s.assets ?? 0} assets, ${s.articles ?? 0} documentation links.` +
        (linked != null ? ` ${linked} company(ies) matched to a Wolf365 client.` : "") +
        (skipNote ? ` Skipped: ${skipNote} (no matching Hudu company held locally).` : "") +
        errNote +
        ` Confidential Hudu fields are never copied — ${s.redactedFields ?? 0} withheld.`,
    };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}
