-- Add BILLING_RUN_DELETED to the AuditAction enum so clearing draft/cancelled
-- billing runs can be audited. Idempotent (safe to re-run).

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'BILLING_RUN_DELETED';
