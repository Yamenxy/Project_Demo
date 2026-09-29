-- Homework (REQ-HW-001, REQ-HW-002). Submissions with text and files; late policy is reject or
-- accept with a flag; at most one resubmission.
CREATE TABLE homework (
  workspace_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  course_id uuid NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 2 AND 160),
  instructions text CHECK (instructions IS NULL OR length(instructions) <= 10000),
  due_at timestamptz NOT NULL,
  late_policy text NOT NULL DEFAULT 'accept_flagged' CHECK (late_policy IN ('reject', 'accept_flagged')),
  allow_resubmission boolean NOT NULL DEFAULT false,
  max_score_centi integer NOT NULL CHECK (max_score_centi BETWEEN 1 AND 100000),
  published_at timestamptz,
  results_released_at timestamptz,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, course_id) REFERENCES courses (workspace_id, id)
);
--> statement-breakpoint
SELECT app.enable_tenant_rls('homework');
--> statement-breakpoint
CREATE TABLE homework_targets (
  workspace_id uuid NOT NULL,
  homework_id uuid NOT NULL,
  class_id uuid NOT NULL,
  PRIMARY KEY (homework_id, class_id),
  FOREIGN KEY (workspace_id, homework_id) REFERENCES homework (workspace_id, id),
  FOREIGN KEY (workspace_id, class_id) REFERENCES classes (workspace_id, id)
);
--> statement-breakpoint
SELECT app.enable_tenant_rls('homework_targets');
--> statement-breakpoint
CREATE TABLE homework_submissions (
  workspace_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  homework_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  -- 1, or 2 for the single allowed resubmission.
  number integer NOT NULL CHECK (number IN (1, 2)),
  text text CHECK (text IS NULL OR length(text) <= 10000),
  submitted_at timestamptz NOT NULL,
  late boolean NOT NULL,
  score_centi integer CHECK (score_centi IS NULL OR score_centi >= 0),
  feedback text CHECK (feedback IS NULL OR length(feedback) <= 2000),
  graded_by uuid REFERENCES users (id),
  graded_at timestamptz,
  UNIQUE (workspace_id, id),
  UNIQUE (homework_id, membership_id, number),
  FOREIGN KEY (workspace_id, homework_id) REFERENCES homework (workspace_id, id),
  FOREIGN KEY (workspace_id, membership_id) REFERENCES memberships (workspace_id, id)
);
--> statement-breakpoint
SELECT app.enable_tenant_rls('homework_submissions');
--> statement-breakpoint
ALTER TABLE files DROP CONSTRAINT files_owner_type_check;
--> statement-breakpoint
ALTER TABLE files ADD CONSTRAINT files_owner_type_check
  CHECK (owner_type IN ('lesson', 'payment_request', 'homework_submission'));
