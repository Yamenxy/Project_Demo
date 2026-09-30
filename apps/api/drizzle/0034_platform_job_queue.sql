-- The platform role writes notifications too (billing reminders, support sessions), and each
-- notification can enqueue jobs (email, push) in the same transaction. Give it the same access to
-- the job queue as the runtime role, for existing and future pg-boss tables.
GRANT USAGE ON SCHEMA pgboss TO app_platform;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO app_platform;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pgboss TO app_platform;
--> statement-breakpoint
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgboss TO app_platform;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_platform;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss
  GRANT USAGE, SELECT ON SEQUENCES TO app_platform;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss
  GRANT EXECUTE ON FUNCTIONS TO app_platform;
