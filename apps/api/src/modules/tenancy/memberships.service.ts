import { Injectable } from '@nestjs/common';
import { and, eq, ne } from 'drizzle-orm';
import { TenantDb, type DbTx } from '../../database';
import {
  memberships,
  platformOwners,
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
}

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
