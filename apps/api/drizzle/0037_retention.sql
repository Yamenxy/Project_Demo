-- Retention for the monthly-partitioned logs (REQ-PRIV-002, REQ-DATA-004): drops every monthly
-- partition that ends on or before the cutoff, and deletes older rows that landed in the default
-- partition. The application roles can't delete from these tables, so this runs as the owner
-- (SECURITY DEFINER) and only for the two known tables. Returns partitions dropped plus rows
-- deleted.
CREATE OR REPLACE FUNCTION app.purge_expired_log_rows(parent text, cutoff timestamptz)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  time_column text;
  part record;
  month_start date;
  removed integer := 0;
  deleted integer;
BEGIN
  IF parent = 'audit_log' THEN
    time_column := 'occurred_at';
  ELSIF parent = 'notifications' THEN
    time_column := 'created_at';
  ELSE
    RAISE EXCEPTION 'unsupported partitioned table %', parent;
  END IF;
  -- Never less than a month back: a wrong cutoff can't empty the current logs.
  IF cutoff > now() - interval '1 month' THEN
    RAISE EXCEPTION 'cutoff too recent';
  END IF;
  FOR part IN
    SELECT c.relname AS name
      FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhrelid
      JOIN pg_class p ON p.oid = i.inhparent
     WHERE p.relname = parent AND p.relnamespace = 'public'::regnamespace
       AND c.relname ~ ('^' || parent || '_[0-9]{4}_[0-9]{2}$')
  LOOP
    month_start := to_date(right(part.name, 7), 'YYYY_MM');
    IF (month_start + interval '1 month')::timestamp AT TIME ZONE 'UTC' <= cutoff THEN
      EXECUTE format('DROP TABLE public.%I', part.name);
      removed := removed + 1;
    END IF;
  END LOOP;
  EXECUTE format('DELETE FROM public.%I WHERE %I < $1', parent || '_default', time_column)
    USING cutoff;
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN removed + deleted;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.purge_expired_log_rows(text, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.purge_expired_log_rows(text, timestamptz) TO app_platform;
