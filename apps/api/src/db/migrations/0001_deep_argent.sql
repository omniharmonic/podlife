CREATE TABLE IF NOT EXISTS "pod_chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"pod_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pod_notes" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"pod_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- privacy_mode may already exist from post-migrate.sql; guard idempotently.
ALTER TABLE "persons" ADD COLUMN IF NOT EXISTS "privacy_mode" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- time_blocks FK changes: only adjust when still using the old (NO ACTION) rule.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.referential_constraints
    WHERE constraint_name = 'time_blocks_source_pod_id_pods_id_fk'
      AND delete_rule = 'NO ACTION'
  ) THEN
    ALTER TABLE "time_blocks" DROP CONSTRAINT "time_blocks_source_pod_id_pods_id_fk";
    ALTER TABLE "time_blocks" ADD CONSTRAINT "time_blocks_source_pod_id_pods_id_fk" FOREIGN KEY ("source_pod_id") REFERENCES "public"."pods"("id") ON DELETE set null ON UPDATE no action;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.referential_constraints
    WHERE constraint_name = 'time_blocks_partnership_id_partnerships_id_fk'
      AND delete_rule = 'NO ACTION'
  ) THEN
    ALTER TABLE "time_blocks" DROP CONSTRAINT "time_blocks_partnership_id_partnerships_id_fk";
    ALTER TABLE "time_blocks" ADD CONSTRAINT "time_blocks_partnership_id_partnerships_id_fk" FOREIGN KEY ("partnership_id") REFERENCES "public"."partnerships"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END$$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "pod_chat_messages" ADD CONSTRAINT "pod_chat_messages_pod_id_pods_id_fk" FOREIGN KEY ("pod_id") REFERENCES "public"."pods"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "pod_chat_messages" ADD CONSTRAINT "pod_chat_messages_author_id_persons_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."persons"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "pod_notes" ADD CONSTRAINT "pod_notes_pod_id_pods_id_fk" FOREIGN KEY ("pod_id") REFERENCES "public"."pods"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "pod_notes" ADD CONSTRAINT "pod_notes_author_id_persons_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."persons"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pod_chat_pod" ON "pod_chat_messages" USING btree ("pod_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pod_chat_created" ON "pod_chat_messages" USING btree ("pod_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pod_notes_pod" ON "pod_notes" USING btree ("pod_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pod_notes_created" ON "pod_notes" USING btree ("pod_id","created_at" DESC NULLS LAST);
