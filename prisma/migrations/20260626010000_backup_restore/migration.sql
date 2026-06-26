-- Restore-from-snapshot feature: new audit action. Idempotent; the value is not
-- referenced within this migration, so ADD VALUE is transaction-safe.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'BACKUP_RESTORED';
