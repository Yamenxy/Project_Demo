-- TOTP two-factor authentication with recovery codes (REQ-AUTH-007).
-- The TOTP secret is encrypted by the application (AES-256-GCM); only ciphertext is stored.
ALTER TABLE users ADD COLUMN totp_secret_encrypted text;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN totp_enabled_at timestamptz;
--> statement-breakpoint
-- The last accepted 30-second step, so a code can't be replayed within its window.
ALTER TABLE users ADD COLUMN totp_last_step bigint;
--> statement-breakpoint
ALTER TABLE users ADD CONSTRAINT users_totp_enabled_needs_secret
  CHECK (totp_enabled_at IS NULL OR totp_secret_encrypted IS NOT NULL);
--> statement-breakpoint
-- A session of an account with 2FA starts "pending" until the second factor is checked.
ALTER TABLE sessions ADD COLUMN second_factor_at timestamptz;
--> statement-breakpoint
CREATE TABLE recovery_codes (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id),
  code_hash text NOT NULL,
  created_at timestamptz NOT NULL,
  used_at timestamptz
);
--> statement-breakpoint
CREATE INDEX recovery_codes_user_idx ON recovery_codes (user_id) WHERE used_at IS NULL;
