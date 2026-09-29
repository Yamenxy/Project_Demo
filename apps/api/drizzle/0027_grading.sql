-- Gradebook (REQ-GRADE-001 to -003). Scores are integer hundredths of a point (12.5 = 1250), so
-- sums and averages don't drift. Items belong to a class: after a transfer, a student's old
-- entries stay with the old class.
CREATE TABLE grade_items (
  workspace_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  class_id uuid NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 2 AND 120),
  max_score_centi integer NOT NULL CHECK (max_score_centi BETWEEN 1 AND 100000),
  kind text NOT NULL CHECK (kind IN ('paper', 'exam', 'homework')),
  -- The exam or homework the scores come from (Phase 6 tasks 6.3 and 6.5).
  source_id uuid,
  released_at timestamptz,
  archived_at timestamptz,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, class_id) REFERENCES classes (workspace_id, id)
);
--> statement-breakpoint
CREATE INDEX grade_items_class_idx ON grade_items (class_id, created_at);
--> statement-breakpoint
SELECT app.enable_tenant_rls('grade_items');
--> statement-breakpoint
CREATE TABLE grade_entries (
  workspace_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  item_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  -- Null: recorded as absent or not graded.
  score_centi integer CHECK (score_centi IS NULL OR score_centi >= 0),
  updated_by uuid NOT NULL REFERENCES users (id),
  updated_at timestamptz NOT NULL,
  UNIQUE (workspace_id, id),
  UNIQUE (item_id, membership_id),
  FOREIGN KEY (workspace_id, item_id) REFERENCES grade_items (workspace_id, id),
  FOREIGN KEY (workspace_id, membership_id) REFERENCES memberships (workspace_id, id)
);
--> statement-breakpoint
CREATE INDEX grade_entries_member_idx ON grade_entries (workspace_id, membership_id);
--> statement-breakpoint
SELECT app.enable_tenant_rls('grade_entries');
--> statement-breakpoint
-- Every change: old value, new value, who, when, and the reason (required after release).
CREATE TABLE grade_changes (
  workspace_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  entry_id uuid NOT NULL,
  old_score_centi integer,
  new_score_centi integer,
  changed_by uuid NOT NULL REFERENCES users (id),
  reason text CHECK (reason IS NULL OR length(reason) <= 300),
  changed_at timestamptz NOT NULL,
  FOREIGN KEY (workspace_id, entry_id) REFERENCES grade_entries (workspace_id, id)
);
--> statement-breakpoint
CREATE INDEX grade_changes_entry_idx ON grade_changes (entry_id, changed_at);
--> statement-breakpoint
SELECT app.enable_tenant_rls('grade_changes');
--> statement-breakpoint
REVOKE UPDATE, DELETE ON grade_changes FROM app_runtime, app_platform;
