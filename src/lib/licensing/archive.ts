import "server-only";
import { prisma } from "@/lib/db";

/**
 * Idempotently ensure the `archived` column exists on TdSynnexSubscription **on
 * the app's own database connection**. This repairs the "migration recorded as
 * applied but column physically missing" drift that occurs when migrations were
 * applied to a different database than DATABASE_URL points to. Mirrors the
 * migration SQL exactly, so it never diverges from the Prisma model.
 *
 * Memoized per server instance: the read paths that filter on `archived` (the
 * dashboard, expired report, client profile) call this so they never 500 before
 * the migration is deployed, but the DDL runs at most once per cold start.
 */
let ensured = false;
export async function ensureArchiveColumn(): Promise<void> {
  if (ensured) return;
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "TdSynnexSubscription" ADD COLUMN IF NOT EXISTS "archived" BOOLEAN NOT NULL DEFAULT false`,
  );
  // `vendor` is queried alongside `archived` to keep the app M365-only; ensure it
  // exists on the same paths so reads never 500 before the migration deploys.
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "TdSynnexSubscription" ADD COLUMN IF NOT EXISTS "vendor" TEXT`,
  );
  ensured = true;
}
