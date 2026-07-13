-- Audit actions for administrator "View as" role preview (impersonation is
-- view-only and never escalates privileges, but is recorded for security). Idempotent.

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'VIEW_AS_STARTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'VIEW_AS_STOPPED';
