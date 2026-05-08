-- Replace magic-link flow with one-time login codes. Existing rows in
-- `magic_links` continue to work for the (15-minute) TTL; the column simply
-- starts tracking failed-attempt counts for new code-based verifications.
ALTER TABLE "magic_links" ADD COLUMN IF NOT EXISTS "attempts" integer NOT NULL DEFAULT 0;
