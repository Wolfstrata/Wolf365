-- A dedicated audit action for key rotation.
--
-- It had been recorded as SSO_SETTINGS_CHANGED, which made the one operation that
-- touches every stored secret and every encrypted personal-data column
-- unfindable as itself.
--
-- ADD VALUE IF NOT EXISTS is idempotent. It cannot run inside a transaction block
-- on PostgreSQL below 12; Neon is well past that, so this is safe as written.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ENCRYPTION_KEY_ROTATED';
