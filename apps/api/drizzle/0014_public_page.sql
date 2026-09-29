-- The workspace's public page at /t/{slug} (REQ-CONTENT-003). Only what the teacher writes here
-- is public; no student data and no personal contact details.
ALTER TABLE workspace_settings ADD COLUMN public_page_enabled boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE workspace_settings ADD COLUMN public_bio text
  CHECK (public_bio IS NULL OR length(public_bio) <= 1000);
--> statement-breakpoint
ALTER TABLE workspace_settings ADD COLUMN public_subjects text
  CHECK (public_subjects IS NULL OR length(public_subjects) <= 200);
--> statement-breakpoint
-- Anyone may read these fields for one slug. The runtime role can't read other workspaces'
-- rows directly (row-level security), so this narrow function is the only way in.
CREATE OR REPLACE FUNCTION app.public_teacher_page(p_slug text)
  RETURNS TABLE (slug text, name text, bio text, subjects text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT w.slug, w.name, s.public_bio, s.public_subjects
      FROM public.workspaces w JOIN public.workspace_settings s ON s.workspace_id = w.id
     WHERE w.slug = lower(p_slug)
       AND s.public_page_enabled
       AND w.suspended_at IS NULL
     LIMIT 1 $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.public_teacher_page(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.public_teacher_page(text) TO app_runtime, app_platform;
