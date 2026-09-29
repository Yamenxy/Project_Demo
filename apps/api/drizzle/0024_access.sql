-- Manual access to lessons (OD-02, REQ-CONTENT-005 to REQ-CONTENT-009): access groups (a set of
-- lessons plus a set of students), one individual rule (grant or block) per student and lesson,
-- and "pause all access" on the membership.
CREATE TABLE access_groups (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  archived_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (workspace_id, id)
);
--> statement-breakpoint
SELECT app.enable_tenant_rls('access_groups');
--> statement-breakpoint
CREATE TABLE access_group_lessons (
  workspace_id uuid NOT NULL,
  group_id uuid NOT NULL,
  lesson_id uuid NOT NULL,
  PRIMARY KEY (group_id, lesson_id),
  FOREIGN KEY (workspace_id, group_id) REFERENCES access_groups (workspace_id, id),
  FOREIGN KEY (workspace_id, lesson_id) REFERENCES lessons (workspace_id, id)
);
--> statement-breakpoint
SELECT app.enable_tenant_rls('access_group_lessons');
--> statement-breakpoint
CREATE TABLE access_group_members (
  workspace_id uuid NOT NULL,
  group_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  added_by uuid NOT NULL REFERENCES users (id),
  added_at timestamptz NOT NULL,
  PRIMARY KEY (group_id, membership_id),
  FOREIGN KEY (workspace_id, group_id) REFERENCES access_groups (workspace_id, id),
  FOREIGN KEY (workspace_id, membership_id) REFERENCES memberships (workspace_id, id)
);
--> statement-breakpoint
CREATE INDEX access_group_members_member_idx ON access_group_members (membership_id);
--> statement-breakpoint
SELECT app.enable_tenant_rls('access_group_members');
--> statement-breakpoint
-- At most one rule per (student, lesson): setting a grant replaces a block and vice versa.
CREATE TABLE lesson_rules (
  workspace_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  lesson_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('grant', 'block')),
  set_by uuid NOT NULL REFERENCES users (id),
  set_at timestamptz NOT NULL,
  PRIMARY KEY (membership_id, lesson_id),
  FOREIGN KEY (workspace_id, membership_id) REFERENCES memberships (workspace_id, id),
  FOREIGN KEY (workspace_id, lesson_id) REFERENCES lessons (workspace_id, id)
);
--> statement-breakpoint
SELECT app.enable_tenant_rls('lesson_rules');
