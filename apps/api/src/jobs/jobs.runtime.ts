import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { fromDrizzle, type PgBoss } from 'pg-boss';
import { APP_CONFIG, type AppConfig } from '../config';
import type { DbTx } from '../database';
import { createBoss } from './boss';
import type { QueueName } from './queues';

export interface JobContext {
  jobId: string;
  queue: QueueName;
  /** 0 on the first attempt. Handlers must be safe to run more than once (review §3.27). */
  retryCount: number;
}

export type JobHandler<T extends object> = (data: T, ctx: JobContext) => Promise<void>;

export interface EnqueueOptions {
  /** Explicit job id: a second enqueue with the same id is ignored. */
  id?: string;
  startAfter?: Date;
  singletonKey?: string;
}

interface Registration {
  handler: JobHandler<object>;
  cron?: string;
}

/**
 * Owns this process's pg-boss instance.
 *
 * - `enqueue(tx, ...)` writes the job inside the caller's transaction, so a job exists only if
 *   the business change commits (the transactional outbox of architecture §1).
 * - Modules `register` handlers during `onModuleInit`; `startWorkers()` runs them. The API runs
 *   workers only with WORKER_MODE=inline; the separate worker process always does.
 */
@Injectable()
export class JobsRuntime implements OnApplicationShutdown {
  private readonly logger = new Logger('Jobs');
  private readonly boss: PgBoss;
  private readonly registrations = new Map<QueueName, Registration>();
  private started = false;
  private workersStarted = false;

  constructor(@Inject(APP_CONFIG) config: Pick<AppConfig, 'databaseUrl'>) {
    this.boss = createBoss(config.databaseUrl);
    this.boss.on('error', (err) => this.logger.error({ event: 'job_queue_error', err }));
  }

  register<T extends object>(queue: QueueName, handler: JobHandler<T>, cron?: string): void {
    if (this.workersStarted) throw new Error('Register job handlers before workers start');
    if (this.registrations.has(queue)) throw new Error(`Handler already registered for ${queue}`);
    this.registrations.set(queue, { handler: handler as JobHandler<object>, cron });
  }

  async start(): Promise<void> {
    if (this.started) return;
    await this.boss.start();
    this.started = true;
  }

  async startWorkers(options: { pollingIntervalSeconds?: number } = {}): Promise<void> {
    if (!this.started) throw new Error('Start the job runtime before its workers');
    if (this.workersStarted) return;
    this.workersStarted = true;
    for (const [queue, { handler, cron }] of this.registrations) {
      await this.boss.work<object>(
        queue,
        { batchSize: 1, pollingIntervalSeconds: options.pollingIntervalSeconds ?? 2 },
        async ([job]) => {
          if (!job) return;
          const ctx: JobContext = { jobId: job.id, queue, retryCount: job.retryCount };
          try {
            await handler(job.data, ctx);
          } catch (err) {
            this.logger.warn({ event: 'job_failed', queue, jobId: job.id, err });
            throw err; // pg-boss retries, then moves the job to the failed-jobs queue
          }
        },
      );
      if (cron) await this.boss.schedule(queue, cron, {}, { tz: 'UTC' });
    }
    this.logger.log({ event: 'workers_started', queues: [...this.registrations.keys()] });
  }

  enqueue<T extends object>(
    tx: DbTx,
    queue: QueueName,
    data: T,
    options: EnqueueOptions = {},
  ): Promise<string | null> {
    return this.boss.send(queue, data, { ...options, db: fromDrizzle(tx, sql) });
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.started) await this.boss.stop({ graceful: true, timeout: 20_000 });
  }
}
