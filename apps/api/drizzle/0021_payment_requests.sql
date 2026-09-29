-- Payment requests from students (REQ-PAY-003, REQ-PAY-008, REQ-PAY-010). Approval writes one
-- ledger entry (payment_entries.request_id is unique). Proof images arrive with file storage.
CREATE TABLE payment_requests (
  workspace_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  membership_id uuid NOT NULL,
  submitted_by uuid NOT NULL REFERENCES users (id),
  amount_piastres bigint NOT NULL CHECK (amount_piastres BETWEEN 1 AND 100000000),
  currency text NOT NULL DEFAULT 'EGP' CHECK (currency ~ '^[A-Z]{3}$'),
  method text NOT NULL CHECK (method IN ('transfer', 'wallet', 'other')),
  reference text NOT NULL CHECK (length(reference) BETWEEN 3 AND 80),
  note text CHECK (note IS NULL OR length(note) <= 300),
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  -- A resubmission points at the rejected request it replaces (D19).
  resubmits_id uuid,
  decided_by uuid REFERENCES users (id),
  decided_at timestamptz,
  reject_reason text CHECK (reject_reason IS NULL OR length(reject_reason) <= 300),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (workspace_id, id),
  CHECK ((status = 'rejected') = (reject_reason IS NOT NULL)),
  CHECK ((status IN ('approved', 'rejected')) = (decided_by IS NOT NULL)),
  FOREIGN KEY (workspace_id, membership_id) REFERENCES memberships (workspace_id, id),
  FOREIGN KEY (workspace_id, resubmits_id) REFERENCES payment_requests (workspace_id, id)
);
--> statement-breakpoint
CREATE INDEX payment_requests_status_idx ON payment_requests (workspace_id, status, created_at);
--> statement-breakpoint
CREATE INDEX payment_requests_reference_idx ON payment_requests (workspace_id, lower(reference));
--> statement-breakpoint
SELECT app.enable_tenant_rls('payment_requests');
--> statement-breakpoint
REVOKE DELETE ON payment_requests FROM app_runtime, app_platform;
--> statement-breakpoint
ALTER TABLE payment_entries
  ADD FOREIGN KEY (workspace_id, request_id) REFERENCES payment_requests (workspace_id, id);
