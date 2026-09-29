-- Schedules (REQ-SCHED-001, REQ-SCHED-002, REQ-ATT-002). A weekly series stores local wall-clock
-- time and its IANA time zone; sessions are generated as UTC instants, so a Saturday 17:00 Cairo
-- series stays at 17:00 local time across daylight-saving changes.
CREATE TABLE class_series (
  workspace_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  class_id uuid NOT NULL,
  -- 0 = Sunday … 6 = Saturday, as extract(dow) returns.
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time time NOT NULL,
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 15 AND 480),
  time_zone text NOT NULL DEFAULT 'Africa/Cairo',
  starts_on date NOT NULL,
  ends_on date,
  created_at timestamptz NOT NULL,
  CHECK (ends_on IS NULL OR ends_on >= starts_on),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, class_id) REFERENCES classes (workspace_id, id)
);
--> statement-breakpoint
SELECT app.enable_tenant_rls('class_series');
--> statement-breakpoint
-- Holidays and other days without sessions, for the whole workspace.
CREATE TABLE workspace_skip_dates (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  skip_date date NOT NULL,
  reason text CHECK (reason IS NULL OR length(reason) <= 120),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, skip_date)
);
--> statement-breakpoint
SELECT app.enable_tenant_rls('workspace_skip_dates');
--> statement-breakpoint
CREATE TABLE class_sessions (
  workspace_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  class_id uuid NOT NULL,
  -- Null for a one-off session.
  series_id uuid,
  local_date date NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  cancelled_at timestamptz,
  cancel_reason text CHECK (cancel_reason IS NULL OR length(cancel_reason) <= 300),
  created_at timestamptz NOT NULL,
  CHECK (ends_at > starts_at),
  CHECK ((cancelled_at IS NULL) = (cancel_reason IS NULL)),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, class_id) REFERENCES classes (workspace_id, id),
  FOREIGN KEY (workspace_id, series_id) REFERENCES class_series (workspace_id, id)
);
--> statement-breakpoint
-- One generated session per series and day, so generation can run again safely.
CREATE UNIQUE INDEX class_sessions_series_day_uq ON class_sessions (series_id, local_date)
  WHERE series_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX class_sessions_time_idx ON class_sessions (workspace_id, starts_at);
--> statement-breakpoint
SELECT app.enable_tenant_rls('class_sessions');
