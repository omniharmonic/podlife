-- Per-partnership cadence with two-party confirmation.
--
-- Each partnership now owns a single agreed `cadence` (weekly / biweekly /
-- monthly) — distinct from `partnership_preferences.cadence`, which is a
-- per-person opinion. Changes require explicit confirmation from the other
-- party via `pending_cadence` + `pending_cadence_by`. Only the *other*
-- party can accept a proposal; the proposer can only withdraw or update it.

ALTER TABLE "partnerships"
  ADD COLUMN IF NOT EXISTS "cadence" text NOT NULL DEFAULT 'weekly';
--> statement-breakpoint

ALTER TABLE "partnerships"
  ADD COLUMN IF NOT EXISTS "pending_cadence" text;
--> statement-breakpoint

ALTER TABLE "partnerships"
  ADD COLUMN IF NOT EXISTS "pending_cadence_by" uuid REFERENCES "persons"("id") ON DELETE SET NULL;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "partnerships"
    ADD CONSTRAINT "partnerships_cadence_check"
    CHECK ("cadence" IN ('weekly', 'biweekly', 'monthly'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "partnerships"
    ADD CONSTRAINT "partnerships_pending_cadence_check"
    CHECK ("pending_cadence" IS NULL OR "pending_cadence" IN ('weekly', 'biweekly', 'monthly'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Both pending fields go together: a NULL proposer means no pending proposal.
DO $$ BEGIN
  ALTER TABLE "partnerships"
    ADD CONSTRAINT "partnerships_pending_cadence_together"
    CHECK (
      ("pending_cadence" IS NULL AND "pending_cadence_by" IS NULL)
      OR ("pending_cadence" IS NOT NULL AND "pending_cadence_by" IS NOT NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
