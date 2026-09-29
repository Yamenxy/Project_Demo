-- Classes and enrolments (REQ-CLASS-001, REQ-RBAC-006, REQ-GRADE-003).
-- Each class has one responsible teacher: the owner or a class teacher of the workspace.
CREATE TABLE classes (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  responsible_membership_id uuid NOT NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, responsible_membership_id) REFERENCES memberships (workspace_id, id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX classes_name_uq ON classes (workspace_id, lower(name)) WHERE archived_at IS NULL;
--> statement-breakpoint
SELECT app.enable_tenant_rls('classes');
--> statement-breakpoint
-- Enrolment history: ending an enrolment keeps the row, so a transferred student's past in the
-- old class stays visible (REQ-GRADE-003).
CREATE TABLE class_enrollments (
  workspace_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  class_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  enrolled_at timestamptz NOT NULL,
  enrolled_by uuid NOT NULL REFERENCES users (id),
  ended_at timestamptz,
  end_reason text CHECK (end_reason IN ('removed', 'transferred')),
  ended_by uuid REFERENCES users (id),
  CHECK ((ended_at IS NULL) = (end_reason IS NULL)),
  CHECK ((ended_at IS NULL) = (ended_by IS NULL)),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, class_id) REFERENCES classes (workspace_id, id),
  FOREIGN KEY (workspace_id, membership_id) REFERENCES memberships (workspace_id, id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX class_enrollments_active_uq ON class_enrollments (class_id, membership_id)
  WHERE ended_at IS NULL;
--> statement-breakpoint
CREATE INDEX class_enrollments_member_idx ON class_enrollments (workspace_id, membership_id);
--> statement-breakpoint
SELECT app.enable_tenant_rls('class_enrollments');
