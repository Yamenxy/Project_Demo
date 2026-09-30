import { Injectable, type OnModuleInit } from '@nestjs/common';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { AppError, Clock, IdGenerator, notFound } from '../../common';
import { TenantDb, type DbTx } from '../../database';
import { JobsRuntime } from '../../jobs';
import { AuditService } from '../audit';
import { classes, classScope } from '../classes';
import { users } from '../identity';
import { NotificationsService } from '../notify';
import type { WorkspaceContext } from '../tenancy';
import { announcements } from './schema';

export interface Actor {
  userId: string;
  requestId?: string;
}

export interface AnnouncementView {
  id: string;
  classId: string | null;
  className: string | null;
  title: string;
  body: string;
  authorName: string;
  createdAt: Date;
  recipients: number;
  delivered: boolean;
}

interface FanoutJob {
  workspaceId: string;
  announcementId: string;
  /** Membership id after which this batch starts; null for the first batch. */
  after: string | null;
}

/** Recipients per batch, and the pause between batches: about 2,000 in 15 seconds. */
export const FANOUT_BATCH = 250;
const FANOUT_PAUSE_MS = 1500;

/**
 * Announcements (`announcements.post`, REQ-NOTIF-001): to every student of the workspace, or of
 * one class. Posting only writes the announcement and enqueues the first batch; the queue writes
 * the in-app notifications at a limited rate, so a big announcement never spikes the API.
 */
@Injectable()
export class AnnouncementsService implements OnModuleInit {
  constructor(
    private readonly db: TenantDb,
    private readonly jobs: JobsRuntime,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.jobs.register<FanoutJob>('announce.fanout', (job) => this.fanout(job));
  }

  async post(
    ctx: WorkspaceContext,
    input: { classId?: string; title: string; body: string },
    actor: Actor,
  ): Promise<{ id: string; recipients: number }> {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      if (input.classId) {
        const [cls] = await tx
          .select({ id: classes.id })
          .from(classes)
          .where(and(eq(classes.id, input.classId), isNull(classes.archivedAt)));
        if (!cls) throw notFound('Class not found');
        if (!ctx.permissions.coversClass('announcements.post', input.classId)) {
          throw new AppError(403, 'forbidden', 'Not allowed');
        }
      } else if (!ctx.permissions.hasEverywhere('announcements.post')) {
        // Class-scoped staff announce to their classes only.
        throw new AppError(403, 'forbidden', 'Not allowed');
      }
      const id = this.ids.newId();
      const recipients = await this.countRecipients(tx, input.classId ?? null);
      await tx.insert(announcements).values({
        workspaceId: ctx.workspaceId,
        id,
        classId: input.classId ?? null,
        title: input.title.trim(),
        body: input.body.trim(),
        authorUserId: actor.userId,
        createdAt: this.clock.now(),
        recipients,
      });
      await this.jobs.enqueue<FanoutJob>(
        tx,
        'announce.fanout',
        { workspaceId: ctx.workspaceId, announcementId: id, after: null },
        { id: this.ids.newId() },
      );
      await this.audit.record(tx, {
        action: 'announcement.posted',
        workspaceId: ctx.workspaceId,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'announcement', id },
        newValue: { classId: input.classId ?? null, title: input.title, recipients },
        requestId: actor.requestId,
      });
      return { id, recipients };
    });
  }

  /** Staff: workspace-wide announcements and those of the classes they work with. */
  async list(ctx: WorkspaceContext): Promise<AnnouncementView[]> {
    return this.db.inWorkspace(ctx.workspaceId, (tx) =>
      this.query(tx, or(isNull(announcements.classId), classScope(ctx) ?? sql`true`)),
    );
  }

  /** A student: workspace-wide ones, and those of classes they're enrolled in now. */
  async mine(ctx: WorkspaceContext): Promise<AnnouncementView[]> {
    return this.db.inWorkspace(ctx.workspaceId, (tx) =>
      this.query(
        tx,
        or(
          isNull(announcements.classId),
          sql`exists (select 1 from class_enrollments e where e.class_id = ${announcements.classId}
                 and e.membership_id = ${ctx.membershipId} and e.ended_at is null)`,
        ),
      ),
    );
  }

  /**
   * One batch of recipients, in membership-id order after the job's cursor. The notifications
   * and the new cursor commit together; a retried or duplicate batch finds the cursor moved on
   * and does nothing. Then the next batch is enqueued after a pause.
   */
  async fanout(job: FanoutJob): Promise<void> {
    await this.db.inWorkspace(job.workspaceId, async (tx) => {
      const [a] = await tx
        .select()
        .from(announcements)
        .where(eq(announcements.id, job.announcementId))
        .for('update');
      if (!a || a.fanoutDoneAt || a.fanoutCursor !== job.after) return;
      const batch = await tx.execute<{ membership_id: string; user_id: string }>(sql`
        select m.id as membership_id, m.user_id from memberships m
         where m.role = 'student' and m.status = 'active' and m.user_id is not null
           ${a.classId ? sql`and exists (select 1 from class_enrollments e where e.class_id = ${a.classId} and e.membership_id = m.id and e.ended_at is null)` : sql``}
           ${job.after ? sql`and m.id > ${job.after}` : sql``}
         order by m.id
         limit ${FANOUT_BATCH}`);
      const rows = batch.rows;
      await this.notifications.notifyMany(
        tx,
        rows.map((r) => ({
          recipientUserId: r.user_id,
          workspaceId: job.workspaceId,
          type: 'announcement.posted',
          params: { title: a.title },
          link: `/w/${job.workspaceId}/announcements`,
        })),
      );
      const last = rows.at(-1)?.membership_id ?? null;
      const done = rows.length < FANOUT_BATCH;
      await tx
        .update(announcements)
        .set({ fanoutCursor: last ?? a.fanoutCursor, fanoutDoneAt: done ? this.clock.now() : null })
        .where(eq(announcements.id, a.id));
      if (!done) {
        await this.jobs.enqueue<FanoutJob>(
          tx,
          'announce.fanout',
          { workspaceId: job.workspaceId, announcementId: a.id, after: last },
          {
            id: this.ids.newId(),
            startAfter: new Date(this.clock.now().getTime() + FANOUT_PAUSE_MS),
          },
        );
      }
    });
  }

  private async countRecipients(tx: DbTx, classId: string | null): Promise<number> {
    const [row] = (
      await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from memberships m
         where m.role = 'student' and m.status = 'active' and m.user_id is not null
           ${classId ? sql`and exists (select 1 from class_enrollments e where e.class_id = ${classId} and e.membership_id = m.id and e.ended_at is null)` : sql``}`)
    ).rows;
    return row?.n ?? 0;
  }

  private async query(tx: DbTx, where: ReturnType<typeof or>): Promise<AnnouncementView[]> {
    const rows = await tx
      .select({
        a: announcements,
        className: classes.name,
        authorName: users.nameAr,
      })
      .from(announcements)
      .leftJoin(classes, eq(classes.id, announcements.classId))
      .innerJoin(users, eq(users.id, announcements.authorUserId))
      .where(where)
      .orderBy(desc(announcements.createdAt), desc(announcements.id))
      .limit(50);
    return rows.map(({ a, className, authorName }) => ({
      id: a.id,
      classId: a.classId,
      className,
      title: a.title,
      body: a.body,
      authorName,
      createdAt: a.createdAt,
      recipients: a.recipients,
      delivered: a.fanoutDoneAt !== null,
    }));
  }
}
