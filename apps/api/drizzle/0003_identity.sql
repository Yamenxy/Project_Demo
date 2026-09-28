-- Identity: global user accounts, sessions and rate-limit counters (REQ-AUTH-001, -004, -008).
-- These tables are global (no workspace_id); workspace access is decided by memberships.

CREATE TABLE users (
  id uuid PRIMARY KEY,
  -- Short platform code for QR attendance and watermarks (REQ-VIDEO-002).
  platform_code text NOT NULL UNIQUE CHECK (platform_code ~ '^[A-Z2-9]{8}$'),
  name_ar text NOT NULL CHECK (length(name_ar) BETWEEN 2 AND 120),
  name_latin text CHECK (name_latin IS NULL OR length(name_latin) BETWEEN 2 AND 120),
  -- E.164. Unique only once verified, so an unverified claim never blocks the real owner
  -- (REQ-AUTH-001).
  phone_e164 text NOT NULL CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  phone_verified_at timestamptz,
  email text CHECK (email IS NULL OR email = lower(email)),
  email_verified_at timestamptz,
  date_of_birth date,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'suspended', 'archived', 'anonymized')),
  password_hash text NOT NULL,
  password_changed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX users_verified_phone_uq ON users (phone_e164) WHERE phone_verified_at IS NOT NULL;
--> statement-breakpoint
CREATE INDEX users_phone_idx ON users (phone_e164);
--> statement-breakpoint
CREATE UNIQUE INDEX users_verified_email_uq ON users (email) WHERE email_verified_at IS NOT NULL;
--> statement-breakpoint
CREATE INDEX users_email_idx ON users (email) WHERE email IS NOT NULL;
--> statement-breakpoint
-- Opaque server-side sessions (REQ-AUTH-004). Only the SHA-256 of the token is stored.
CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id),
  token_hash text NOT NULL UNIQUE,
  device_label text CHECK (device_label IS NULL OR length(device_label) <= 120),
  created_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  -- Sliding idle expiry, capped by absolute_expires_at.
  idle_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoke_reason text CHECK (
    revoke_reason IS NULL OR revoke_reason IN
      ('logout', 'logout_all', 'password_changed', 'password_reset', 'device_limit', 'admin', 'membership_removed')
  )
);
--> statement-breakpoint
CREATE INDEX sessions_user_active_idx ON sessions (user_id) WHERE revoked_at IS NULL;
--> statement-breakpoint
-- Fixed-window counters for rate limiting and lockouts. Keys are hashed, never raw phone numbers.
CREATE TABLE rate_limit_counters (
  key text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL,
  PRIMARY KEY (key, window_start)
);
--> statement-breakpoint
CREATE INDEX rate_limit_counters_window_idx ON rate_limit_counters (window_start);
