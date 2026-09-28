-- Device registrations for student device limits (REQ-AUTH-005, D13, CON-01).
-- A device is a browser holding a long-lived device cookie; only the cookie's hash is stored.
CREATE TABLE device_registrations (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id),
  token_hash text NOT NULL UNIQUE,
  label text CHECK (label IS NULL OR length(label) <= 120),
  created_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by_type text CHECK (revoked_by_type IN ('user', 'staff', 'support', 'system')),
  CHECK ((revoked_at IS NULL) = (revoked_by_type IS NULL))
);
--> statement-breakpoint
CREATE INDEX device_registrations_user_idx ON device_registrations (user_id, created_at DESC);
--> statement-breakpoint
ALTER TABLE sessions ADD COLUMN device_id uuid REFERENCES device_registrations (id);
--> statement-breakpoint
CREATE INDEX sessions_device_idx ON sessions (device_id) WHERE revoked_at IS NULL;
--> statement-breakpoint
-- A staff or support reset starts a fresh 30-day registration window (REQ-AUTH-005).
ALTER TABLE users ADD COLUMN devices_reset_at timestamptz;
--> statement-breakpoint
ALTER TABLE sessions DROP CONSTRAINT sessions_revoke_reason_check;
--> statement-breakpoint
ALTER TABLE sessions ADD CONSTRAINT sessions_revoke_reason_check CHECK (
  revoke_reason IS NULL OR revoke_reason IN
    ('logout', 'logout_all', 'password_changed', 'password_reset', 'device_limit',
     'device_revoked', 'admin', 'membership_removed')
);
