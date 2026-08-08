import "server-only";
import { prisma } from "@/lib/db";
import { buildContext } from "@/connectors/runtime";
import { syncSuperOpsTickets, type SuperOpsConfig, type SuperOpsSecrets } from "@/connectors/superops";
import { syncSuperOpsTicketNotes, type NoteSyncResult } from "@/connectors/superops/sync";
import type { ConnectorContext } from "@/connectors/types";
import type { TicketSyncResult } from "@/connectors/superops/sync";

/**
 * Run one bounded chunk of the resumable SuperOps tickets + worklogs backfill.
 * Builds the connector context (decrypted secrets) and delegates to the
 * connector. Used by the SuperOps Clients page action and the daily cron.
 */
export async function runSuperOpsTicketSync(
  opts: { maxTickets?: number; maxWorklogs?: number } = {},
): Promise<TicketSyncResult> {
  const connector = await prisma.connector.findUnique({ where: { type: "SUPEROPS" } });
  if (!connector) throw new Error("SuperOps connector is not configured.");
  const ctx = (await buildContext(connector)) as unknown as ConnectorContext<
    SuperOpsConfig,
    SuperOpsSecrets
  >;
  return syncSuperOpsTickets(ctx, opts);
}

/**
 * Mirror ticket conversations into `SuperOpsTicketNote`.
 *
 * Separate from the ticket sync because it is per ticket rather than paged, so it
 * is slower and worth running deliberately rather than on every cron tick.
 */
export async function runSuperOpsNoteSync(
  opts: { maxTickets?: number } = {},
): Promise<NoteSyncResult> {
  const connector = await prisma.connector.findUnique({ where: { type: "SUPEROPS" } });
  if (!connector) throw new Error("SuperOps connector is not configured.");
  const ctx = (await buildContext(connector)) as unknown as ConnectorContext<
    SuperOpsConfig,
    SuperOpsSecrets
  >;
  return syncSuperOpsTicketNotes(ctx, opts);
}
