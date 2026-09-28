// Aggregates every module's Drizzle tables. Migrations are hand-written SQL in apps/api/drizzle
// (created with `pnpm db:new-migration <name>`); these table definitions mirror them for typed
// queries, and test/database/schema-drift.int.spec.ts checks that they match.
export { auditLog } from '../modules/audit/schema';
export {
  deviceRegistrations,
  otpChallenges,
  rateLimitCounters,
  recoveryCodes,
  sessions,
  users,
} from '../modules/identity/schema';
export {
  memberships,
  permissionGrants,
  platformOwners,
  workspaceInvitations,
  workspaces,
} from '../modules/tenancy/schema';
