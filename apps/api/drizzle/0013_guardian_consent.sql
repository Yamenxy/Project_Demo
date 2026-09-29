-- Guardian consent for students under 18 (REQ-PRIV-001, OQ-09). Consent belongs to the student's
-- global account: one consent covers every workspace the student joins.

-- A contact field only: not unique, never used to sign in (REQ-AUTH-008).
ALTER TABLE users ADD COLUMN guardian_phone_e164 text
  CHECK (guardian_phone_e164 IS NULL OR guardian_phone_e164 ~ '^\+[1-9][0-9]{7,14}$');
--> statement-breakpoint
-- Time of the latest consent, kept on the user so the per-request access check needs no join.
ALTER TABLE users ADD COLUMN guardian_consent_at timestamptz;
--> statement-breakpoint
-- Append-only record of each consent: how, which text version, and when.
CREATE TABLE guardian_consents (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id),
  method text NOT NULL CHECK (method IN ('otp', 'paper')),
  version text NOT NULL CHECK (length(version) BETWEEN 1 AND 20),
  guardian_phone_e164 text
    CHECK (guardian_phone_e164 IS NULL OR guardian_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  -- Paper consent is recorded by staff of a workspace.
  workspace_id uuid REFERENCES workspaces (id),
  recorded_by uuid REFERENCES users (id),
  note text CHECK (note IS NULL OR length(note) <= 300),
  created_at timestamptz NOT NULL,
  CHECK (method <> 'otp' OR guardian_phone_e164 IS NOT NULL),
  CHECK (method <> 'paper' OR (workspace_id IS NOT NULL AND recorded_by IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX guardian_consents_user_idx ON guardian_consents (user_id, created_at DESC);
--> statement-breakpoint
REVOKE UPDATE, DELETE ON guardian_consents FROM app_runtime, app_platform;
--> statement-breakpoint
ALTER TABLE otp_challenges DROP CONSTRAINT otp_challenges_purpose_check;
--> statement-breakpoint
ALTER TABLE otp_challenges ADD CONSTRAINT otp_challenges_purpose_check
  CHECK (purpose IN ('verify_phone', 'password_reset', 'guardian_consent'));
