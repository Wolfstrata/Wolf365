-- Add the FINANCIAL_POWER_USER role: same as POWER_USER but with no access to
-- the Administration section (connector credentials, debug logs, audit log,
-- users, security, backups). Idempotent (safe to re-run).

ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'FINANCIAL_POWER_USER';
