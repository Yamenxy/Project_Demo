import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { AppError, Clock } from '../../common';
import { TenantDb } from '../../database';
import { AuditService } from '../audit';
import { users } from '../identity';
import { workspaces } from './schema';

export interface Actor {
  userId: string;
  requestId?: string;
}

/** Days between asking to delete an account and its anonymization (REQ-PRIV-003). */
export const DELETION_GRACE_DAYS = 14;
const DAY = 24 * 3600 * 1000;

/**
 * A person's own account (REQ-PRIV-003): correcting their name, and asking for the account to be
 * deleted, with 14 days to change their mind. The anonymization itself is a platform job.
 */
@Injectable()
export class AccountService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  async updateProfile(
    input: { nameAr: string; nameLatin?: string | null },
    actor: Actor,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [before] = await tx
        .select({ nameAr: users.nameAr, nameLatin: users.nameLatin })
        .from(users)
        .where(eq(users.id, actor.userId));
      if (!before) throw new AppError(401, 'unauthenticated', 'Authentication required');
      const after = { nameAr: input.nameAr.trim(), nameLatin: input.nameLatin?.trim() || null };
      await tx
        .update(users)
        .set({ ...after, updatedAt: this.clock.now() })
        .where(eq(users.id, actor.userId));
      await this.audit.record(tx, {
        action: 'account.profile_updated',
        workspaceId: null,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'user', id: actor.userId },
        // Names are personal data: kept only where anonymization clears them.
        personalContext: { before, after },
        requestId: actor.requestId,
      });
    });
  }

  /** Starts the 14 days. An owner must hand over or close their workspace first. */
  async requestDeletion(actor: Actor): Promise<{ anonymizeAfter: Date }> {
    return this.db.transaction(async (tx) => {
      const owned = await tx
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.ownerUserId, actor.userId));
      if (owned.length > 0) {
        throw new AppError(
          409,
          'owner_cannot_delete',
          'Workspace owners contact the platform team to close or hand over their workspace first',
        );
      }
      const now = this.clock.now();
      const [row] = await tx
        .update(users)
        .set({ deletionRequestedAt: now, updatedAt: now })
        .where(and(eq(users.id, actor.userId), isNull(users.deletionRequestedAt)))
        .returning({ at: users.deletionRequestedAt });
      const requestedAt =
        row?.at ??
        (
          await tx
            .select({ at: users.deletionRequestedAt })
            .from(users)
            .where(eq(users.id, actor.userId))
        )[0]?.at ??
        now;
      if (row) {
        await this.audit.record(tx, {
          action: 'account.deletion_requested',
          workspaceId: null,
          actor: { type: 'user', userId: actor.userId },
          entity: { type: 'user', id: actor.userId },
          requestId: actor.requestId,
        });
      }
      return { anonymizeAfter: new Date(requestedAt.getTime() + DELETION_GRACE_DAYS * DAY) };
    });
  }

  async cancelDeletion(actor: Actor): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(users)
        .set({ deletionRequestedAt: null, updatedAt: this.clock.now() })
        .where(and(eq(users.id, actor.userId), eq(users.status, 'active')))
        .returning({ id: users.id });
      if (!row) return;
      await this.audit.record(tx, {
        action: 'account.deletion_cancelled',
        workspaceId: null,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'user', id: actor.userId },
        requestId: actor.requestId,
      });
    });
  }
}
