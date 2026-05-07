-- Track each participant's external calendar event so we can update / delete
-- it as the time-block lifecycle progresses (HOLD → confirmed → cancelled).
ALTER TABLE "time_block_participants" ADD COLUMN "external_event_id" text;
ALTER TABLE "time_block_participants" ADD COLUMN "external_event_provider" text;
