-- Flow B payment ledger (REQ-PAY-003, REQ-PAY-004, REQ-PAY-007). Append-only: corrections and
-- refunds are reversal entries. Every entry has a receipt number, gapless per workspace.
CREATE TABLE receipt_counters (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces (id),
  last_number integer NOT NULL CHECK (last_number >= 0)
);
--> statement-breakpoint
SELECT app.enable_tenant_rls('receipt_counters');
--> statement-breakpoint
CREATE TABLE payment_entries (
  workspace_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  membership_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('payment', 'reversal')),
  amount_piastres bigint NOT NULL CHECK (amount_piastres BETWEEN 1 AND 100000000),
  currency text NOT NULL DEFAULT 'EGP' CHECK (currency ~ '^[A-Z]{3}$'),
  method text NOT NULL CHECK (method IN ('cash', 'transfer', 'wallet', 'other')),
  -- Who took the cash (REQ-PAY-003). For a reversal: who gave it back.
  collected_by uuid REFERENCES users (id),
  -- Copied from the price list at the time (REQ-PAY-006).
  price_item_id uuid,
  item_name text,
  item_price_piastres bigint,
  note text CHECK (note IS NULL OR length(note) <= 300),
  reverses_id uuid UNIQUE,
  -- The approved payment request this entry came from (Phase 4 task 4.3): one entry each.
  request_id uuid UNIQUE,
  receipt_number integer NOT NULL CHECK (receipt_number > 0),
  recorded_by uuid NOT NULL REFERENCES users (id),
  recorded_at timestamptz NOT NULL,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, receipt_number),
  CHECK ((kind = 'reversal') = (reverses_id IS NOT NULL)),
  CHECK (method <> 'cash' OR collected_by IS NOT NULL),
  FOREIGN KEY (workspace_id, membership_id) REFERENCES memberships (workspace_id, id),
  FOREIGN KEY (workspace_id, price_item_id) REFERENCES price_items (workspace_id, id),
  FOREIGN KEY (workspace_id, reverses_id) REFERENCES payment_entries (workspace_id, id)
);
--> statement-breakpoint
CREATE INDEX payment_entries_member_idx ON payment_entries (workspace_id, membership_id);
--> statement-breakpoint
CREATE INDEX payment_entries_time_idx ON payment_entries (workspace_id, recorded_at);
--> statement-breakpoint
SELECT app.enable_tenant_rls('payment_entries');
--> statement-breakpoint
REVOKE UPDATE, DELETE ON payment_entries FROM app_runtime, app_platform;
