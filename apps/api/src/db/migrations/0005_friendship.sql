-- Friendship vs. partnership distinction.
--
-- Adds relationship_type to both partnerships and partner_invites. The
-- existing rows default to 'partnership' (the historical-only meaning), and
-- the inviter chooses the type at invite creation. Two-person friend
-- relationships use the same partnerships table so the optimizer's two-
-- person scheduling logic works unchanged — only the UI distinguishes:
-- friendships hide overnight/date-night fields and relabel the rest.

ALTER TABLE "partnerships"
  ADD COLUMN IF NOT EXISTS "relationship_type" text NOT NULL DEFAULT 'partnership';
--> statement-breakpoint

ALTER TABLE "partner_invites"
  ADD COLUMN IF NOT EXISTS "relationship_type" text NOT NULL DEFAULT 'partnership';
--> statement-breakpoint

-- Guard the new column against typos. Idempotent so re-running this
-- migration over a partial state doesn't fail.
DO $$ BEGIN
  ALTER TABLE "partnerships"
    ADD CONSTRAINT "partnerships_relationship_type_check"
    CHECK ("relationship_type" IN ('partnership', 'friendship'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "partner_invites"
    ADD CONSTRAINT "partner_invites_relationship_type_check"
    CHECK ("relationship_type" IN ('partnership', 'friendship'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
