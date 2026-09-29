-- Attendance (REQ-ATT-001, REQ-ATT-002). One record per session and student, so scans from several
-- devices, and the same scan uploaded twice, end up as one row.
CREATE TABLE attendance_records (
  workspace_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('present', 'late', 'absent', 'excused')),
  method text NOT NULL CHECK (method IN ('manual', 'qr')),
  -- When it was taken on the device (offline scans upload later).
  taken_at timestamptz NOT NULL,
  recorded_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (workspace_id, id),
  UNIQUE (session_id, membership_id),
  FOREIGN KEY (workspace_id, session_id) REFERENCES class_sessions (workspace_id, id),
  FOREIGN KEY (workspace_id, membership_id) REFERENCES memberships (workspace_id, id)
);
--> statement-breakpoint
CREATE INDEX attendance_records_member_idx ON attendance_records (workspace_id, membership_id);
--> statement-breakpoint
SELECT app.enable_tenant_rls('attendance_records');
