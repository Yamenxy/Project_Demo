import { Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import { AppError, Clock, IdGenerator, notFound } from '../../common';
import { PlatformDb } from '../../database/platform-db';
import { AuditService } from '../audit';
import { NotificationsService } from '../notify';
import { platformOwners, supportSessions, workspaces } from '../tenancy';
import type { Actor } from './platform.service';

export interface SupportSessionView {
  id: string;
  platformUserId: string;
  reason: string;
  ticket: string;
  startedAt: Date;
  expiresAt: Date;
  endedAt: Date | null;
  active: boolean;
}

export const SUPPORT_MAX_MINUTES = 60;

/**
 * Support sessions (REQ-RBAC-003): a platform owner opens read-only access to one workspace with
 * a reason and a ticket, for at most 60 minutes. The owner teacher and the other platform owners
 * are told; opening, closing and every request made are in the workspace's audit log.
 */
@Injectable()
export class SupportService {
  constructor(
    private readonly platformDb: PlatformDb,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async start(
    workspaceId: string,
    input: { reason: string; ticket: string; minutes: number },
    actor: Actor,
  ): Promise<SupportSessionView> {
    if (input.minutes < 1 || input.minutes > SUPPORT_MAX_MINUTES) {
      throw new AppError(400, 'support_too_long', 'A support session lasts at most 60 minutes');
    }
    return this.platformDb.run('support: open a session', async (tx) => {
      const [workspace] = await tx
        .select({ name: workspaces.name, ownerUserId: workspaces.ownerUserId })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId));
      if (!workspace) throw notFound('Workspace not found');
      const now = this.clock.now();
      // One open session per person and workspace: a new one closes the previous one.
      await tx
        .update(supportSessions)
        .set({ endedAt: now })
        .where(
          and(
            eq(supportSessions.workspaceId, workspaceId),
            eq(supportSessions.platformUserId, actor.userId),
            isNull(supportSessions.endedAt),
          ),
        );
      const id = this.ids.newId();
      const expiresAt = new Date(now.getTime() + input.minutes * 60_000);
      await tx.insert(supportSessions).values({
        workspaceId,
        id,
        platformUserId: actor.userId,
        reason: input.reason.trim(),
        ticket: input.ticket.trim(),
        startedAt: now,
        expiresAt,
      });
      await this.audit.record(tx, {
        action: 'support.session_started',
        workspaceId,
        actor: { type: 'platform_owner', userId: actor.userId },
        entity: { type: 'support_session', id },
        newValue: { ticket: input.ticket.trim(), expiresAt: expiresAt.toISOString() },
        reason: input.reason.trim(),
        requestId: actor.requestId,
      });
      await this.notifications.notify(tx, {
        recipientUserId: workspace.ownerUserId,
        workspaceId,
        type: 'support.session_started',
        params: { minutes: input.minutes },
        link: `/w/${workspaceId}/audit-log`,
        email: true,
      });
      const others = await tx
        .select({ userId: platformOwners.userId })
        .from(platformOwners)
        .where(ne(platformOwners.userId, actor.userId));
      for (const other of others) {
        await this.notifications.notify(tx, {
          recipientUserId: other.userId,
          workspaceId: null,
          type: 'support.session_started_platform',
          params: { workspace: workspace.name, minutes: input.minutes },
          link: `/platform/${workspaceId}`,
        });
      }
      return view(
        {
          id,
          workspaceId,
          platformUserId: actor.userId,
          reason: input.reason.trim(),
          ticket: input.ticket.trim(),
          startedAt: now,
          expiresAt,
          endedAt: null,
        },
        now,
      );
    });
  }

  async end(sessionId: string, actor: Actor): Promise<void> {
    await this.platformDb.run('support: close a session', async (tx) => {
      const now = this.clock.now();
      const [closed] = await tx
        .update(supportSessions)
        .set({ endedAt: now })
        .where(and(eq(supportSessions.id, sessionId), isNull(supportSessions.endedAt)))
        .returning({ workspaceId: supportSessions.workspaceId });
      if (!closed) throw notFound('No open support session');
      await this.audit.record(tx, {
        action: 'support.session_ended',
        workspaceId: closed.workspaceId,
        actor: { type: 'platform_owner', userId: actor.userId },
        entity: { type: 'support_session', id: sessionId },
        requestId: actor.requestId,
      });
    });
  }

  /** The workspace's recent support sessions, for the platform console. */
  async list(workspaceId: string): Promise<SupportSessionView[]> {
    const now = this.clock.now();
    const rows = await this.platformDb.run('support: list sessions', (tx) =>
      tx
        .select()
        .from(supportSessions)
        .where(
          and(
            eq(supportSessions.workspaceId, workspaceId),
            sql`${supportSessions.startedAt} > now() - interval '30 days'`,
          ),
        )
        .orderBy(desc(supportSessions.startedAt))
        .limit(20),
    );
    return rows.map((r) => view(r, now));
  }
}

function view(row: typeof supportSessions.$inferSelect, now: Date): SupportSessionView {
  return {
    id: row.id,
    platformUserId: row.platformUserId,
    reason: row.reason,
    ticket: row.ticket,
    startedAt: row.startedAt,
    expiresAt: row.expiresAt,
    endedAt: row.endedAt,
    active: row.endedAt === null && row.expiresAt > now,
  };
}
