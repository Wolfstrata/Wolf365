#!/usr/bin/env node
/**
 * Apply pending Prisma migrations during the Vercel build.
 *
 * Why this exists: migrations used to be applied only by the `migrate.yml` GitHub
 * Action. When that stopped getting runners assigned, every migration had to be
 * pasted into the Neon SQL editor by hand — which is both laborious and the kind
 * of manual step that eventually gets skipped, leaving deployed code running
 * against a schema that does not have its columns. Tying the migration to the
 * deploy makes the two impossible to separate: if the schema cannot be applied,
 * the build fails and the old code keeps serving.
 *
 * Safety rules, in order of importance:
 *
 *   1. PRODUCTION ONLY. Preview and development builds skip entirely. Vercel
 *      shares environment variables across environments by default, so without
 *      this a preview build of any feature branch would migrate the production
 *      database — the worst possible outcome of a convenience feature.
 *   2. Missing credentials in production are a hard failure, not a silent skip.
 *      A build that quietly ships without migrating is exactly the situation this
 *      script exists to prevent.
 *   3. `prisma migrate deploy` is idempotent and takes an advisory lock, so
 *      concurrent builds cannot interleave DDL.
 *   4. SKIP_DB_MIGRATE=1 is the escape hatch for a deploy that must go out while
 *      the database is being worked on by hand. It logs loudly.
 */
import { spawnSync } from "node:child_process";

const env = process.env.VERCEL_ENV ?? (process.env.VERCEL ? "unknown" : "local");
const isProduction = env === "production";

function log(msg) {
  console.log(`[migrate-on-deploy] ${msg}`);
}

if (process.env.SKIP_DB_MIGRATE === "1") {
  log("SKIP_DB_MIGRATE=1 — skipping migrations. The deployed code may expect");
  log("columns the database does not have. Apply them before relying on it.");
  process.exit(0);
}

if (!isProduction) {
  log(`VERCEL_ENV=${env} — not production, so no migrations are applied.`);
  log("Preview builds must never migrate the production database.");
  process.exit(0);
}

// Prisma needs the direct (non-pooled) URL for DDL; the pooled one can drop the
// session that holds the advisory lock.
const missing = ["DATABASE_URL", "DIRECT_URL"].filter((k) => !process.env[k]);
if (missing.length > 0) {
  log(`FAILING THE BUILD: ${missing.join(" and ")} not set in production.`);
  log("Without them the schema cannot be applied, and shipping code that");
  log("expects a newer schema than the database has is worse than not shipping.");
  log("Set them in Vercel → Settings → Environment Variables (Production).");
  process.exit(1);
}

log("Applying pending migrations (prisma migrate deploy)…");
const result = spawnSync("npx", ["--yes", "prisma@6.19.3", "migrate", "deploy"], {
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
});

if (result.status !== 0) {
  log("Migration failed — failing the build so the previous deployment keeps serving.");
  log("Fix the migration, then redeploy. Nothing has been half-applied: each");
  log("migration runs in its own transaction and the history records only those");
  log("that completed.");
  process.exit(result.status ?? 1);
}
log("Migrations applied.");
