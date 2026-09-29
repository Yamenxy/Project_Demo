-- Cash handovers (REQ-PAY-003): staff hand the cash they collected to the owner, who confirms.
CREATE TABLE cash_handovers (
  workspace_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  handed_by uuid NOT NULL REFERENCES users (id),
  amount_piastres bigint NOT NULL CHECK (amount_piastres BETWEEN 1 AND 1000000000),
  currency text NOT NULL DEFAULT 'EGP' CHECK (currency ~ '^[A-Z]{3}$'),
  note text CHECK (note IS NULL OR length(note) <= 300),
  status text NOT NULL CHECK (status IN ('pending', 'confirmed', 'rejected')),
  decided_by uuid REFERENCES users (id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL,
  UNIQUE (workspace_id, id),
  CHECK ((status = 'pending') = (decided_by IS NULL)),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id)
);
--> statement-breakpoint
CREATE INDEX cash_handovers_by_idx ON cash_handovers (workspace_id, handed_by);
--> statement-breakpoint
SELECT app.enable_tenant_rls('cash_handovers');
--> statement-breakpoint
REVOKE DELETE ON cash_handovers FROM app_runtime, app_platform;
