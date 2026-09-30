import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { Clock, IdGenerator } from '../../../common';
import { TenantDb, type DbTx } from '../../../database';
import { JobsRuntime } from '../../../jobs';
import { pushSubscriptions } from '../schema';
import { PushSender } from './push-sender';

export interface PushJob {
  userIds: string[];
  /** Path in the web app to open. */
  link: string | null;
}

/**
 * The generic text of every push (Arabic first, then English). Content stays in the app: the
 * push only says there is something new, so nothing personal passes through the browser
 * vendors' push services.
 */
const MESSAGE = {
  title: 'منصة المعلّم',
  body: 'لديك إشعار جديد. · You have a new notification.',
};

/** Web push (REQ-NOTIF-001): subscriptions, and delivery from the queue. */
@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger('Push');

  constructor(
    private readonly db: TenantDb,
    private readonly jobs: JobsRuntime,
    private readonly sender: PushSender,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.jobs.register<PushJob>('notify.push', (job) => this.deliver(job));
  }

  get enabled(): boolean {
    return this.sender.publicKey !== null;
  }

  get publicKey(): string | null {
    return this.sender.publicKey;
  }

  /** Called with the notification, in its transaction: the push exists only if it commits. */
  async enqueue(tx: DbTx, userIds: string[], link: string | null): Promise<void> {
    if (!this.enabled || userIds.length === 0) return;
    await this.jobs.enqueue<PushJob>(tx, 'notify.push', { userIds: [...new Set(userIds)], link });
  }

  /** Saves this browser for the user; an endpoint moves to whoever subscribed it last. */
  async subscribe(
    userId: string,
    input: { endpoint: string; p256dh: string; auth: string },
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .insert(pushSubscriptions)
        .values({ id: this.ids.newId(), userId, ...input, createdAt: this.clock.now() })
        .onConflictDoUpdate({
          target: pushSubscriptions.endpoint,
          set: { userId, p256dh: input.p256dh, auth: input.auth, createdAt: this.clock.now() },
        });
    });
  }

  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await this.db.transaction((tx) =>
      tx
        .delete(pushSubscriptions)
        .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint))),
    );
  }

  /**
   * One job per notification or announcement batch. A failed send is retried with the job; a
   * subscription the browser reports gone is deleted. Sends are sequential, which keeps a batch
   * of 250 well inside the push services' rate limits.
   */
  async deliver(job: PushJob): Promise<void> {
    if (!this.enabled || job.userIds.length === 0) return;
    const targets = await this.db.transaction((tx) =>
      tx.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, job.userIds)),
    );
    let failed = 0;
    for (const target of targets) {
      try {
        const result = await this.sender.send(target, { ...MESSAGE, url: job.link ?? '/' });
        await this.db.transaction((tx) =>
          result === 'gone'
            ? tx.delete(pushSubscriptions).where(eq(pushSubscriptions.id, target.id))
            : tx
                .update(pushSubscriptions)
                .set({ lastSuccessAt: this.clock.now() })
                .where(eq(pushSubscriptions.id, target.id)),
        );
      } catch (err) {
        failed++;
        this.logger.warn({ event: 'push_failed', subscriptionId: target.id, err });
      }
    }
    if (failed > 0 && failed === targets.length) {
      throw new Error(`All ${String(failed)} pushes failed`);
    }
  }
}
