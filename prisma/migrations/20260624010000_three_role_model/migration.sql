-- Collapse the role model to three roles: ADMINISTRATOR, POWER_USER, REVIEWER.
-- Existing users are remapped (least-privilege for ambiguous middle roles):
--   OWNER             -> ADMINISTRATOR
--   ACCOUNTING_MANAGER -> POWER_USER
--   ACCOUNTING_USER   -> REVIEWER   (re-elevate via Admin → Users if needed)
--   AUDITOR           -> REVIEWER
-- Idempotent: the new enum is created guarded, and the conversion maps from the
-- column's text values so it tolerates partial application.

DO $$ BEGIN
  CREATE TYPE "Role_new" AS ENUM ('ADMINISTRATOR', 'POWER_USER', 'REVIEWER');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- The default references the old enum; drop it before converting the column.
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;

ALTER TABLE "User"
  ALTER COLUMN "role" TYPE "Role_new"
  USING (
    CASE "role"::text
      WHEN 'OWNER' THEN 'ADMINISTRATOR'
      WHEN 'ACCOUNTING_MANAGER' THEN 'POWER_USER'
      WHEN 'ACCOUNTING_USER' THEN 'REVIEWER'
      WHEN 'AUDITOR' THEN 'REVIEWER'
      WHEN 'ADMINISTRATOR' THEN 'ADMINISTRATOR'
      WHEN 'POWER_USER' THEN 'POWER_USER'
      ELSE 'REVIEWER'
    END
  )::"Role_new";

-- Swap the old enum out for the new one and restore a least-privilege default.
DROP TYPE IF EXISTS "Role";
ALTER TYPE "Role_new" RENAME TO "Role";
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'REVIEWER';

-- New audit actions for user enable/disable (idempotent).
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'USER_DISABLED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'USER_ENABLED';
