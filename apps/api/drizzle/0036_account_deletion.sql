-- Account deletion (REQ-PRIV-003): a request starts 14 days in which the person can change their
-- mind; then a nightly job anonymizes the account (D30). NULL: no request pending.
ALTER TABLE users ADD COLUMN deletion_requested_at timestamptz;
--> statement-breakpoint
CREATE INDEX users_deletion_requested_idx ON users (deletion_requested_at)
  WHERE deletion_requested_at IS NOT NULL;
