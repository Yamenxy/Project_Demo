-- Students joining a teacher (D8): a join code per workspace, and whether requests need approval.
CREATE TABLE workspace_settings (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces (id),
  -- Shared by the teacher in class or on social media; the owner can rotate it (SEC-13).
  join_code text NOT NULL UNIQUE CHECK (join_code ~ '^[A-Z2-9]{6}$'),
  auto_approve_joins boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL
);
--> statement-breakpoint
SELECT app.enable_tenant_rls('workspace_settings');
--> statement-breakpoint
-- Existing workspaces get a code too (the application generates codes for new ones).
CREATE OR REPLACE FUNCTION app.random_join_code() RETURNS text
  LANGUAGE sql VOLATILE
  AS $$
    SELECT string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
      FROM generate_series(1, 6)
  $$;
--> statement-breakpoint
INSERT INTO workspace_settings (workspace_id, join_code, updated_at)
SELECT w.id, app.random_join_code(), now() FROM workspaces w
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Resolves a join code or a public slug to the workspace to join, without giving the caller any
-- other access. The runtime role can't read other workspaces' settings directly.
CREATE OR REPLACE FUNCTION app.workspace_join_target(p_code text, p_slug text)
  RETURNS TABLE (workspace_id uuid, name text, auto_approve boolean, suspended boolean)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    -- Parameter names differ from every column name: an unqualified name that matches a column
    -- would silently mean the column.
    SELECT w.id, w.name, s.auto_approve_joins, w.suspended_at IS NOT NULL
      FROM public.workspaces w
      JOIN public.workspace_settings s ON s.workspace_id = w.id
     WHERE (p_code IS NOT NULL AND s.join_code = upper(p_code))
        OR (p_slug IS NOT NULL AND w.slug = lower(p_slug))
     LIMIT 1
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.workspace_join_target(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.workspace_join_target(text, text) TO app_runtime, app_platform;
