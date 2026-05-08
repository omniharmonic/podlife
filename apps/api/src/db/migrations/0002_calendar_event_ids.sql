-- Track each participant's external calendar event so we can update / delete
-- it as the time-block lifecycle progresses (HOLD → confirmed → cancelled).
-- IF NOT EXISTS makes this safe to retry on environments where the columns
-- were applied out-of-band (e.g. via direct SQL before the migration was
-- registered).
ALTER TABLE "time_block_participants" ADD COLUMN IF NOT EXISTS "external_event_id" text;
ALTER TABLE "time_block_participants" ADD COLUMN IF NOT EXISTS "external_event_provider" text;
