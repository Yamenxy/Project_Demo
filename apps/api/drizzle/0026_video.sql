-- Lesson video through the self-hls adapter (REQ-VIDEO-001, -003, -005): one video per lesson,
-- transcoded by a job into HLS renditions; watch time per student for the optional view limit.
CREATE TABLE lesson_videos (
  workspace_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  lesson_id uuid NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('processing', 'ready', 'failed')),
  duration_seconds integer CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  renditions text[] NOT NULL DEFAULT '{}',
  -- Accumulated watch time allowed per student; null means no limit (REQ-VIDEO-003).
  view_limit_seconds integer CHECK (view_limit_seconds IS NULL OR view_limit_seconds > 0),
  error text CHECK (error IS NULL OR length(error) <= 500),
  uploaded_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, lesson_id) REFERENCES lessons (workspace_id, id)
);
--> statement-breakpoint
SELECT app.enable_tenant_rls('lesson_videos');
--> statement-breakpoint
CREATE TABLE video_watch_time (
  workspace_id uuid NOT NULL,
  video_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  watched_seconds integer NOT NULL CHECK (watched_seconds >= 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (video_id, membership_id),
  FOREIGN KEY (workspace_id, video_id) REFERENCES lesson_videos (workspace_id, id),
  FOREIGN KEY (workspace_id, membership_id) REFERENCES memberships (workspace_id, id)
);
--> statement-breakpoint
SELECT app.enable_tenant_rls('video_watch_time');
