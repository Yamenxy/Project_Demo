-- Flow A, simplified (REQ-SUB-001): platform owners set a workspace's plan and paid-until date and
-- record payments; grace and billing suspension then run automatically (D12a).
CREATE TABLE subscriptions (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces (id),
  plan text NOT NULL CHECK (plan IN ('starter', 'growth', 'pro')),
  period_ends_at timestamptz NOT NULL,
  grace_days integer NOT NULL DEFAULT 7 CHECK (grace_days BETWEEN 0 AND 60),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX subscriptions_period_idx ON subscriptions (period_ends_at);
--> statement-breakpoint
SELECT app.enable_tenant_rls('subscriptions');
--> statement-breakpoint
-- Teachers read their own subscription; only the platform role changes it.
REVOKE INSERT, UPDATE, DELETE ON subscriptions FROM app_runtime;
--> statement-breakpoint
-- Payment ledger: never updated or deleted (corrections are new entries, review §3.18).
CREATE TABLE platform_payments (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  amount_piastres integer NOT NULL CHECK (amount_piastres > 0),
  currency text NOT NULL DEFAULT 'EGP' CHECK (currency = 'EGP'),
  method text NOT NULL CHECK (method IN ('cash', 'instapay', 'wallet', 'bank_transfer', 'fawry')),
  reference text CHECK (reference IS NULL OR length(reference) <= 80),
  paid_on date NOT NULL,
  months integer NOT NULL CHECK (months BETWEEN 1 AND 12),
  notes text CHECK (notes IS NULL OR length(notes) <= 500),
  recorded_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX platform_payments_workspace_idx ON platform_payments (workspace_id, created_at DESC);
--> statement-breakpoint
SELECT app.enable_tenant_rls('platform_payments');
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON platform_payments FROM app_runtime;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON platform_payments FROM app_platform;
--> statement-breakpoint
-- One reminder of each kind per paid period, whatever how often the daily job runs.
CREATE TABLE subscription_reminders (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  period_ends_at timestamptz NOT NULL,
  kind text NOT NULL CHECK (kind IN ('before_end', 'on_end', 'after_end')),
  sent_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, period_ends_at, kind)
);
--> statement-breakpoint
REVOKE ALL ON subscription_reminders FROM app_runtime;
