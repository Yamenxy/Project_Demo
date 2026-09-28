-- Background job queue (pg-boss). See docs/architecture.md §4 "Jobs".
--
-- The pgboss schema is owned by the migrator. pg-boss installs and upgrades its own tables during
-- the migration step (src/database/migrations.ts), never at application runtime. The runtime role
-- only reads and writes job rows: it enqueues jobs inside business transactions and runs workers.
-- Job payloads hold IDs only, never personal data, because job rows are not tenant-isolated.
CREATE SCHEMA IF NOT EXISTS pgboss;
--> statement-breakpoint
GRANT USAGE ON SCHEMA pgboss TO app_runtime;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss
  GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss
  GRANT EXECUTE ON FUNCTIONS TO app_runtime;
