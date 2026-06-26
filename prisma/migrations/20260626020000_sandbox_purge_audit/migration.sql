-- Audit action for removing non-production (sandbox) QuickBooks data.
-- Idempotent; the value is not referenced in this migration, so ADD VALUE is
-- transaction-safe.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SANDBOX_DATA_PURGED';
