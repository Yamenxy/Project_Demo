import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const tstz = (name: string) => timestamp(name, { withTimezone: true });

/** Mirrors drizzle/0005_tenancy.sql. */
export const platformOwners = pgTable('platform_owners', {
  userId: uuid('user_id').primaryKey(),
  createdAt: tstz('created_at').notNull(),
});

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey(),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  ownerUserId: uuid('owner_user_id').notNull(),
  suspendedAt: tstz('suspended_at'),
  suspensionReason: text('suspension_reason', { enum: ['billing', 'admin'] }),
  createdAt: tstz('created_at').notNull(),
  updatedAt: tstz('updated_at').notNull(),
});

export const MEMBERSHIP_ROLES = ['owner', 'class_teacher', 'assistant', 'student'] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];
export const MEMBERSHIP_STATUSES = ['pending', 'active', 'suspended', 'removed'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const memberships = pgTable('memberships', {
  workspaceId: uuid('workspace_id').notNull(),
  id: uuid('id').primaryKey(),
  userId: uuid('user_id'),
  role: text('role', { enum: MEMBERSHIP_ROLES }).notNull(),
  status: text('status', { enum: MEMBERSHIP_STATUSES }).notNull(),
  internalCode: text('internal_code'),
  notes: text('notes'),
  provisionalName: text('provisional_name'),
  provisionalPhone: text('provisional_phone'),
  pausedAt: tstz('paused_at'),
  pausedBy: uuid('paused_by'),
  pauseReason: text('pause_reason'),
  createdAt: tstz('created_at').notNull(),
  updatedAt: tstz('updated_at').notNull(),
  version: integer('version').notNull(),
});

export const workspaceInvitations = pgTable('workspace_invitations', {
  workspaceId: uuid('workspace_id').notNull(),
  id: uuid('id').primaryKey(),
  phoneE164: text('phone_e164').notNull(),
  role: text('role', { enum: ['class_teacher', 'assistant', 'student'] }).notNull(),
  tokenHash: text('token_hash').notNull(),
  invitedBy: uuid('invited_by').notNull(),
  membershipId: uuid('membership_id'),
  createdAt: tstz('created_at').notNull(),
  expiresAt: tstz('expires_at').notNull(),
  acceptedAt: tstz('accepted_at'),
  acceptedBy: uuid('accepted_by'),
  revokedAt: tstz('revoked_at'),
});
