-- Announcements (announcements.post, REQ-NOTIF-001): to a whole workspace or one class. Each
-- recipient gets an in-app notification, written by a queue job in batches at a limited rate;
-- fanout_cursor records how far it got, so a retried batch doesn't notify anyone twice.
CREATE TABLE announcements (
  workspace_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  -- NULL: every student in the workspace.
  class_id uuid,
  title text NOT NULL CHECK (length(title) BETWEEN 2 AND 160),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  author_user_id uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL,
  recipients integer NOT NULL DEFAULT 0,
  fanout_cursor uuid,
  fanout_done_at timestamptz,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, class_id) REFERENCES classes (workspace_id, id)
);
--> statement-breakpoint
CREATE INDEX announcements_recent_idx ON announcements (workspace_id, created_at DESC);
--> statement-breakpoint
SELECT app.enable_tenant_rls('announcements');
--> statement-breakpoint
REVOKE DELETE ON announcements FROM app_runtime;
