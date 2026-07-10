-- Per-subscription "archived" flag so finance users can file away individual
-- expired M365 licenses, plus audit actions for the toggle. Idempotent.

ALTER TABLE "TdSynnexSubscription" ADD COLUMN IF NOT EXISTS "archived" BOOLEAN NOT NULL DEFAULT false;

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'LICENSE_ARCHIVED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'LICENSE_UNARCHIVED';
