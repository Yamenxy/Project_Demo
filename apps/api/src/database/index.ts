// Public API of the database layer. PlatformDb is deliberately NOT exported here: import it from
// './platform-db' directly, which lint allows only in the tenancy and platform-admin modules.
export { DatabaseModule } from './database.module';
export { isUniqueViolation } from './pg-errors';
export { UnsafeDatabaseRoleError } from './role-check';
export { TenantDb } from './tenant-db';
export { isUuid, type DbTx } from './types';
