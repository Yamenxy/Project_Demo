import type { PgBoss } from 'pg-boss';

/** Queue settings as accepted by pg-boss createQueue (retry policy, retention, dead letter). */
export type QueueSettings = NonNullable<Parameters<PgBoss['createQueue']>[1]>;

/** Receives the payload of every job that exhausts its retries, for inspection and redrive. */
export const FAILED_JOBS_QUEUE = 'system.failed_jobs';

/**
 * Every queue, with its retry policy. Queues are created during the migration step, so a new
 * queue is added here, not at runtime (review §3.27: retries with backoff, a failed state).
 */
export const QUEUES = {
  [FAILED_JOBS_QUEUE]: {
    retryLimit: 0,
    // Failed payloads stay visible to platform owners for 30 days.
    retentionSeconds: 30 * 24 * 3600,
    deleteAfterSeconds: 30 * 24 * 3600,
  },
  'billing.subscription_check': {
    retryLimit: 3,
    retryDelay: 60,
    retryBackoff: true,
    deadLetter: FAILED_JOBS_QUEUE,
  },
  'notify.email': {
    retryLimit: 5,
    retryDelay: 30,
    retryBackoff: true,
    deadLetter: FAILED_JOBS_QUEUE,
  },
  'video.transcode': {
    retryLimit: 2,
    retryDelay: 60,
    retryBackoff: true,
    deadLetter: FAILED_JOBS_QUEUE,
  },
  'files.scan': {
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
    deadLetter: FAILED_JOBS_QUEUE,
  },
  'maintenance.idempotency_purge': {
    retryLimit: 3,
    retryDelay: 60,
    retryBackoff: true,
    deadLetter: FAILED_JOBS_QUEUE,
  },
  'maintenance.rate_limit_purge': {
    retryLimit: 3,
    retryDelay: 60,
    retryBackoff: true,
    deadLetter: FAILED_JOBS_QUEUE,
  },
  'maintenance.audit_partitions': {
    retryLimit: 5,
    retryDelay: 60,
    retryBackoff: true,
    deadLetter: FAILED_JOBS_QUEUE,
  },
} satisfies Record<string, QueueSettings>;

export type QueueName = keyof typeof QUEUES;
