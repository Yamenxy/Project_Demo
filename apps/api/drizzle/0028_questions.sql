-- Question bank (REQ-QBANK-001 to -003). A question belongs to a course; every edit creates a new
-- immutable version, and assessments point to a specific version.
CREATE TABLE questions (
  workspace_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  course_id uuid NOT NULL,
  current_version integer NOT NULL CHECK (current_version >= 1),
  archived_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, course_id) REFERENCES courses (workspace_id, id)
);
--> statement-breakpoint
CREATE INDEX questions_course_idx ON questions (course_id, created_at);
--> statement-breakpoint
SELECT app.enable_tenant_rls('questions');
--> statement-breakpoint
CREATE TABLE question_versions (
  workspace_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  question_id uuid NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  kind text NOT NULL CHECK (kind IN ('mcq', 'true_false', 'short')),
  -- Text with LaTeX between $…$, mixed with Arabic.
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  -- mcq: [{id, text}]; other kinds: [].
  choices jsonb NOT NULL DEFAULT '[]',
  -- mcq: {"correct": "<choice id>"}; true_false: {"value": true}; short: {"accepted": [...],
  -- "arabicVariants": true}. Never sent to students before results are released.
  answer jsonb NOT NULL,
  feedback text CHECK (feedback IS NULL OR length(feedback) <= 2000),
  points_centi integer NOT NULL CHECK (points_centi BETWEEN 1 AND 10000),
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL,
  UNIQUE (workspace_id, id),
  UNIQUE (question_id, version),
  FOREIGN KEY (workspace_id, question_id) REFERENCES questions (workspace_id, id)
);
--> statement-breakpoint
SELECT app.enable_tenant_rls('question_versions');
--> statement-breakpoint
REVOKE UPDATE, DELETE ON question_versions FROM app_runtime, app_platform;
