-- Add per-user timezone preference for displaying timestamps.
ALTER TABLE "User" ADD COLUMN "timezone" TEXT;
