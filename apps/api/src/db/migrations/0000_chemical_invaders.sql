CREATE TYPE "public"."calendar_provider" AS ENUM('google', 'icloud', 'outlook');--> statement-breakpoint
CREATE TYPE "public"."cycle_status" AS ENUM('collecting', 'optimizing', 'proposed', 'negotiating', 'locked', 'failed');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('in_app', 'telegram', 'push');--> statement-breakpoint
CREATE TYPE "public"."participant_response" AS ENUM('pending', 'accepted', 'declined', 'change_requested');--> statement-breakpoint
CREATE TYPE "public"."partnership_status" AS ENUM('invited', 'active', 'paused', 'archived');--> statement-breakpoint
CREATE TYPE "public"."scheduling_cadence" AS ENUM('weekly', 'biweekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."time_block_status" AS ENUM('proposed', 'accepted', 'locked', 'declined', 'reshuffled', 'cancelled');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"person_id" uuid,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"ip_address" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_connections" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"person_id" uuid NOT NULL,
	"provider" "calendar_provider" NOT NULL,
	"encrypted_access_token" "bytea" NOT NULL,
	"encrypted_refresh_token" "bytea",
	"token_expires_at" timestamp with time zone,
	"scopes" text[] NOT NULL,
	"calendar_id" text,
	"last_synced_at" timestamp with time zone,
	"sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_cal_connections_person_provider" UNIQUE("person_id","provider")
);
--> statement-breakpoint
CREATE TABLE "event_types" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"pod_id" uuid,
	"label" text NOT NULL,
	"emoji" text DEFAULT '📅',
	"default_duration_hours" numeric(4, 1) NOT NULL,
	"blocks_next_morning" boolean DEFAULT false NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "magic_links" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manual_availability" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"person_id" uuid NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"person_id" uuid NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"action_url" text,
	"read_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_invites" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"invited_by" uuid NOT NULL,
	"token" text NOT NULL,
	"display_hint" text,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "partnership_preferences" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"partnership_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"cadence" "scheduling_cadence" DEFAULT 'weekly' NOT NULL,
	"need_min_hours" numeric(5, 1) DEFAULT '0' NOT NULL,
	"need_min_date_nights" integer DEFAULT 0 NOT NULL,
	"need_min_overnights" integer DEFAULT 0 NOT NULL,
	"pref_ideal_hours" numeric(5, 1) DEFAULT '0' NOT NULL,
	"pref_date_nights" integer DEFAULT 0 NOT NULL,
	"pref_overnights" integer DEFAULT 0 NOT NULL,
	"pref_daytime_hangs" integer DEFAULT 0 NOT NULL,
	"custom_event_prefs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recurring_holds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preferred_windows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_partner_prefs" UNIQUE("partnership_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "partnerships" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"person_a_id" uuid NOT NULL,
	"person_b_id" uuid NOT NULL,
	"status" "partnership_status" DEFAULT 'invited' NOT NULL,
	"invited_by" uuid NOT NULL,
	"invite_token" text,
	"color_a" text DEFAULT '#E07A5F',
	"color_b" text DEFAULT '#81B29A',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partnerships_invite_token_unique" UNIQUE("invite_token"),
	CONSTRAINT "uq_partnerships_pair" UNIQUE("person_a_id","person_b_id"),
	CONSTRAINT "partnerships_canonical_order" CHECK ("partnerships"."person_a_id" < "partnerships"."person_b_id")
);
--> statement-breakpoint
CREATE TABLE "persons" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"display_name" text NOT NULL,
	"email" text NOT NULL,
	"timezone" text DEFAULT 'America/Denver' NOT NULL,
	"telegram_chat_id" bigint,
	"telegram_handle" text,
	"avatar_url" text,
	"solo_min_free_evenings_per_week" integer DEFAULT 0 NOT NULL,
	"solo_min_free_weekend_days_per_month" integer DEFAULT 0 NOT NULL,
	"blocked_windows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notification_channels" "notification_channel"[] DEFAULT ARRAY['in_app']::notification_channel[],
	"onboarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "persons_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "pod_members" (
	"pod_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"invite_token" text,
	"joined_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pod_members_pod_id_person_id_pk" PRIMARY KEY("pod_id","person_id"),
	CONSTRAINT "pod_members_invite_token_unique" UNIQUE("invite_token"),
	CONSTRAINT "pod_members_role" CHECK ("pod_members"."role" IN ('admin','member'))
);
--> statement-breakpoint
CREATE TABLE "pod_preferences" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"pod_id" uuid NOT NULL,
	"pref_full_gatherings_per_cycle" integer DEFAULT 0 NOT NULL,
	"pref_gathering_duration_hours" numeric(4, 1) DEFAULT '3.0' NOT NULL,
	"subgroup_configs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pod_preferences_pod_id_unique" UNIQUE("pod_id")
);
--> statement-breakpoint
CREATE TABLE "pods" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"emoji" text DEFAULT '🏠',
	"scheduling_cadence" "scheduling_cadence" DEFAULT 'weekly' NOT NULL,
	"planning_horizon_weeks" integer DEFAULT 1 NOT NULL,
	"review_window_hours" integer DEFAULT 48 NOT NULL,
	"cycle_day_of_week" integer DEFAULT 0 NOT NULL,
	"cycle_time_of_day" time DEFAULT '20:00' NOT NULL,
	"telegram_group_chat_id" bigint,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduling_cycles" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"status" "cycle_status" DEFAULT 'collecting' NOT NULL,
	"horizon_start" timestamp with time zone NOT NULL,
	"horizon_end" timestamp with time zone NOT NULL,
	"triggered_by" uuid,
	"trigger_type" text DEFAULT 'automatic' NOT NULL,
	"person_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"solver_run_ms" integer,
	"satisfaction_report" jsonb,
	"infeasibility_notes" jsonb,
	"review_window_start" timestamp with time zone,
	"review_window_end" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cycles_trigger_type" CHECK ("scheduling_cycles"."trigger_type" IN ('automatic','manual','reshuffle'))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"person_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_block_participants" (
	"time_block_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"response" "participant_response" DEFAULT 'pending' NOT NULL,
	"change_note" text,
	"responded_at" timestamp with time zone,
	CONSTRAINT "time_block_participants_time_block_id_person_id_pk" PRIMARY KEY("time_block_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "time_blocks" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"event_label" text,
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone NOT NULL,
	"status" time_block_status DEFAULT 'proposed' NOT NULL,
	"source_pod_id" uuid,
	"partnership_id" uuid,
	"satisfaction_contribution" jsonb,
	"calendar_event_ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_pod_id_pods_id_fk" FOREIGN KEY ("pod_id") REFERENCES "public"."pods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_availability" ADD CONSTRAINT "manual_availability_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_invites" ADD CONSTRAINT "partner_invites_invited_by_persons_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_invites" ADD CONSTRAINT "partner_invites_accepted_by_persons_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partnership_preferences" ADD CONSTRAINT "partnership_preferences_partnership_id_partnerships_id_fk" FOREIGN KEY ("partnership_id") REFERENCES "public"."partnerships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partnership_preferences" ADD CONSTRAINT "partnership_preferences_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partnerships" ADD CONSTRAINT "partnerships_person_a_id_persons_id_fk" FOREIGN KEY ("person_a_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partnerships" ADD CONSTRAINT "partnerships_person_b_id_persons_id_fk" FOREIGN KEY ("person_b_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partnerships" ADD CONSTRAINT "partnerships_invited_by_persons_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_members" ADD CONSTRAINT "pod_members_pod_id_pods_id_fk" FOREIGN KEY ("pod_id") REFERENCES "public"."pods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_members" ADD CONSTRAINT "pod_members_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pod_preferences" ADD CONSTRAINT "pod_preferences_pod_id_pods_id_fk" FOREIGN KEY ("pod_id") REFERENCES "public"."pods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pods" ADD CONSTRAINT "pods_created_by_persons_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduling_cycles" ADD CONSTRAINT "scheduling_cycles_triggered_by_persons_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_block_participants" ADD CONSTRAINT "time_block_participants_time_block_id_time_blocks_id_fk" FOREIGN KEY ("time_block_id") REFERENCES "public"."time_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_block_participants" ADD CONSTRAINT "time_block_participants_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_blocks" ADD CONSTRAINT "time_blocks_cycle_id_scheduling_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."scheduling_cycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_blocks" ADD CONSTRAINT "time_blocks_source_pod_id_pods_id_fk" FOREIGN KEY ("source_pod_id") REFERENCES "public"."pods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_blocks" ADD CONSTRAINT "time_blocks_partnership_id_partnerships_id_fk" FOREIGN KEY ("partnership_id") REFERENCES "public"."partnerships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_person" ON "audit_log" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "idx_audit_action" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "idx_cal_connections_person" ON "calendar_connections" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "idx_magic_links_email" ON "magic_links" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_magic_links_expires" ON "magic_links" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_manual_avail_person" ON "manual_availability" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "idx_manual_avail_time" ON "manual_availability" USING btree ("start_time","end_time");--> statement-breakpoint
CREATE INDEX "idx_notifications_person" ON "notifications" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "idx_partner_invites_token" ON "partner_invites" USING btree ("token");--> statement-breakpoint
CREATE INDEX "idx_partner_prefs_partnership" ON "partnership_preferences" USING btree ("partnership_id");--> statement-breakpoint
CREATE INDEX "idx_partner_prefs_person" ON "partnership_preferences" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "idx_partnerships_persons" ON "partnerships" USING btree ("person_a_id","person_b_id");--> statement-breakpoint
CREATE INDEX "idx_partnerships_status" ON "partnerships" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_persons_email" ON "persons" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_pod_members_person" ON "pod_members" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "idx_cycles_status" ON "scheduling_cycles" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_cycles_horizon" ON "scheduling_cycles" USING btree ("horizon_start","horizon_end");--> statement-breakpoint
CREATE INDEX "idx_sessions_person" ON "sessions" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "idx_sessions_expires" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_tb_participants_person" ON "time_block_participants" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "idx_time_blocks_cycle" ON "time_blocks" USING btree ("cycle_id");--> statement-breakpoint
CREATE INDEX "idx_time_blocks_status" ON "time_blocks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_time_blocks_time" ON "time_blocks" USING btree ("start_time","end_time");--> statement-breakpoint
CREATE INDEX "idx_time_blocks_partnership" ON "time_blocks" USING btree ("partnership_id");