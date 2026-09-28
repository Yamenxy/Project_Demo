-- In-app notifications, partitioned by month (review §3.19, REQ-DATA-004, REQ-NOTIF-001).
-- `type` and `params` let the web app render the text in the reader's language; params hold IDs
-- and small values only, never personal data beyond what the recipient already sees.
CREATE TABLE notifications (
  id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  recipient_user_id uuid NOT NULL,
  -- NULL for account and platform notifications; otherwise the workspace it comes from.
  workspace_id uuid,
  type text NOT NULL CHECK (type ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$'),
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  link text CHECK (link IS NULL OR (link ~ '^/' AND length(link) <= 300)),
  read_at timestamptz,
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
--> statement-breakpoint
CREATE INDEX notifications_recipient_idx ON notifications (recipient_user_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX notifications_unread_idx ON notifications (recipient_user_id) WHERE read_at IS NULL;
--> statement-breakpoint
CREATE TABLE notifications_default PARTITION OF notifications DEFAULT;
--> statement-breakpoint
REVOKE ALL ON notifications FROM app_runtime, app_platform;
--> statement-breakpoint
GRANT SELECT, INSERT ON notifications TO app_runtime, app_platform;
--> statement-breakpoint
-- Recipients may only mark notifications read; nothing else is ever updated.
GRANT UPDATE (read_at) ON notifications TO app_runtime;
--> statement-breakpoint
GRANT DELETE ON notifications TO app_platform;
--> statement-breakpoint
REVOKE ALL ON notifications_default FROM app_runtime, app_platform;
--> statement-breakpoint
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Written inside the transaction of the change that caused it: in its workspace, or at account
-- level (workspace_id NULL).
CREATE POLICY runtime_write ON notifications FOR INSERT TO app_runtime
  WITH CHECK (workspace_id IS NULL OR workspace_id = app.current_workspace_id());
--> statement-breakpoint
-- Read and marked read only by the recipient, across workspaces (TenantDb.forUser).
CREATE POLICY recipient_read ON notifications FOR SELECT TO app_runtime
  USING (recipient_user_id = app.current_user_id());
--> statement-breakpoint
CREATE POLICY recipient_mark_read ON notifications FOR UPDATE TO app_runtime
  USING (recipient_user_id = app.current_user_id())
  WITH CHECK (recipient_user_id = app.current_user_id());
--> statement-breakpoint
CREATE POLICY platform_access ON notifications TO app_platform USING (true) WITH CHECK (true);
--> statement-breakpoint
-- Monthly partitions for any partitioned table in the allowed list (replaces the audit-only
-- function for new callers). SECURITY DEFINER so the platform role's maintenance job can run it.
CREATE OR REPLACE FUNCTION app.ensure_monthly_partitions(parent text, months_ahead integer DEFAULT 3)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  month_start date;
  partition_name text;
BEGIN
  IF parent NOT IN ('audit_log', 'notifications') THEN
    RAISE EXCEPTION 'unsupported partitioned table %', parent;
  END IF;
  IF months_ahead < 0 OR months_ahead > 24 THEN
    RAISE EXCEPTION 'months_ahead must be between 0 and 24';
  END IF;
  FOR i IN 0..months_ahead LOOP
    month_start := (date_trunc('month', now() AT TIME ZONE 'UTC') + make_interval(months => i))::date;
    partition_name := format('%s_%s', parent, to_char(month_start, 'YYYY_MM'));
    IF to_regclass(format('public.%I', partition_name)) IS NULL THEN
      EXECUTE format(
        'CREATE TABLE public.%I PARTITION OF public.%I FOR VALUES FROM (%L) TO (%L)',
        partition_name,
        parent,
        month_start::timestamp AT TIME ZONE 'UTC',
        (month_start + interval '1 month')::timestamp AT TIME ZONE 'UTC');
      EXECUTE format('REVOKE ALL ON public.%I FROM app_runtime, app_platform', partition_name);
    END IF;
  END LOOP;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.ensure_monthly_partitions(text, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.ensure_monthly_partitions(text, integer) TO app_platform;
--> statement-breakpoint
SELECT app.ensure_monthly_partitions('notifications', 3);
