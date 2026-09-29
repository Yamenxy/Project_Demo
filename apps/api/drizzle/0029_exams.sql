-- Online exams (REQ-EXAM-001, -002, -004, -006). A fixed set of question versions; each attempt's
-- deadline is computed once at start; answers are saved one row per question.
CREATE TABLE exams (
  workspace_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  course_id uuid NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 2 AND 160),
  time_limit_minutes integer NOT NULL CHECK (time_limit_minutes BETWEEN 1 AND 600),
  opens_at timestamptz NOT NULL,
  closes_at timestamptz NOT NULL,
  max_attempts integer NOT NULL DEFAULT 1 CHECK (max_attempts BETWEEN 1 AND 10),
  score_rule text NOT NULL DEFAULT 'highest' CHECK (score_rule IN ('highest', 'latest')),
  shuffle_questions boolean NOT NULL DEFAULT false,
  shuffle_choices boolean NOT NULL DEFAULT false,
  pass_percent integer CHECK (pass_percent IS NULL OR pass_percent BETWEEN 1 AND 100),
  published_at timestamptz,
  results_released_at timestamptz,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (closes_at > opens_at),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, course_id) REFERENCES courses (workspace_id, id)
);
--> statement-breakpoint
SELECT app.enable_tenant_rls('exams');
--> statement-breakpoint
-- The classes an exam is for: a student must be actively enrolled in one (REQ-EXAM-006).
CREATE TABLE exam_targets (
  workspace_id uuid NOT NULL,
  exam_id uuid NOT NULL,
  class_id uuid NOT NULL,
  PRIMARY KEY (exam_id, class_id),
  FOREIGN KEY (workspace_id, exam_id) REFERENCES exams (workspace_id, id),
  FOREIGN KEY (workspace_id, class_id) REFERENCES classes (workspace_id, id)
);
--> statement-breakpoint
SELECT app.enable_tenant_rls('exam_targets');
--> statement-breakpoint
CREATE TABLE exam_items (
  workspace_id uuid NOT NULL,
  exam_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  question_version_id uuid NOT NULL,
  PRIMARY KEY (exam_id, position),
  FOREIGN KEY (workspace_id, exam_id) REFERENCES exams (workspace_id, id),
  FOREIGN KEY (workspace_id, question_version_id) REFERENCES question_versions (workspace_id, id)
);
--> statement-breakpoint
SELECT app.enable_tenant_rls('exam_items');
--> statement-breakpoint
CREATE TABLE exam_accommodations (
  workspace_id uuid NOT NULL,
  exam_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  extra_minutes integer NOT NULL CHECK (extra_minutes BETWEEN 1 AND 600),
  PRIMARY KEY (exam_id, membership_id),
  FOREIGN KEY (workspace_id, exam_id) REFERENCES exams (workspace_id, id),
  FOREIGN KEY (workspace_id, membership_id) REFERENCES memberships (workspace_id, id)
);
--> statement-breakpoint
SELECT app.enable_tenant_rls('exam_accommodations');
--> statement-breakpoint
CREATE TABLE exam_attempts (
  workspace_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  exam_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  number integer NOT NULL CHECK (number >= 1),
  started_at timestamptz NOT NULL,
  deadline_at timestamptz NOT NULL,
  submitted_at timestamptz,
  submit_reason text CHECK (submit_reason IN ('student', 'timeout')),
  -- The order this attempt shows: [{position, choiceOrder: [choice ids]}].
  layout jsonb NOT NULL,
  score_centi integer,
  max_centi integer NOT NULL,
  CHECK ((submitted_at IS NULL) = (submit_reason IS NULL)),
  UNIQUE (workspace_id, id),
  UNIQUE (exam_id, membership_id, number),
  FOREIGN KEY (workspace_id, exam_id) REFERENCES exams (workspace_id, id),
  FOREIGN KEY (workspace_id, membership_id) REFERENCES memberships (workspace_id, id)
);
--> statement-breakpoint
-- At most one attempt in progress per student and exam.
CREATE UNIQUE INDEX exam_attempts_open_uq ON exam_attempts (exam_id, membership_id)
  WHERE submitted_at IS NULL;
--> statement-breakpoint
CREATE INDEX exam_attempts_due_idx ON exam_attempts (deadline_at) WHERE submitted_at IS NULL;
--> statement-breakpoint
SELECT app.enable_tenant_rls('exam_attempts');
--> statement-breakpoint
CREATE TABLE exam_answers (
  workspace_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  position integer NOT NULL,
  response jsonb NOT NULL,
  -- The client's counter: a retried or reordered save never overwrites a newer one.
  seq bigint NOT NULL CHECK (seq >= 0),
  correct boolean,
  saved_at timestamptz NOT NULL,
  PRIMARY KEY (attempt_id, position),
  FOREIGN KEY (workspace_id, attempt_id) REFERENCES exam_attempts (workspace_id, id)
);
--> statement-breakpoint
SELECT app.enable_tenant_rls('exam_answers');
--> statement-breakpoint
-- For the sweeper: attempts past their deadline and grace, in every workspace. Returns ids only.
CREATE OR REPLACE FUNCTION app.overdue_exam_attempts(p_now timestamptz, p_grace_seconds integer)
  RETURNS TABLE (workspace_id uuid, attempt_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT a.workspace_id, a.id FROM public.exam_attempts a
     WHERE a.submitted_at IS NULL
       AND a.deadline_at + make_interval(secs => p_grace_seconds) < p_now
     LIMIT 500 $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.overdue_exam_attempts(timestamptz, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.overdue_exam_attempts(timestamptz, integer) TO app_runtime, app_platform;
