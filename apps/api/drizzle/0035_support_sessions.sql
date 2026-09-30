-- Support sessions (REQ-RBAC-003): a platform owner's read-only access to one workspace, with a
-- reason and a ticket, for at most 60 minutes. Only the platform role opens and ends them; the
-- runtime role reads them (in the workspace's scope) to let the guard admit the support user.
CREATE TABLE support_sessions (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid PRIMARY KEY,
  platform_user_id uuid NOT NULL REFERENCES users (id),
  reason text NOT NULL CHECK (length(reason) BETWEEN 5 AND 300),
  ticket text NOT NULL CHECK (length(ticket) BETWEEN 1 AND 60),
  started_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  ended_at timestamptz,
  UNIQUE (workspace_id, id),
  CHECK (expires_at > started_at AND expires_at <= started_at + interval '60 minutes'),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);
--> statement-breakpoint
CREATE INDEX support_sessions_open_idx ON support_sessions (workspace_id, platform_user_id)
  WHERE ended_at IS NULL;
--> statement-breakpoint
SELECT app.enable_tenant_rls('support_sessions');
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON support_sessions FROM app_runtime;
