-- Class scopes for permission grants (REQ-RBAC-001, REQ-RBAC-002). A grant without rows here
-- covers the whole workspace; with rows, only those classes.
CREATE TABLE permission_grant_classes (
  workspace_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  class_id uuid NOT NULL,
  PRIMARY KEY (grant_id, class_id),
  FOREIGN KEY (workspace_id, grant_id) REFERENCES permission_grants (workspace_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, class_id) REFERENCES classes (workspace_id, id)
);
--> statement-breakpoint
SELECT app.enable_tenant_rls('permission_grant_classes');
