-- Tenancy: platform owners, workspaces, memberships and invitations (OD-01, REQ-RBAC-001,
-- REQ-USER-001, REQ-USER-003, REQ-USER-005, REQ-CONTENT-008).

-- The user of the current transaction, set with set_config('app.user_id', id, true). Lets a user
-- read their own memberships across workspaces (the "my workspaces" list) and nothing else.
CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.current_user_id() TO app_runtime, app_platform;
--> statement-breakpoint
CREATE TABLE platform_owners (
  user_id uuid PRIMARY KEY REFERENCES users (id),
  created_at timestamptz NOT NULL
);
--> statement-breakpoint
-- Only the platform role manages platform owners; the runtime role can check membership.
REVOKE INSERT, UPDATE, DELETE ON platform_owners FROM app_runtime;
--> statement-breakpoint
CREATE TABLE workspaces (
  id uuid PRIMARY KEY,
  -- Public page path /t/{slug} (REQ-CONTENT-003).
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'),
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  owner_user_id uuid NOT NULL REFERENCES users (id),
  -- Separate from the subscription: payment clears only 'billing' (REQ-USER-001).
  suspended_at timestamptz,
  suspension_reason text CHECK (suspension_reason IN ('billing', 'admin')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK ((suspended_at IS NULL) = (suspension_reason IS NULL))
);
--> statement-breakpoint
-- Workspaces are created, renamed and suspended by the platform role only.
REVOKE INSERT, UPDATE, DELETE ON workspaces FROM app_runtime;
--> statement-breakpoint
CREATE TABLE memberships (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid PRIMARY KEY,
  -- NULL for a managed student record that nobody has claimed yet (REQ-USER-003).
  user_id uuid REFERENCES users (id),
  role text NOT NULL CHECK (role IN ('owner', 'class_teacher', 'assistant', 'student')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('pending', 'active', 'suspended', 'removed')),
  internal_code text CHECK (internal_code IS NULL OR length(internal_code) BETWEEN 1 AND 40),
  notes text CHECK (notes IS NULL OR length(notes) <= 2000),
  provisional_name text CHECK (provisional_name IS NULL OR length(provisional_name) BETWEEN 2 AND 120),
  provisional_phone text CHECK (provisional_phone IS NULL OR provisional_phone ~ '^\+[1-9][0-9]{7,14}$'),
  -- "Pause all access" (REQ-CONTENT-008): a flag, not a membership state.
  paused_at timestamptz,
  paused_by uuid REFERENCES users (id),
  pause_reason text CHECK (pause_reason IS NULL OR length(pause_reason) <= 200),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1,
  UNIQUE (workspace_id, id),
  -- A managed record is always a student with a provisional name and the student's own phone.
  CHECK (user_id IS NOT NULL OR (role = 'student' AND provisional_name IS NOT NULL AND provisional_phone IS NOT NULL)),
  -- Only students can be paused.
  CHECK (paused_at IS NULL OR role = 'student'),
  CHECK ((paused_at IS NULL) = (paused_by IS NULL))
);
--> statement-breakpoint
-- One role per user per workspace: never staff and student in the same workspace (REQ-RBAC-001).
CREATE UNIQUE INDEX memberships_workspace_user_uq ON memberships (workspace_id, user_id)
  WHERE user_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX memberships_one_owner_uq ON memberships (workspace_id) WHERE role = 'owner';
--> statement-breakpoint
CREATE UNIQUE INDEX memberships_internal_code_uq ON memberships (workspace_id, internal_code)
  WHERE internal_code IS NOT NULL;
--> statement-breakpoint
CREATE INDEX memberships_user_idx ON memberships (user_id) WHERE user_id IS NOT NULL;
--> statement-breakpoint
SELECT app.enable_tenant_rls('memberships');
--> statement-breakpoint
-- A user may read their own memberships in any workspace (for the workspace switcher).
CREATE POLICY own_memberships ON memberships FOR SELECT TO app_runtime
  USING (user_id = app.current_user_id());
--> statement-breakpoint
CREATE TABLE workspace_invitations (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid PRIMARY KEY,
  phone_e164 text NOT NULL CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  role text NOT NULL CHECK (role IN ('class_teacher', 'assistant', 'student')),
  token_hash text NOT NULL UNIQUE,
  invited_by uuid NOT NULL REFERENCES users (id),
  -- For a managed record being claimed (REQ-USER-003), or an imported student (REQ-USER-002).
  membership_id uuid,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by uuid REFERENCES users (id),
  revoked_at timestamptz,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, membership_id) REFERENCES memberships (workspace_id, id),
  CHECK (expires_at > created_at),
  CHECK (accepted_at IS NULL OR revoked_at IS NULL)
);
--> statement-breakpoint
CREATE INDEX workspace_invitations_phone_idx ON workspace_invitations (workspace_id, phone_e164)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
--> statement-breakpoint
SELECT app.enable_tenant_rls('workspace_invitations');
