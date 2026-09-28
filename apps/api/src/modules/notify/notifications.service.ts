import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import { AppError, Clock, IdGenerator } from '../../common';
import { TenantDb, type DbTx } from '../../database';
import { JobsRuntime } from '../../jobs';
import { ContactDirectory } from './contact-directory';
import { EmailSender } from './email/email-sender';
import { hasEmailTemplate, renderEmail } from './email/templates';
import { notifications } from './schema';

type Params = Record<string, string | number | boolean>;

export interface NotifyInput {
  recipientUserId: string;
  /** NULL for account-level notifications. Must be the transaction's workspace otherwise. */
  workspaceId: string | null;
  /** `<area>.<event>`, also the message key the web app renders. */
  type: string;
  params?: Params;
  /** In-app deep link (a path in the web app). */
  link?: string;
  /** Also email the recipient, if they have a verified email and a template exists. */
  email?: boolean;
}

export interface NotificationView {
  id: string;
  createdAt: Date;
  workspaceId: string | null;
  type: string;
  params: Params;
  link: string | null;
  read: boolean;
}

interface EmailJob {
  userId: string;
  type: string;
  params: Params;
}

const PAGE_SIZE = 30;

/**
 * Notifications (review §3.19). The in-app row is written in the caller's transaction; email is
 * a job enqueued in the same transaction, so both exist only if the change committed, and a
 * failed email never rolls back the change (review §3.25).
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger('Notifications');

  constructor(
    private readonly db: TenantDb,
    private readonly jobs: JobsRuntime,
    private readonly email: EmailSender,
    private readonly contacts: ContactDirectory,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.jobs.register<EmailJob>('notify.email', (job) => this.deliverEmail(job));
  }

  async notify(tx: DbTx, input: NotifyInput): Promise<string> {
    const id = this.ids.newId();
    const params = input.params ?? {};
    await tx.insert(notifications).values({
      id,
      createdAt: this.clock.now(),
      recipientUserId: input.recipientUserId,
      workspaceId: input.workspaceId,
      type: input.type,
      params,
      link: input.link ?? null,
    });
    if (input.email && hasEmailTemplate(input.type)) {
      await this.jobs.enqueue<EmailJob>(tx, 'notify.email', {
        userId: input.recipientUserId,
        type: input.type,
        params,
      });
    }
    return id;
  }

  /** The recipient's notifications, newest first, with keyset pagination (review PERF-07). */
  async list(
    userId: string,
    before?: Date,
  ): Promise<{ items: NotificationView[]; unread: number }> {
    return this.db.forUser(userId, async (tx) => {
      const rows = await tx
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.recipientUserId, userId),
            before ? lt(notifications.createdAt, before) : undefined,
          ),
        )
        .orderBy(desc(notifications.createdAt))
        .limit(PAGE_SIZE);
      const [count] = await tx
        .select({ unread: sql<number>`count(*)::int` })
        .from(notifications)
        .where(and(eq(notifications.recipientUserId, userId), isNull(notifications.readAt)));
      return {
        items: rows.map((row) => ({
          id: row.id,
          createdAt: row.createdAt,
          workspaceId: row.workspaceId,
          type: row.type,
          params: row.params,
          link: row.link,
          read: row.readAt !== null,
        })),
        unread: count?.unread ?? 0,
      };
    });
  }

  async markRead(userId: string, notificationId: string): Promise<void> {
    const updated = await this.db.forUser(userId, (tx) =>
      tx
        .update(notifications)
        .set({ readAt: this.clock.now() })
        .where(and(eq(notifications.id, notificationId), eq(notifications.recipientUserId, userId)))
        .returning({ id: notifications.id }),
    );
    if (updated.length === 0) throw new AppError(404, 'not_found', 'Notification not found');
  }

  async markAllRead(userId: string): Promise<void> {
    await this.db.forUser(userId, (tx) =>
      tx
        .update(notifications)
        .set({ readAt: this.clock.now() })
        .where(and(eq(notifications.recipientUserId, userId), isNull(notifications.readAt))),
    );
  }

  private async deliverEmail(job: EmailJob): Promise<void> {
    const address = await this.contacts.verifiedEmail(job.userId);
    if (!address) {
      this.logger.log({ event: 'email_skipped', reason: 'no_verified_email', type: job.type });
      return;
    }
    await this.email.send({ to: address, ...renderEmail(job.type, job.params) });
  }
}
