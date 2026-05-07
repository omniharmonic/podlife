-- Post-migration SQL: extensions, triggers, RLS policies.
-- Idempotent: safe to run multiple times.

-- Extensions ---------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Phase 9 column additions (idempotent) ------------------------------
-- privacy_mode: per-person opt-in to scheduling jitter (P9.3).
ALTER TABLE persons ADD COLUMN IF NOT EXISTS privacy_mode BOOLEAN NOT NULL DEFAULT FALSE;

-- Phase 9 FK adjustments for account-deletion cascade safety ---------
-- When a person deletes their account, partnerships cascade-delete; but
-- time_blocks references partnerships and would block the delete unless
-- we set NULL. The historical block stays for the other participants
-- (anonymized: no partnership reference, no participant rows for deleter).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.referential_constraints
    WHERE constraint_name = 'time_blocks_partnership_id_partnerships_id_fk'
      AND delete_rule = 'NO ACTION'
  ) THEN
    ALTER TABLE time_blocks
      DROP CONSTRAINT time_blocks_partnership_id_partnerships_id_fk;
    ALTER TABLE time_blocks
      ADD CONSTRAINT time_blocks_partnership_id_partnerships_id_fk
      FOREIGN KEY (partnership_id) REFERENCES partnerships(id) ON DELETE SET NULL;
  END IF;
END$$;

-- Same fix for time_blocks.source_pod_id: when a pod is deleted, its
-- historical time blocks should anonymize, not block deletion.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.referential_constraints
    WHERE constraint_name = 'time_blocks_source_pod_id_pods_id_fk'
      AND delete_rule = 'NO ACTION'
  ) THEN
    ALTER TABLE time_blocks
      DROP CONSTRAINT time_blocks_source_pod_id_pods_id_fk;
    ALTER TABLE time_blocks
      ADD CONSTRAINT time_blocks_source_pod_id_pods_id_fk
      FOREIGN KEY (source_pod_id) REFERENCES pods(id) ON DELETE SET NULL;
  END IF;
END$$;

-- updated_at trigger -------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name = 'updated_at'
    GROUP BY table_name
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_updated_at ON %I; '
      'CREATE TRIGGER trg_updated_at BEFORE UPDATE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION update_updated_at();',
      t, t
    );
  END LOOP;
END$$;

-- Row-Level Security -------------------------------------------------
-- Per arch § 4.3. Defense-in-depth alongside application access checks.
-- Policies depend on `app.current_person_id` set via SET LOCAL in
-- the auth middleware before each query.

ALTER TABLE partnerships ENABLE ROW LEVEL SECURITY;
ALTER TABLE partnership_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE pod_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_blocks ENABLE ROW LEVEL SECURITY;

-- Drop policies if they exist to make this idempotent.
DROP POLICY IF EXISTS partnership_access ON partnerships;
DROP POLICY IF EXISTS partnership_pref_access ON partnership_preferences;
DROP POLICY IF EXISTS pod_member_access ON pod_members;
DROP POLICY IF EXISTS time_block_access ON time_blocks;

CREATE POLICY partnership_access ON partnerships FOR ALL USING (
  current_setting('app.current_person_id', true) = ''
  OR person_a_id = NULLIF(current_setting('app.current_person_id', true), '')::UUID
  OR person_b_id = NULLIF(current_setting('app.current_person_id', true), '')::UUID
);

CREATE POLICY partnership_pref_access ON partnership_preferences FOR ALL USING (
  current_setting('app.current_person_id', true) = ''
  OR partnership_id IN (
    SELECT id FROM partnerships
    WHERE person_a_id = NULLIF(current_setting('app.current_person_id', true), '')::UUID
       OR person_b_id = NULLIF(current_setting('app.current_person_id', true), '')::UUID
  )
);

CREATE POLICY pod_member_access ON pod_members FOR SELECT USING (
  current_setting('app.current_person_id', true) = ''
  OR pod_id IN (
    SELECT pod_id FROM pod_members pm
    WHERE pm.person_id = NULLIF(current_setting('app.current_person_id', true), '')::UUID
      AND pm.joined_at IS NOT NULL
  )
);

CREATE POLICY time_block_access ON time_blocks FOR SELECT USING (
  current_setting('app.current_person_id', true) = ''
  OR id IN (
    SELECT time_block_id FROM time_block_participants
    WHERE person_id = NULLIF(current_setting('app.current_person_id', true), '')::UUID
  )
);

-- The default Postgres role used by the app owns these tables, so by
-- default ROW LEVEL SECURITY does NOT apply to the table owner. We need to
-- force RLS for the owning role to make the policies effective.
ALTER TABLE partnerships FORCE ROW LEVEL SECURITY;
ALTER TABLE partnership_preferences FORCE ROW LEVEL SECURITY;
ALTER TABLE pod_members FORCE ROW LEVEL SECURITY;
ALTER TABLE time_blocks FORCE ROW LEVEL SECURITY;
