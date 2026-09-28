-- Permission grants for helpers and class teachers (REQ-RBAC-002, REQ-RBAC-006).
-- A grant applies to all of the member's classes until class-level scopes arrive with the
-- classes table (Phase 4), which adds permission_grant_classes(grant_id, class_id).
CREATE TABLE permission_grants (
  workspace_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  membership_id uuid NOT NULL,
  permission text NOT NULL CHECK (permission ~ '^[a-z_]+\.[a-z_]+$'),
  granted_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, membership_id, permission),
  FOREIGN KEY (workspace_id, membership_id) REFERENCES memberships (workspace_id, id)
);
--> statement-breakpoint
SELECT app.enable_tenant_rls('permission_grants');
