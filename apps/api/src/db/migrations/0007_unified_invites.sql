-- Unified invite table for partner *and* pod invites.
--
-- Replaces `partner_invites` and moves pod invites off Redis (where they had
-- lived as ephemeral tokens, with no way to audit, list, or pre-fill a display
-- hint for the inviter). The token is the bearer credential — anyone with the
-- link can accept, including users who don't yet have an account: the standard
-- login-code flow handles signup-on-accept by carrying the invite token
-- through verify and applying it when the new Person is created.
--
-- Also drops dead `invite_token` columns on `partnerships` and `pod_members`
-- that were never wired up.

CREATE TABLE IF NOT EXISTS "invites" (
  "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  "token" text NOT NULL UNIQUE,
  "kind" text NOT NULL,
  "invited_by" uuid NOT NULL REFERENCES "persons"("id") ON DELETE CASCADE,
  "pod_id" uuid REFERENCES "pods"("id") ON DELETE CASCADE,
  "relationship_type" text,
  "invitee_display_hint" text,
  "expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  "accepted_at" timestamptz,
  "accepted_by" uuid REFERENCES "persons"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "invites_kind_check" CHECK ("kind" IN ('partner', 'pod')),
  CONSTRAINT "invites_pod_kind_consistency" CHECK (
    ("kind" = 'pod' AND "pod_id" IS NOT NULL AND "relationship_type" IS NULL)
    OR
    ("kind" = 'partner' AND "pod_id" IS NULL AND "relationship_type" IN ('partnership', 'friendship'))
  )
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_invites_token" ON "invites" ("token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_invites_pod" ON "invites" ("pod_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_invites_invited_by" ON "invites" ("invited_by");
--> statement-breakpoint

-- Port any existing partner_invites rows over so dev/staging databases keep
-- their in-flight invites working. `display_hint` maps to `invitee_display_hint`.
INSERT INTO "invites" (
  "id", "token", "kind", "invited_by", "relationship_type",
  "invitee_display_hint", "expires_at", "accepted_at", "accepted_by", "created_at"
)
SELECT
  "id", "token", 'partner', "invited_by", "relationship_type",
  "display_hint", "expires_at", "accepted_at", "accepted_by", "created_at"
FROM "partner_invites"
ON CONFLICT ("token") DO NOTHING;
--> statement-breakpoint

DROP TABLE IF EXISTS "partner_invites";
--> statement-breakpoint

-- Drop dead columns. Neither was ever read in application code; both
-- predate the unified invite design.
ALTER TABLE "partnerships" DROP COLUMN IF EXISTS "invite_token";
--> statement-breakpoint
ALTER TABLE "pod_members" DROP COLUMN IF EXISTS "invite_token";
