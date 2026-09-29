// Aggregates every module's Drizzle tables. Migrations are hand-written SQL in apps/api/drizzle
// (created with `pnpm db:new-migration <name>`); these table definitions mirror them for typed
// queries, and test/database/schema-drift.int.spec.ts checks that they match.
export { idempotencyKeys } from '../idempotency/schema';
export { auditLog } from '../modules/audit/schema';
export { notifications } from '../modules/notify/schema';
export {
  platformPayments,
  subscriptionReminders,
  subscriptions,
} from '../modules/platform-admin/schema';
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
