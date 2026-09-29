-- The owner's price list (REQ-PAY-006). Amounts are integer piastres; items are archived, never
-- deleted, and payments copy the name and price, so later changes don't alter past payments.
CREATE TABLE price_items (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  amount_piastres bigint NOT NULL CHECK (amount_piastres BETWEEN 0 AND 100000000),
  currency text NOT NULL DEFAULT 'EGP' CHECK (currency ~ '^[A-Z]{3}$'),
  description text CHECK (description IS NULL OR length(description) <= 300),
  archived_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (workspace_id, id)
);
--> statement-breakpoint
SELECT app.enable_tenant_rls('price_items');
--> statement-breakpoint
REVOKE DELETE ON price_items FROM app_runtime, app_platform;
--> statement-breakpoint
-- The public page's price list: active items of one public, unsuspended workspace.
CREATE OR REPLACE FUNCTION app.public_price_list(p_slug text)
  RETURNS TABLE (name text, amount_piastres bigint, currency text, description text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT p.name, p.amount_piastres, p.currency, p.description
      FROM public.workspaces w
      JOIN public.workspace_settings s ON s.workspace_id = w.id
      JOIN public.price_items p ON p.workspace_id = w.id
     WHERE w.slug = lower(p_slug)
       AND s.public_page_enabled
       AND w.suspended_at IS NULL
       AND p.archived_at IS NULL
     ORDER BY p.amount_piastres, p.name
     LIMIT 50 $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.public_price_list(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.public_price_list(text) TO app_runtime, app_platform;
