-- Per-client "archived" flag so finance users can file away an entire client
-- (hidden from the M365 clients list, dashboard, reports, and billing picker),
-- plus audit actions for the toggle. Idempotent.

ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "archived" BOOLEAN NOT NULL DEFAULT false;

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CLIENT_ARCHIVED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CLIENT_UNARCHIVED';
