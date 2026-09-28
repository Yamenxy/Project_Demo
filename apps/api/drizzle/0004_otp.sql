-- One-time codes for phone verification and password reset (REQ-AUTH-001, REQ-AUTH-003).
-- Only a hash of the code is stored. A new challenge for the same user and purpose supersedes
-- older ones (the service consumes them).
CREATE TABLE otp_challenges (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id),
  phone_e164 text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('verify_phone', 'password_reset')),
  code_hash text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  consumed_at timestamptz
);
--> statement-breakpoint
CREATE INDEX otp_challenges_live_idx ON otp_challenges (user_id, purpose, created_at DESC)
  WHERE consumed_at IS NULL;
