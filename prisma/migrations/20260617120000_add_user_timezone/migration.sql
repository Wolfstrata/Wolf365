-- Add per-user timezone preference for displaying timestamps. Idempotent.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "timezone" TEXT;
