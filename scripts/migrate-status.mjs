#!/usr/bin/env node
/**
 * Answer one question honestly: which migrations in `prisma/migrations/` have
 * actually been applied to the database, and which have not?
 *
 * `prisma migrate status` already does this when it can reach the database. This
 * script exists for the case that kept biting us — no database reachable from
 * where you are standing, migrations applied by hand in the Neon SQL editor, and
 * therefore no confidence that the schema matches the code.
 *
 * Three modes, chosen automatically. Credentials are read from the environment and
 * then from .env / .env.local, because the Prisma CLI loads .env itself and this
 * script previously did not — so it claimed no database was reachable on machines
 * that had one configured all along.
 *
 *   URL + `pg` installed → queries `_prisma_migrations` directly, prints the
 *                          applied / pending split, writes the pending SQL.
 *   URL, no `pg`         → runs `prisma migrate status`, which can reach the
 *                          database without an extra dependency. This is the
 *                          normal path here: `pg` is not a dependency.
 *   No URL at all        → prints the local migration list plus the exact SQL to
 *                          run in the Neon console for the same answer.
 *
 * Note on hand-applied migrations: running a migration's SQL in the Neon editor
 * changes the schema but does NOT record it in `_prisma_migrations`, so Prisma
 * still thinks it is pending. That is why every migration in this repo is written
 * to be idempotent — re-running one is a no-op. Use
 * `npx prisma migrate resolve --applied <name>` to record it properly.
 *
 *   node scripts/migrate-status.mjs
 *   node scripts/migrate-status.mjs --sql   # print pending SQL to stdout
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = "prisma/migrations";
const wantSql = process.argv.includes("--sql");

function localMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => {
      try {
        return statSync(join(MIGRATIONS_DIR, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

const local = localMigrations();

/** The query that answers the question in the Neon SQL editor. */
const STATUS_SQL = `-- Which migrations does the database believe it has applied?
SELECT migration_name,
       finished_at,
       CASE
         WHEN finished_at IS NULL AND rolled_back_at IS NULL THEN 'IN PROGRESS / FAILED'
         WHEN rolled_back_at IS NOT NULL THEN 'ROLLED BACK'
         ELSE 'applied'
       END AS state
FROM "_prisma_migrations"
ORDER BY migration_name;`;

async function fromDatabase(url) {
  // Imported lazily so the no-database path needs no dependencies at all.
  const { Client } = await import("pg").catch(() => ({ Client: null }));
  if (!Client) return null;
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT migration_name, finished_at, rolled_back_at
         FROM "_prisma_migrations" ORDER BY migration_name`,
    );
    return rows;
  } finally {
    await client.end();
  }
}

function pendingSql(names) {
  return names
    .map((name) => {
      const sql = readFileSync(join(MIGRATIONS_DIR, name, "migration.sql"), "utf8");
      return `-- ============================================================\n-- ${name}\n-- ============================================================\n${sql}`;
    })
    .join("\n");
}

/**
 * Read DATABASE_URL/DIRECT_URL from .env when the shell does not already have it.
 *
 * The Prisma CLI loads .env by itself, so `prisma migrate resolve` connects fine
 * while plain `node` sees nothing — which made this script announce "no database
 * reachable" on a machine whose .env was sitting right there. Reporting a missing
 * database when one is configured sends people to the Neon console for an answer
 * they could have had locally.
 *
 * Deliberately minimal: KEY=VALUE, optional `export`, quotes stripped, `#`
 * comments ignored. Not a full dotenv implementation, and it never overwrites a
 * variable the shell already set.
 */
function loadEnvFiles() {
  for (const file of [".env.local", ".env"]) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue; // Absent is normal.
    }
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/i.exec(line);
      if (!match) continue;
      const key = match[1];
      if (process.env[key]) continue; // The shell wins.
      let value = match[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      } else {
        value = value.split(" #")[0].trim();
      }
      process.env[key] = value;
    }
  }
}

loadEnvFiles();
const url = process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!url) {
  console.log(`${local.length} migration(s) in ${MIGRATIONS_DIR}:\n`);
  for (const name of local) console.log(`  ${name}`);
  console.log(
    [
      "",
      "No DATABASE_URL/DIRECT_URL in the environment or in .env / .env.local, so",
      "the database's own history cannot be read from here.",
      "",
      "If you DO have a .env with credentials, `npx prisma migrate status` is the",
      "authoritative check. Otherwise run this in the Neon SQL editor and compare",
      "against the list above — anything in that list but absent from the query",
      "output has not been recorded as applied:",
      "",
      STATUS_SQL,
      "",
      "To emit the SQL for every migration (idempotent, safe to re-run):",
      "  node scripts/migrate-status.mjs --sql > all-migrations.sql",
    ].join("\n"),
  );
  if (wantSql) {
    writeFileSync("all-migrations.sql", pendingSql(local));
    console.log("\nWrote all-migrations.sql");
  }
  process.exit(0);
}

const rows = await fromDatabase(url);
if (rows === null) {
  // `pg` is not a dependency of this project, so this is the normal path, not an
  // error. Prisma's own CLI can reach the database — so run it rather than
  // printing a suggestion and exiting non-zero, which left the question the
  // script exists to answer unanswered.
  console.log("Delegating to Prisma, which can read the database's migration history:\n");
  const { status } = spawnSync("npx", ["prisma", "migrate", "status"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  console.log(
    [
      "",
      `${local.length} migration(s) in this checkout, newest last:`,
      ...local.slice(-5).map((n) => `  ${n}`),
      "",
      "If Prisma reports migrations as pending that you applied by hand in the Neon",
      "console, record them so its history agrees:",
      "  npx prisma migrate resolve --applied <migration_name>",
      "",
      "`resolve --applied` only RECORDS a migration — it does not run the SQL. Record",
      "one whose SQL never ran and the chain claims a column exists that does not.",
    ].join("\n"),
  );
  process.exit(status ?? 0);
}

const applied = new Set(
  rows.filter((r) => r.finished_at && !r.rolled_back_at).map((r) => r.migration_name),
);
const broken = rows.filter((r) => !r.finished_at || r.rolled_back_at);
const pending = local.filter((name) => !applied.has(name));
const unknown = [...applied].filter((name) => !local.includes(name));

console.log(`Applied:  ${applied.size}`);
console.log(`Local:    ${local.length}`);
console.log(`Pending:  ${pending.length}`);

if (broken.length > 0) {
  console.log("\nMigrations recorded but not finished — these WILL block `migrate deploy`:");
  for (const r of broken) {
    console.log(`  ${r.migration_name} (${r.rolled_back_at ? "rolled back" : "never finished"})`);
  }
  console.log("  Fix with: npx prisma migrate resolve --applied <name>");
  console.log("        or: npx prisma migrate resolve --rolled-back <name>");
}

if (unknown.length > 0) {
  // The database knows about migrations this checkout does not — almost always a
  // stale branch rather than a real problem, but worth saying out loud.
  console.log("\nApplied in the database but absent locally (is this branch behind?):");
  for (const name of unknown) console.log(`  ${name}`);
}

if (pending.length === 0) {
  console.log("\nNothing pending — the database's history matches this checkout.");
  process.exit(0);
}

console.log("\nPending:");
for (const name of pending) console.log(`  ${name}`);

const sql = pendingSql(pending);
if (wantSql) {
  console.log(`\n${sql}`);
} else {
  writeFileSync("pending-migrations.sql", sql);
  console.log(
    [
      "",
      "Wrote pending-migrations.sql — paste it into the Neon SQL editor, or apply",
      "properly with `npm run db:deploy`. Every migration here is idempotent, so",
      "re-running one that was already applied by hand is a no-op.",
      "",
      "After applying by hand, record it so Prisma agrees:",
      ...pending.map((n) => `  npx prisma migrate resolve --applied ${n}`),
    ].join("\n"),
  );
}
