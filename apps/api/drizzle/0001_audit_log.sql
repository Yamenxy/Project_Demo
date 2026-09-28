-- Audit log: append-only, partitioned by month (REQ-AUDIT-001, REQ-AUDIT-002, REQ-DATA-004).
--
-- - Personal data goes only into personal_context, which the anonymization job may clear.
--   Everything else holds IDs, codes and non-personal values.
-- - workspace_id is NULL for platform-level events (logins, platform administration).
CREATE TABLE audit_log (
  id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  workspace_id uuid,
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'platform_owner', 'support', 'system')),
  actor_user_id uuid,
  action text NOT NULL CHECK (action ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$'),
  entity_type text,
  entity_id uuid,
  old_value jsonb,
  new_value jsonb,
  reason text,
  request_id text,
  personal_context jsonb,
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);
--> statement-breakpoint
CREATE INDEX audit_log_workspace_time_idx ON audit_log (workspace_id, occurred_at DESC);
--> statement-breakpoint
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id);
--> statement-breakpoint
CREATE INDEX audit_log_actor_idx ON audit_log (actor_user_id, occurred_at DESC);
--> statement-breakpoint
-- Catches rows outside the prepared monthly partitions, so an insert never fails for lack of one.
CREATE TABLE audit_log_default PARTITION OF audit_log DEFAULT;
--> statement-breakpoint
-- Append-only: no application role may UPDATE or DELETE. The platform role may only clear
-- personal_context (anonymization, REQ-AUDIT-001).
REVOKE ALL ON audit_log FROM app_runtime, app_platform;
--> statement-breakpoint
GRANT SELECT, INSERT ON audit_log TO app_runtime, app_platform;
--> statement-breakpoint
GRANT UPDATE (personal_context) ON audit_log TO app_platform;
--> statement-breakpoint
-- Partitions are reached only through the parent, where privileges and policies apply.
REVOKE ALL ON audit_log_default FROM app_runtime, app_platform;
--> statement-breakpoint
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- The runtime role reads only its current workspace's events. It may write events for that
-- workspace, or platform-level events (workspace_id NULL) such as login and password changes.
CREATE POLICY runtime_read ON audit_log FOR SELECT TO app_runtime
  USING (workspace_id = app.current_workspace_id());
--> statement-breakpoint
CREATE POLICY runtime_write ON audit_log FOR INSERT TO app_runtime
  WITH CHECK (workspace_id IS NULL OR workspace_id = app.current_workspace_id());
--> statement-breakpoint
CREATE POLICY platform_access ON audit_log TO app_platform USING (true) WITH CHECK (true);
--> statement-breakpoint
-- Creates the monthly partitions from the current month through `months_ahead` months ahead.
-- Idempotent. Runs as the owner (SECURITY DEFINER) so the platform role's monthly job can call it;
-- new partitions get no direct privileges.
CREATE OR REPLACE FUNCTION app.ensure_audit_partitions(months_ahead integer DEFAULT 3)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  month_start date;
  partition_name text;
BEGIN
  IF months_ahead < 0 OR months_ahead > 24 THEN
    RAISE EXCEPTION 'months_ahead must be between 0 and 24';
  END IF;
  FOR i IN 0..months_ahead LOOP
    month_start := (date_trunc('month', now() AT TIME ZONE 'UTC') + make_interval(months => i))::date;
    partition_name := format('audit_log_%s', to_char(month_start, 'YYYY_MM'));
    IF to_regclass(format('public.%I', partition_name)) IS NULL THEN
      EXECUTE format(
        'CREATE TABLE public.%I PARTITION OF public.audit_log FOR VALUES FROM (%L) TO (%L)',
        partition_name,
        month_start::timestamp AT TIME ZONE 'UTC',
        (month_start + interval '1 month')::timestamp AT TIME ZONE 'UTC');
      EXECUTE format('REVOKE ALL ON public.%I FROM app_runtime, app_platform', partition_name);
    END IF;
  END LOOP;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.ensure_audit_partitions(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.ensure_audit_partitions(integer) TO app_platform;
--> statement-breakpoint
SELECT app.ensure_audit_partitions(3);
