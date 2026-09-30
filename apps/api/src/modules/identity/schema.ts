import {
  bigint,
  date,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

const tstz = (name: string) => timestamp(name, { withTimezone: true });

/** Mirrors drizzle/0003_identity.sql. */
export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  platformCode: text('platform_code').notNull(),
  nameAr: text('name_ar').notNull(),
  nameLatin: text('name_latin'),
  phoneE164: text('phone_e164').notNull(),
  phoneVerifiedAt: tstz('phone_verified_at'),
  email: text('email'),
  emailVerifiedAt: tstz('email_verified_at'),
  dateOfBirth: date('date_of_birth'),
  guardianPhoneE164: text('guardian_phone_e164'),
  guardianConsentAt: tstz('guardian_consent_at'),
  status: text('status', {
    enum: ['pending', 'active', 'suspended', 'archived', 'anonymized'],
  }).notNull(),
  passwordHash: text('password_hash').notNull(),
  passwordChangedAt: tstz('password_changed_at').notNull(),
  devicesResetAt: tstz('devices_reset_at'),
  deletionRequestedAt: tstz('deletion_requested_at'),
  totpSecretEncrypted: text('totp_secret_encrypted'),
  totpEnabledAt: tstz('totp_enabled_at'),
  totpLastStep: bigint('totp_last_step', { mode: 'number' }),
  createdAt: tstz('created_at').notNull(),
  updatedAt: tstz('updated_at').notNull(),
});

export type UserStatus = (typeof users.$inferSelect)['status'];

export const SESSION_REVOKE_REASONS = [
  'logout',
  'logout_all',
  'password_changed',
  'password_reset',
  'device_limit',
  'device_revoked',
  'admin',
  'membership_removed',
] as const;
export type SessionRevokeReason = (typeof SESSION_REVOKE_REASONS)[number];

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  deviceLabel: text('device_label'),
  createdAt: tstz('created_at').notNull(),
  lastSeenAt: tstz('last_seen_at').notNull(),
  idleExpiresAt: tstz('idle_expires_at').notNull(),
  absoluteExpiresAt: tstz('absolute_expires_at').notNull(),
  revokedAt: tstz('revoked_at'),
  revokeReason: text('revoke_reason', { enum: SESSION_REVOKE_REASONS }),
  deviceId: uuid('device_id'),
  secondFactorAt: tstz('second_factor_at'),
});

export const recoveryCodes = pgTable('recovery_codes', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  codeHash: text('code_hash').notNull(),
  createdAt: tstz('created_at').notNull(),
  usedAt: tstz('used_at'),
});

export const deviceRegistrations = pgTable('device_registrations', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  label: text('label'),
  createdAt: tstz('created_at').notNull(),
  lastSeenAt: tstz('last_seen_at').notNull(),
  revokedAt: tstz('revoked_at'),
  revokedByType: text('revoked_by_type', { enum: ['user', 'staff', 'support', 'system'] }),
});

export const otpChallenges = pgTable('otp_challenges', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  phoneE164: text('phone_e164').notNull(),
  purpose: text('purpose', {
    enum: ['verify_phone', 'password_reset', 'guardian_consent'],
  }).notNull(),
  codeHash: text('code_hash').notNull(),
  createdAt: tstz('created_at').notNull(),
  expiresAt: tstz('expires_at').notNull(),
  attempts: integer('attempts').notNull(),
  consumedAt: tstz('consumed_at'),
});

/** Mirrors drizzle/0013_guardian_consent.sql. Append-only. */
export const guardianConsents = pgTable('guardian_consents', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  method: text('method', { enum: ['otp', 'paper'] }).notNull(),
  version: text('version').notNull(),
  guardianPhoneE164: text('guardian_phone_e164'),
  workspaceId: uuid('workspace_id'),
  recordedBy: uuid('recorded_by'),
  note: text('note'),
  createdAt: tstz('created_at').notNull(),
});

export const rateLimitCounters = pgTable(
  'rate_limit_counters',
  {
    key: text('key').notNull(),
    windowStart: tstz('window_start').notNull(),
    count: integer('count').notNull(),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);
