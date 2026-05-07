/**
 * Drizzle schema mirroring arch § 4.2.
 * All timestamps are TIMESTAMPTZ (UTC). All IDs are UUIDs.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ─── Custom types ────────────────────────────────────────────────────

const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return 'bytea';
  },
  toDriver(value: Buffer) {
    return value;
  },
});

const inet = customType<{ data: string; default: false }>({
  dataType() {
    return 'inet';
  },
});

// ─── Enums ───────────────────────────────────────────────────────────

export const partnershipStatusEnum = pgEnum('partnership_status', [
  'invited',
  'active',
  'paused',
  'archived',
]);

export const schedulingCadenceEnum = pgEnum('scheduling_cadence', [
  'weekly',
  'biweekly',
  'monthly',
]);

export const calendarProviderEnum = pgEnum('calendar_provider', ['google', 'icloud', 'outlook']);

export const timeBlockStatusEnum = pgEnum('time_block_status', [
  'proposed',
  'accepted',
  'locked',
  'declined',
  'reshuffled',
  'cancelled',
]);

export const participantResponseEnum = pgEnum('participant_response', [
  'pending',
  'accepted',
  'declined',
  'change_requested',
]);

export const cycleStatusEnum = pgEnum('cycle_status', [
  'collecting',
  'optimizing',
  'proposed',
  'negotiating',
  'locked',
  'failed',
]);

export const notificationChannelEnum = pgEnum('notification_channel', [
  'in_app',
  'telegram',
  'push',
]);

// ─── Tables ──────────────────────────────────────────────────────────

export const persons = pgTable(
  'persons',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
    displayName: text('display_name').notNull(),
    email: text('email').notNull().unique(),
    timezone: text('timezone').notNull().default('America/Denver'),
    telegramChatId: bigint('telegram_chat_id', { mode: 'bigint' }),
    telegramHandle: text('telegram_handle'),
    avatarUrl: text('avatar_url'),
    soloMinFreeEveningsPerWeek: integer('solo_min_free_evenings_per_week').notNull().default(0),
    soloMinFreeWeekendDaysPerMonth: integer('solo_min_free_weekend_days_per_month')
      .notNull()
      .default(0),
    blockedWindows: jsonb('blocked_windows').notNull().default(sql`'[]'::jsonb`),
    notificationChannels: notificationChannelEnum('notification_channels')
      .array()
      .default(sql`ARRAY['in_app']::notification_channel[]`),
    // P9.3: opt-in privacy mode adds jitter to scheduling free-windows
    // to reduce timing-pattern inference across pods.
    privacyMode: boolean('privacy_mode').notNull().default(false),
    onboardedAt: timestamp('onboarded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_persons_email').on(t.email)],
);

export const magicLinks = pgTable(
  'magic_links',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
    email: text('email').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_magic_links_email').on(t.email),
    index('idx_magic_links_expires').on(t.expiresAt),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_sessions_person').on(t.personId),
    index('idx_sessions_expires').on(t.expiresAt),
  ],
);

export const calendarConnections = pgTable(
  'calendar_connections',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
    provider: calendarProviderEnum('provider').notNull(),
    encryptedAccessToken: bytea('encrypted_access_token').notNull(),
    encryptedRefreshToken: bytea('encrypted_refresh_token'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    scopes: text('scopes').array().notNull(),
    calendarId: text('calendar_id'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    syncError: text('sync_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('uq_cal_connections_person_provider').on(t.personId, t.provider),
    index('idx_cal_connections_person').on(t.personId),
  ],
);

export const partnerships = pgTable(
  'partnerships',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
    personAId: uuid('person_a_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
    personBId: uuid('person_b_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
    status: partnershipStatusEnum('status').notNull().default('invited'),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => persons.id),
    inviteToken: text('invite_token').unique(),
    colorA: text('color_a').default('#E07A5F'),
    colorB: text('color_b').default('#81B29A'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('partnerships_canonical_order', sql`${t.personAId} < ${t.personBId}`),
    unique('uq_partnerships_pair').on(t.personAId, t.personBId),
    index('idx_partnerships_persons').on(t.personAId, t.personBId),
    index('idx_partnerships_status').on(t.status),
  ],
);

export const partnerInvites = pgTable(
  'partner_invites',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    displayHint: text('display_hint'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedBy: uuid('accepted_by').references(() => persons.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_partner_invites_token').on(t.token)],
);

export const partnershipPreferences = pgTable(
  'partnership_preferences',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
    partnershipId: uuid('partnership_id')
      .notNull()
      .references(() => partnerships.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
    cadence: schedulingCadenceEnum('cadence').notNull().default('weekly'),
    needMinHours: numeric('need_min_hours', { precision: 5, scale: 1 }).notNull().default('0'),
    needMinDateNights: integer('need_min_date_nights').notNull().default(0),
    needMinOvernights: integer('need_min_overnights').notNull().default(0),
    prefIdealHours: numeric('pref_ideal_hours', { precision: 5, scale: 1 }).notNull().default('0'),
    prefDateNights: integer('pref_date_nights').notNull().default(0),
    prefOvernights: integer('pref_overnights').notNull().default(0),
    prefDaytimeHangs: integer('pref_daytime_hangs').notNull().default(0),
    customEventPrefs: jsonb('custom_event_prefs').notNull().default(sql`'[]'::jsonb`),
    recurringHolds: jsonb('recurring_holds').notNull().default(sql`'[]'::jsonb`),
    preferredWindows: jsonb('preferred_windows').notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('uq_partner_prefs').on(t.partnershipId, t.personId),
    index('idx_partner_prefs_partnership').on(t.partnershipId),
    index('idx_partner_prefs_person').on(t.personId),
  ],
);

export const pods = pgTable('pods', {
  id: uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
  name: text('name').notNull(),
  description: text('description'),
  emoji: text('emoji').default('🏠'),
  schedulingCadence: schedulingCadenceEnum('scheduling_cadence').notNull().default('weekly'),
  planningHorizonWeeks: integer('planning_horizon_weeks').notNull().default(1),
  reviewWindowHours: integer('review_window_hours').notNull().default(48),
  cycleDayOfWeek: integer('cycle_day_of_week').notNull().default(0),
  cycleTimeOfDay: time('cycle_time_of_day').notNull().default('20:00'),
  telegramGroupChatId: bigint('telegram_group_chat_id', { mode: 'bigint' }),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => persons.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const podMembers = pgTable(
  'pod_members',
  {
    podId: uuid('pod_id')
      .notNull()
      .references(() => pods.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    inviteToken: text('invite_token').unique(),
    joinedAt: timestamp('joined_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.podId, t.personId] }),
    check('pod_members_role', sql`${t.role} IN ('admin','member')`),
    index('idx_pod_members_person').on(t.personId),
  ],
);

export const podPreferences = pgTable('pod_preferences', {
  id: uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
  podId: uuid('pod_id')
    .notNull()
    .unique()
    .references(() => pods.id, { onDelete: 'cascade' }),
  prefFullGatheringsPerCycle: integer('pref_full_gatherings_per_cycle').notNull().default(0),
  prefGatheringDurationHours: numeric('pref_gathering_duration_hours', { precision: 4, scale: 1 })
    .notNull()
    .default('3.0'),
  subgroupConfigs: jsonb('subgroup_configs').notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const schedulingCycles = pgTable(
  'scheduling_cycles',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
    status: cycleStatusEnum('status').notNull().default('collecting'),
    horizonStart: timestamp('horizon_start', { withTimezone: true }).notNull(),
    horizonEnd: timestamp('horizon_end', { withTimezone: true }).notNull(),
    triggeredBy: uuid('triggered_by').references(() => persons.id),
    triggerType: text('trigger_type').notNull().default('automatic'),
    personIds: uuid('person_ids').array().notNull().default(sql`ARRAY[]::uuid[]`),
    solverRunMs: integer('solver_run_ms'),
    satisfactionReport: jsonb('satisfaction_report'),
    infeasibilityNotes: jsonb('infeasibility_notes'),
    reviewWindowStart: timestamp('review_window_start', { withTimezone: true }),
    reviewWindowEnd: timestamp('review_window_end', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'cycles_trigger_type',
      sql`${t.triggerType} IN ('automatic','manual','reshuffle')`,
    ),
    index('idx_cycles_status').on(t.status),
    index('idx_cycles_horizon').on(t.horizonStart, t.horizonEnd),
  ],
);

export const timeBlocks = pgTable(
  'time_blocks',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
    cycleId: uuid('cycle_id')
      .notNull()
      .references(() => schedulingCycles.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    eventLabel: text('event_label'),
    startTime: timestamp('start_time', { withTimezone: true }).notNull(),
    endTime: timestamp('end_time', { withTimezone: true }).notNull(),
    status: timeBlockStatusEnum('status').notNull().default('proposed'),
    // FKs use SET NULL so account/pod deletion anonymizes historical blocks
    // rather than deleting the row (other participants keep their history).
    sourcePodId: uuid('source_pod_id').references(() => pods.id, { onDelete: 'set null' }),
    partnershipId: uuid('partnership_id').references(() => partnerships.id, {
      onDelete: 'set null',
    }),
    satisfactionContribution: jsonb('satisfaction_contribution'),
    calendarEventIds: jsonb('calendar_event_ids').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_time_blocks_cycle').on(t.cycleId),
    index('idx_time_blocks_status').on(t.status),
    index('idx_time_blocks_time').on(t.startTime, t.endTime),
    index('idx_time_blocks_partnership').on(t.partnershipId),
  ],
);

export const timeBlockParticipants = pgTable(
  'time_block_participants',
  {
    timeBlockId: uuid('time_block_id')
      .notNull()
      .references(() => timeBlocks.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
    response: participantResponseEnum('response').notNull().default('pending'),
    changeNote: text('change_note'),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    /**
     * External calendar event identifier — set when the participant accepts
     * and we successfully push a HOLD event to their connected calendar. Null
     * for participants without a connected calendar, or before they accept.
     */
    externalEventId: text('external_event_id'),
    externalEventProvider: text('external_event_provider'), // 'google' | 'microsoft' | …
  },
  (t) => [
    primaryKey({ columns: [t.timeBlockId, t.personId] }),
    index('idx_tb_participants_person').on(t.personId),
  ],
);

export const eventTypes = pgTable('event_types', {
  id: uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
  podId: uuid('pod_id').references(() => pods.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  emoji: text('emoji').default('📅'),
  defaultDurationHours: numeric('default_duration_hours', { precision: 4, scale: 1 }).notNull(),
  blocksNextMorning: boolean('blocks_next_morning').notNull().default(false),
  isSystem: boolean('is_system').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
    channel: notificationChannelEnum('channel').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    actionUrl: text('action_url'),
    readAt: timestamp('read_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_notifications_person').on(t.personId)],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
    personId: uuid('person_id').references(() => persons.id),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: uuid('resource_id'),
    metadata: jsonb('metadata').default(sql`'{}'::jsonb`),
    ipAddress: inet('ip_address'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_audit_person').on(t.personId),
    index('idx_audit_action').on(t.action),
  ],
);

// Pod chat — short, fast messages between pod members.
// author_id uses ON DELETE SET NULL so a deleted user's history doesn't break
// the pod's chat log; the API surface displays "Deleted user" for null authors.
export const podChatMessages = pgTable(
  'pod_chat_messages',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
    podId: uuid('pod_id')
      .notNull()
      .references(() => pods.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => persons.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_pod_chat_pod').on(t.podId),
    index('idx_pod_chat_created').on(t.podId, t.createdAt.desc()),
  ],
);

// Pod shared notes — longer-form, editable, deliberate.
export const podNotes = pgTable(
  'pod_notes',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
    podId: uuid('pod_id')
      .notNull()
      .references(() => pods.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => persons.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_pod_notes_pod').on(t.podId),
    index('idx_pod_notes_created').on(t.podId, t.createdAt.desc()),
  ],
);

// Manual availability fallback when no calendar provider is connected.
// Per implementation note in Phase D.
export const manualAvailability = pgTable(
  'manual_availability',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
    startTime: timestamp('start_time', { withTimezone: true }).notNull(),
    endTime: timestamp('end_time', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_manual_avail_person').on(t.personId),
    index('idx_manual_avail_time').on(t.startTime, t.endTime),
  ],
);

// ─── Relations ───────────────────────────────────────────────────────

export const personsRelations = relations(persons, ({ many }) => ({
  calendarConnections: many(calendarConnections),
  partnershipsAsA: many(partnerships, { relationName: 'partnerships_a' }),
  partnershipsAsB: many(partnerships, { relationName: 'partnerships_b' }),
  podMemberships: many(podMembers),
  partnershipPreferences: many(partnershipPreferences),
  manualAvailability: many(manualAvailability),
}));

export const partnershipsRelations = relations(partnerships, ({ one, many }) => ({
  personA: one(persons, {
    fields: [partnerships.personAId],
    references: [persons.id],
    relationName: 'partnerships_a',
  }),
  personB: one(persons, {
    fields: [partnerships.personBId],
    references: [persons.id],
    relationName: 'partnerships_b',
  }),
  preferences: many(partnershipPreferences),
}));

export const partnershipPreferencesRelations = relations(partnershipPreferences, ({ one }) => ({
  partnership: one(partnerships, {
    fields: [partnershipPreferences.partnershipId],
    references: [partnerships.id],
  }),
  person: one(persons, {
    fields: [partnershipPreferences.personId],
    references: [persons.id],
  }),
}));

export const podsRelations = relations(pods, ({ one, many }) => ({
  members: many(podMembers),
  preferences: one(podPreferences, {
    fields: [pods.id],
    references: [podPreferences.podId],
  }),
}));

export const podMembersRelations = relations(podMembers, ({ one }) => ({
  pod: one(pods, { fields: [podMembers.podId], references: [pods.id] }),
  person: one(persons, { fields: [podMembers.personId], references: [persons.id] }),
}));

export const schedulingCyclesRelations = relations(schedulingCycles, ({ many }) => ({
  timeBlocks: many(timeBlocks),
}));

export const timeBlocksRelations = relations(timeBlocks, ({ one, many }) => ({
  cycle: one(schedulingCycles, {
    fields: [timeBlocks.cycleId],
    references: [schedulingCycles.id],
  }),
  partnership: one(partnerships, {
    fields: [timeBlocks.partnershipId],
    references: [partnerships.id],
  }),
  pod: one(pods, { fields: [timeBlocks.sourcePodId], references: [pods.id] }),
  participants: many(timeBlockParticipants),
}));

export const timeBlockParticipantsRelations = relations(timeBlockParticipants, ({ one }) => ({
  timeBlock: one(timeBlocks, {
    fields: [timeBlockParticipants.timeBlockId],
    references: [timeBlocks.id],
  }),
  person: one(persons, {
    fields: [timeBlockParticipants.personId],
    references: [persons.id],
  }),
}));

// ─── Type exports ────────────────────────────────────────────────────

export type PersonRow = typeof persons.$inferSelect;
export type NewPerson = typeof persons.$inferInsert;
export type PartnershipRow = typeof partnerships.$inferSelect;
export type PartnershipPreferenceRow = typeof partnershipPreferences.$inferSelect;
export type PodRow = typeof pods.$inferSelect;
export type PodMemberRow = typeof podMembers.$inferSelect;
export type CycleRow = typeof schedulingCycles.$inferSelect;
export type TimeBlockRow = typeof timeBlocks.$inferSelect;
export type CalendarConnectionRow = typeof calendarConnections.$inferSelect;
export type PodChatMessageRow = typeof podChatMessages.$inferSelect;
export type PodNoteRow = typeof podNotes.$inferSelect;
export type NotificationRow = typeof notifications.$inferSelect;
