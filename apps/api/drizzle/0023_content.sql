-- Courses and lessons (REQ-CONTENT-001, REQ-CONTENT-002). The lesson is the unit of access.
-- Deleting is soft and can be undone for 30 days.
CREATE TABLE courses (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid PRIMARY KEY,
  title text NOT NULL CHECK (length(title) BETWEEN 2 AND 120),
  description text CHECK (description IS NULL OR length(description) <= 2000),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (workspace_id, id)
);
--> statement-breakpoint
SELECT app.enable_tenant_rls('courses');
--> statement-breakpoint
CREATE TABLE lessons (
  workspace_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  course_id uuid NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 2 AND 160),
  body text CHECK (body IS NULL OR length(body) <= 20000),
  position integer NOT NULL CHECK (position >= 0),
  published_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, course_id) REFERENCES courses (workspace_id, id)
);
--> statement-breakpoint
CREATE INDEX lessons_course_idx ON lessons (course_id, position);
--> statement-breakpoint
SELECT app.enable_tenant_rls('lessons');
--> statement-breakpoint
-- A class can follow a course (REQ-CLASS-001): a student may then not be in two active classes of
-- the same course without an audited override.
ALTER TABLE classes ADD COLUMN course_id uuid;
--> statement-breakpoint
ALTER TABLE classes
  ADD FOREIGN KEY (workspace_id, course_id) REFERENCES courses (workspace_id, id);
