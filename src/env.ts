import { z } from "zod";

/**
 * Server-side environment validation.
 *
 * Imported by server code at startup (and by `instrumentation.ts`). If a
 * required variable is missing or malformed we fail loudly rather than letting
 * the app boot into a broken/insecure state.
 *
 * Connector credentials are intentionally NOT defined here — they are entered
 * by an admin in-app and encrypted at rest. The only app-level secret is
 * WOLF365_ENCRYPTION_KEY, used to encrypt those credentials.
 */
const serverSchema = z.object({
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid Postgres URL"),
  // DIRECT_URL is only required for migrations; optional at runtime.
  DIRECT_URL: z.string().url().optional(),

  // 32-byte key, base64-encoded (44 base64 chars). Validated precisely so a
  // weak/short key can never silently weaken encryption.
  WOLF365_ENCRYPTION_KEY: z
    .string()
    .refine((v) => {
      try {
        return Buffer.from(v, "base64").length === 32;
      } catch {
        return false;
      }
    }, "WOLF365_ENCRYPTION_KEY must be a base64-encoded 32-byte key"),

  AUTH_SECRET: z.string().min(16, "AUTH_SECRET must be set (>=16 chars)"),
  AUTH_URL: z.string().url().optional(),

  // Optional first-run Entra SSO bootstrap. Used ONLY until SSO is configured
  // in-app (SsoSettings row). Lets a bootstrap admin sign in to configure SSO.
  ENTRA_TENANT_ID: z.string().optional(),
  ENTRA_CLIENT_ID: z.string().optional(),
  ENTRA_CLIENT_SECRET: z.string().optional(),

  WOLF365_BOOTSTRAP_ADMINS: z.string().optional().default(""),

  // Optional static-IP egress proxy. When set, all connector API calls are
  // routed through it so they originate from a fixed IP (e.g. for QuickBooks
  // production IP allowlisting). Format: http(s)://user:pass@host:port
  OUTBOUND_PROXY_URL: z.string().url().optional(),

  // Shared secret used to authenticate Vercel Cron invocations. Optional in
  // development; required for the cron endpoint to do any work.
  CRON_SECRET: z.string().optional(),
  // Debug-log retention in days (30–90 typical).
  WOLF365_DEBUG_LOG_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  // Neon control-plane API access for database backups (branch snapshots).
  // Both must be set for in-app/scheduled Neon backups; if either is missing
  // the backup UI shows "not configured" and only the JSON export works.
  NEON_API_KEY: z.string().optional(),
  NEON_PROJECT_ID: z.string().optional(),
  // Production/default branch to restore INTO. Optional — auto-detected from
  // the project's default branch when blank.
  NEON_BRANCH_ID: z.string().optional(),
  // How long to keep Neon backup branches before they're pruned.
  BACKUP_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  // Where in-app "Contact support" links point. An email address (rendered as a
  // mailto:) or an http(s) support URL. Defaults to the shared support inbox.
  WOLF365_SUPPORT_CONTACT: z.string().default("rperumal@wolfstrata.com"),

  // Bearer token that external workflows (e.g. ZoomInfo) use to POST leads to
  // /api/leads. The endpoint refuses all requests until this is set.
  WOLF365_LEADS_TOKEN: z.string().optional(),

  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

/**
 * Parse and cache the validated environment. Throws on first invalid access.
 * Use this instead of reading process.env directly in server code.
 */
export function getEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment configuration:\n${issues}\n` +
        "See .env.example for the required variables.",
    );
  }
  cached = parsed.data;
  return cached;
}

/** Parsed list of bootstrap admin emails (lowercased). */
export function getBootstrapAdmins(): string[] {
  return getEnv()
    .WOLF365_BOOTSTRAP_ADMINS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}
