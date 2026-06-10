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

-- Application role ---------------------------------------------------
-- RLS is bypassed unconditionally by superusers and by roles with the
-- BYPASSRLS attribute, regardless of FORCE ROW LEVEL SECURITY. The default
-- Postgres superuser (e.g. docker's POSTGRES_USER) therefore CANNOT be the
-- role the API connects as, or the policies below are inert.
--
-- We create a dedicated non-superuser, non-BYPASSRLS login role for the app.
-- Migrations/admin keep running as the owner/superuser; the API (both its
-- base and service pools) connects as this role. The default password here
-- is for local/dev only — production must override it (see SELF_HOSTING.md).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'podlife_app') THEN
    CREATE ROLE podlife_app LOGIN PASSWORD 'podlife_app' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END$$;

GRANT USAGE ON SCHEMA public TO podlife_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO podlife_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO podlife_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO podlife_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO podlife_app;

-- Row-Level Security -------------------------------------------------
-- Per arch § 4.3. Defense-in-depth alongside application access checks:
-- this is the database backstop that contains any application-level scope
-- bug. Policies are a READ backstop (FOR SELECT) — write authorization is
-- enforced in the application layer.
--
-- Two GUCs drive the policies, both set only by trusted server code:
--   app.current_person_id  — the authenticated requester (set LOCAL inside a
--                            per-request transaction by runWithPersonContext).
--   app.bypass_rls         — 'on' for the service connection pool (jobs,
--                            webhooks, cross-person aggregations). NEVER
--                            derived from request input.
--
-- Deny-by-default: when neither GUC is set, NULLIF(...) yields NULL, every
-- comparison is NULL (not true), and the row is hidden. There is no open
-- `= ''` branch — an unset context sees nothing.

-- Membership predicate for the pod_members policy. A policy on pod_members
-- that sub-selects pod_members recurses infinitely once RLS is active. We
-- break the recursion with a SECURITY DEFINER function: it runs as its owner
-- (the migration superuser), which bypasses RLS inside the function body, so
-- the membership lookup doesn't re-enter the policy. Marked STABLE; granted to
-- the app role.
CREATE OR REPLACE FUNCTION app_is_pod_member(target_pod UUID, who UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM pod_members
    WHERE pod_id = target_pod
      AND person_id = who
      AND joined_at IS NOT NULL
  );
$$;
GRANT EXECUTE ON FUNCTION app_is_pod_member(UUID, UUID) TO podlife_app;

ALTER TABLE partnerships ENABLE ROW LEVEL SECURITY;
ALTER TABLE partnership_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE pod_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_blocks ENABLE ROW LEVEL SECURITY;

-- Drop policies if they exist to make this idempotent.
DROP POLICY IF EXISTS partnership_access ON partnerships;
DROP POLICY IF EXISTS partnership_pref_access ON partnership_preferences;
DROP POLICY IF EXISTS pod_member_access ON pod_members;
DROP POLICY IF EXISTS time_block_access ON time_blocks;

-- Policies are FOR ALL: the USING clause scopes reads (and the rows an
-- UPDATE/DELETE may target), the WITH CHECK clause validates rows being
-- written. Both carry the bypass escape for trusted server code. An
-- RLS-enabled table with no matching policy denies the command outright, so
-- FOR ALL is required for the app's own writes to succeed under person
-- context (e.g. accepting an invite creates a partnership you're part of).

CREATE POLICY partnership_access ON partnerships FOR ALL
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR person_a_id = NULLIF(current_setting('app.current_person_id', true), '')::UUID
  OR person_b_id = NULLIF(current_setting('app.current_person_id', true), '')::UUID
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR person_a_id = NULLIF(current_setting('app.current_person_id', true), '')::UUID
  OR person_b_id = NULLIF(current_setting('app.current_person_id', true), '')::UUID
);

CREATE POLICY partnership_pref_access ON partnership_preferences FOR ALL
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR partnership_id IN (
    SELECT id FROM partnerships
    WHERE person_a_id = NULLIF(current_setting('app.current_person_id', true), '')::UUID
       OR person_b_id = NULLIF(current_setting('app.current_person_id', true), '')::UUID
  )
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR partnership_id IN (
    SELECT id FROM partnerships
    WHERE person_a_id = NULLIF(current_setting('app.current_person_id', true), '')::UUID
       OR person_b_id = NULLIF(current_setting('app.current_person_id', true), '')::UUID
  )
);

-- pod_members: you may read members of pods you belong to. You may insert
-- your OWN membership (joining a pod / creating one), which is why WITH CHECK
-- permits person_id = me even before the joined row exists.
CREATE POLICY pod_member_access ON pod_members FOR ALL
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR app_is_pod_member(pod_id, NULLIF(current_setting('app.current_person_id', true), '')::UUID)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR person_id = NULLIF(current_setting('app.current_person_id', true), '')::UUID
  OR app_is_pod_member(pod_id, NULLIF(current_setting('app.current_person_id', true), '')::UUID)
);

-- time_blocks: you may read/modify blocks you participate in. New blocks are
-- created by the cycle job under service context (bypass), so person-context
-- inserts are not expected; the WITH CHECK still scopes any that occur.
CREATE POLICY time_block_access ON time_blocks FOR ALL
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR id IN (
    SELECT time_block_id FROM time_block_participants
    WHERE person_id = NULLIF(current_setting('app.current_person_id', true), '')::UUID
  )
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
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
