-- Web push subscriptions (REQ-NOTIF-001): one per browser that allowed notifications. A user's
-- own, across workspaces, so a global table like sessions; the API only ever reads and writes
-- the signed-in user's rows, and the push job reads the recipients'.
CREATE TABLE push_subscriptions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id),
  endpoint text NOT NULL UNIQUE CHECK (endpoint ~ '^https://' AND length(endpoint) <= 1000),
  p256dh text NOT NULL CHECK (length(p256dh) BETWEEN 20 AND 200),
  auth text NOT NULL CHECK (length(auth) BETWEEN 8 AND 100),
  created_at timestamptz NOT NULL,
  last_success_at timestamptz
);
--> statement-breakpoint
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id);
