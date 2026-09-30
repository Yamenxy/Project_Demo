import { Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNull, lte, ne } from 'drizzle-orm';
import { TenantDb, type DbTx } from '../../database';
import {
  memberships,
  platformOwners,
  supportSessions,
  workspaces,
  type MembershipRole,
  type MembershipStatus,
} from './schema';

export interface MembershipContext {
  membershipId: string;
  workspaceId: string;
  userId: string;
  role: MembershipRole;
  status: MembershipStatus;
  paused: boolean;
  workspaceSuspended: boolean;
  /**
   * Set when a platform owner reads the workspace through a support session (REQ-RBAC-003): an
   * owner's view, read-only, with no membership of its own.
   */
  supportSessionId?: string;
}

/** Stands in for the membership id of a support session, which has none. */
export const SUPPORT_MEMBERSHIP_ID = '00000000-0000-0000-0000-000000000000';

export interface MyWorkspace {
  workspaceId: string;
  slug: string;
  name: string;
  role: MembershipRole;
  status: MembershipStatus;
}

@Injectable()
export class MembershipsService {
  constructor(private readonly db: TenantDb) {}

  /**
   * The caller's membership in a workspace, read inside the workspace scope (architecture §3,
   * step 3). Null if the user isn't a member, or the membership was removed.
   */
  async resolve(tx: DbTx, workspaceId: string, userId: string): Promise<MembershipContext | null> {
    const [row] = await tx
      .select({
        membershipId: memberships.id,
        role: memberships.role,
        status: memberships.status,
        pausedAt: memberships.pausedAt,
        suspendedAt: workspaces.suspendedAt,
      })
      .from(memberships)
      .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
      .where(
        and(
          eq(memberships.workspaceId, workspaceId),
          eq(memberships.userId, userId),
          ne(memberships.status, 'removed'),
        ),
      );
    if (!row) return null;
    return {
      membershipId: row.membershipId,
      workspaceId,
      userId,
      role: row.role,
      status: row.status,
      paused: row.pausedAt !== null,
      workspaceSuspended: row.suspendedAt !== null,
    };
  }

  /**
   * An open support session of this platform owner in this workspace, as a read-only owner's
   * context, or null. The caller must already be in the workspace's scope.
   */
  async resolveSupport(
    tx: DbTx,
    workspaceId: string,
    userId: string,
    now: Date,
  ): Promise<MembershipContext | null> {
    const [row] = await tx
      .select({ id: supportSessions.id, suspendedAt: workspaces.suspendedAt })
      .from(supportSessions)
      .innerJoin(workspaces, eq(workspaces.id, supportSessions.workspaceId))
      .innerJoin(platformOwners, eq(platformOwners.userId, supportSessions.platformUserId))
      .where(
        and(
          eq(supportSessions.workspaceId, workspaceId),
          eq(supportSessions.platformUserId, userId),
          isNull(supportSessions.endedAt),
          lte(supportSessions.startedAt, now),
          gt(supportSessions.expiresAt, now),
        ),
      )
      .orderBy(desc(supportSessions.startedAt))
      .limit(1);
    if (!row) return null;
    return {
      membershipId: SUPPORT_MEMBERSHIP_ID,
      workspaceId,
      userId,
      role: 'owner',
      status: 'active',
      paused: false,
      workspaceSuspended: row.suspendedAt !== null,
      supportSessionId: row.id,
    };
  }

  /** Every workspace the user belongs to, for the workspace switcher (REQ-USER-006 context). */
  listForUser(userId: string): Promise<MyWorkspace[]> {
    return this.db.forUser(userId, (tx) =>
      tx
        .select({
          workspaceId: workspaces.id,
          slug: workspaces.slug,
          name: workspaces.name,
          role: memberships.role,
          status: memberships.status,
        })
        .from(memberships)
        .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
        .where(and(eq(memberships.userId, userId), ne(memberships.status, 'removed')))
        .orderBy(workspaces.name),
    );
  }

  async isPlatformOwner(userId: string): Promise<boolean> {
    const rows = await this.db.transaction((tx) =>
      tx.select().from(platformOwners).where(eq(platformOwners.userId, userId)),
    );
    return rows.length > 0;
  }
}
