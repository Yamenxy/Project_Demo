// Aggregates every module's Drizzle tables. Migrations are hand-written SQL in apps/api/drizzle
// (created with `pnpm db:new-migration <name>`); these table definitions mirror them for typed
// queries, and test/database/schema-drift.int.spec.ts checks that they match.
export { idempotencyKeys } from '../idempotency/schema';
export { auditLog } from '../modules/audit/schema';
export { classEnrollments, classes } from '../modules/classes/schema';
export {
  attendanceRecords,
  classSeries,
  classSessions,
  workspaceSkipDates,
} from '../modules/classes/schedule-schema';
export {
  accessGroupLessons,
  accessGroupMembers,
  accessGroups,
  courses,
  lessonRules,
  lessons,
} from '../modules/content/schema';
export { files } from '../modules/files/schema';
export { notifications } from '../modules/notify/schema';
export { lessonVideos, videoWatchTime } from '../modules/video/schema';
export {
  cashHandovers,
  paymentEntries,
  paymentRequests,
  priceItems,
  receiptCounters,
} from '../modules/payments/schema';
export {
  platformPayments,
  subscriptionReminders,
  subscriptions,
} from '../modules/platform-admin/schema';
export {
  deviceRegistrations,
  guardianConsents,
  otpChallenges,
  rateLimitCounters,
  recoveryCodes,
  sessions,
  users,
} from '../modules/identity/schema';
export {
  memberships,
  permissionGrantClasses,
  permissionGrants,
  platformOwners,
  workspaceInvitations,
  workspaces,
  workspaceSettings,
} from '../modules/tenancy/schema';
