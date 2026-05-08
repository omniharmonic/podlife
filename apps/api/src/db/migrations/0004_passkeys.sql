-- Passkeys (WebAuthn). Lets users sign in with Face ID / Touch ID after
-- enrolling once via the email-code flow. `webauthn_challenges` stores
-- short-lived challenges so the server can match an assertion to the exact
-- value it issued, no matter which tab/window completes the flow.

CREATE TABLE IF NOT EXISTS "webauthn_credentials" (
  "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  "person_id" uuid NOT NULL REFERENCES "persons"("id") ON DELETE CASCADE,
  "credential_id" text NOT NULL UNIQUE,
  "public_key" text NOT NULL,
  "counter" integer NOT NULL DEFAULT 0,
  "transports" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "device_type" text NOT NULL DEFAULT 'singleDevice',
  "backed_up" boolean NOT NULL DEFAULT false,
  "nickname" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "last_used_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "idx_webauthn_person" ON "webauthn_credentials" ("person_id");
CREATE INDEX IF NOT EXISTS "idx_webauthn_credential_id" ON "webauthn_credentials" ("credential_id");

CREATE TABLE IF NOT EXISTS "webauthn_challenges" (
  "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  "person_id" uuid REFERENCES "persons"("id") ON DELETE CASCADE,
  "email" text,
  "challenge" text NOT NULL,
  "purpose" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_webauthn_chal_person" ON "webauthn_challenges" ("person_id");
CREATE INDEX IF NOT EXISTS "idx_webauthn_chal_email" ON "webauthn_challenges" ("email");
CREATE INDEX IF NOT EXISTS "idx_webauthn_chal_expires" ON "webauthn_challenges" ("expires_at");
