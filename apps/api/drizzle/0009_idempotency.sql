-- Idempotency keys for retried requests on unreliable networks (REQ-DATA-003).
-- key_hash covers the user, method, path and client key, so keys never collide across users.
CREATE TABLE idempotency_keys (
  key_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id),
  request_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('in_progress', 'completed')),
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CHECK (status = 'in_progress' OR response_status IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX idempotency_keys_expiry_idx ON idempotency_keys (expires_at);
