-- Foundation: group roles, the app schema, default privileges and tenant row-level security helpers.
-- See docs/architecture.md §4 and REQ-DATA-001.
--
-- Group roles are NOLOGIN. Each environment creates its own login users and grants them exactly one
-- group: the API's runtime user gets app_runtime, the platform handle's user gets app_platform.
-- Migrations run as the migrator (schema owner), which is neither of these.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_platform') THEN
    CREATE ROLE app_platform NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS app;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app_runtime, app_platform;
--> statement-breakpoint
GRANT USAGE ON SCHEMA app TO app_runtime, app_platform;
--> statement-breakpoint
-- Tables and sequences created later by the migrator are usable by both application roles.
-- Append-only tables (audit log, payment ledgers) revoke UPDATE and DELETE in their own migrations.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime, app_platform;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_runtime, app_platform;
--> statement-breakpoint
-- The workspace of the current transaction, set with set_config('app.workspace_id', id, true),
-- i.e. SET LOCAL semantics, so it can never leak to the next user of a pooled connection.
-- NULL when unset, which makes every tenant policy fail closed.
CREATE OR REPLACE FUNCTION app.current_workspace_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.workspace_id', true), '')::uuid $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.current_workspace_id() TO app_runtime, app_platform;
--> statement-breakpoint
-- Enables the standard tenant policies on a table that has a workspace_id column:
-- - app_runtime sees and writes only rows of the current workspace;
-- - app_platform (the restricted platform handle) sees all rows.
-- Called from each migration that creates a tenant table.
CREATE OR REPLACE FUNCTION app.enable_tenant_rls(target regclass) RETURNS void
  LANGUAGE plpgsql
  AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s TO app_runtime '
    'USING (workspace_id = app.current_workspace_id()) '
    'WITH CHECK (workspace_id = app.current_workspace_id())',
    target);
  EXECUTE format(
    'CREATE POLICY platform_access ON %s TO app_platform USING (true) WITH CHECK (true)',
    target);
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.enable_tenant_rls(regclass) FROM PUBLIC;
