-- Homework comments (REQ-MSG-001): the only channel between staff and students. Comments can't be
-- edited or deleted by the app, so the owner's review sees everything that was said. A reported
-- comment goes to the platform owners' queue, who may hide it.
CREATE TABLE homework_comments (
  workspace_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  submission_id uuid NOT NULL,
  author_user_id uuid NOT NULL REFERENCES users (id),
  -- Whether the author wrote as the student or as staff.
  author_side text NOT NULL CHECK (author_side IN ('student', 'staff')),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL,
  -- Set only by the platform owners when they uphold a report.
  hidden_at timestamptz,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, submission_id) REFERENCES homework_submissions (workspace_id, id)
);
--> statement-breakpoint
CREATE INDEX homework_comments_submission_idx ON homework_comments (submission_id, created_at);
--> statement-breakpoint
CREATE INDEX homework_comments_recent_idx ON homework_comments (workspace_id, created_at DESC);
--> statement-breakpoint
SELECT app.enable_tenant_rls('homework_comments');
--> statement-breakpoint
REVOKE UPDATE, DELETE ON homework_comments FROM app_runtime;
--> statement-breakpoint
CREATE TABLE comment_reports (
  workspace_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  comment_id uuid NOT NULL,
  reported_by uuid NOT NULL REFERENCES users (id),
  reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 500),
  created_at timestamptz NOT NULL,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES users (id),
  resolution text CHECK (resolution IN ('dismissed', 'hidden')),
  UNIQUE (comment_id, reported_by),
  FOREIGN KEY (workspace_id, comment_id) REFERENCES homework_comments (workspace_id, id),
  CHECK ((resolved_at IS NULL) = (resolution IS NULL))
);
--> statement-breakpoint
CREATE INDEX comment_reports_open_idx ON comment_reports (created_at) WHERE resolved_at IS NULL;
--> statement-breakpoint
SELECT app.enable_tenant_rls('comment_reports');
--> statement-breakpoint
REVOKE UPDATE, DELETE ON comment_reports FROM app_runtime;
