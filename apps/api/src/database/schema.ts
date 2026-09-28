// Aggregates every module's Drizzle tables. Migrations are hand-written SQL in apps/api/drizzle
// (created with `pnpm db:new-migration <name>`); these table definitions mirror them for typed
// queries, and test/database/schema-drift.int.spec.ts checks that they match.
export { auditLog } from '../modules/audit/schema';
