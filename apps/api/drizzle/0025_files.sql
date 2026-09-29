-- Uploaded files (REQ-FILE-001, REQ-PAY-010). A file starts in quarantine; a job checks its size
-- and magic bytes before it becomes available. It belongs to a lesson (served only through
-- AccessPolicy) or to a payment request (proof, seen only by staff with payments.confirm).
CREATE TABLE files (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid PRIMARY KEY,
  owner_type text NOT NULL CHECK (owner_type IN ('lesson', 'payment_request')),
  owner_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  content_type text NOT NULL CHECK (length(content_type) <= 100),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 20971520),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('quarantine', 'available', 'rejected')),
  reject_reason text,
  uploaded_by uuid NOT NULL REFERENCES users (id),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL,
  UNIQUE (workspace_id, id)
);
--> statement-breakpoint
CREATE INDEX files_owner_idx ON files (workspace_id, owner_type, owner_id);
--> statement-breakpoint
CREATE INDEX files_sha_idx ON files (workspace_id, sha256);
--> statement-breakpoint
SELECT app.enable_tenant_rls('files');
