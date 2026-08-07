-- SLA at-risk warnings: stamp when each target's warning was raised.
--
-- Nullable timestamps rather than booleans, because "when" is worth knowing, and
-- because set-once is what keeps the every-fifteen-minutes sweep from re-warning
-- on every pass until people learn to ignore it.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, so this is safe to re-run and safe to paste
-- into the Neon console.
ALTER TABLE "SfTicket" ADD COLUMN IF NOT EXISTS "slaResponseAtRiskAt" TIMESTAMP(3);
ALTER TABLE "SfTicket" ADD COLUMN IF NOT EXISTS "slaResolutionAtRiskAt" TIMESTAMP(3);
