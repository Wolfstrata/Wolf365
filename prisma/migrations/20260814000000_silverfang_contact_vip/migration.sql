-- VIP contacts.
--
-- A VIP's tickets sort above others AT THE SAME PRIORITY. It deliberately does not
-- outrank priority, so flagging someone cannot push their routine request ahead of
-- an outage.
--
-- Idempotent, so this is safe to re-run and safe to paste into the Neon console.
ALTER TABLE "SfContact" ADD COLUMN IF NOT EXISTS "vip" BOOLEAN NOT NULL DEFAULT false;

-- Sorting reads it on every ticket list, so it is worth an index rather than a
-- sequential scan per queue render.
CREATE INDEX IF NOT EXISTS "SfContact_vip_idx" ON "SfContact" ("vip");
