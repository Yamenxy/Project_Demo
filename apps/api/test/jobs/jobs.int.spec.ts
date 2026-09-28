import { randomUUID } from 'node:crypto';
import { PgBoss } from 'pg-boss';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { PlatformDb } from '../../src/database/platform-db';
import { TenantDb } from '../../src/database/tenant-db';
import { FAILED_JOBS_QUEUE, JobsRuntime, type JobContext, type QueueName } from '../../src/jobs';
import { bossOptions } from '../../src/jobs/boss';
import { MaintenanceJobs } from '../../src/jobs/maintenance';
import { waitFor } from '../support/wait-for';

const urls = inject('databaseUrls');

// Fixture queues, created by the migrator like real queues are.
const ECHO = 'test.echo' as QueueName;
const FLAKY = 'test.flaky' as QueueName;
const UNUSED = 'test.unused' as QueueName;

let runtimePool: Pool;
let platformPool: Pool;
let tenantDb: TenantDb;
let jobs: JobsRuntime;
const handled: { data: object; ctx: JobContext }[] = [];
let flakyAttempts = 0;

async function adminQuery<T extends object>(text: string, values: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: urls.admin });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  const admin = new PgBoss({ ...bossOptions(urls.admin), supervise: false, schedule: false });
  await admin.start();
  await admin.createQueue(ECHO, { retryLimit: 0 });
  await admin.createQueue(UNUSED, { retryLimit: 0 });
  await admin.createQueue(FLAKY, { retryLimit: 1, retryDelay: 0, deadLetter: FAILED_JOBS_QUEUE });
  await admin.stop({ graceful: false, close: true });

  runtimePool = new Pool({ connectionString: urls.runtime, max: 2 });
  platformPool = new Pool({ connectionString: urls.platform, max: 1 });
  tenantDb = new TenantDb(runtimePool);
  jobs = new JobsRuntime({ databaseUrl: urls.runtime });
  jobs.register(ECHO, (data, ctx) => {
    handled.push({ data, ctx });
    return Promise.resolve();
  });
  jobs.register(FLAKY, () => {
    flakyAttempts += 1;
    return Promise.reject(new Error('always fails'));
  });
  new MaintenanceJobs(jobs, new PlatformDb(platformPool)).onModuleInit();
  await jobs.start();
  await jobs.startWorkers({ pollingIntervalSeconds: 0.5 });
});

afterAll(async () => {
  await jobs.onApplicationShutdown();
  await Promise.all([runtimePool.end(), platformPool.end()]);
});

describe('transactional enqueue', () => {
  it('creates the job only when the business transaction commits', async () => {
    const committed = randomUUID();
    const rolledBack = randomUUID();
    await tenantDb.transaction((tx) => jobs.enqueue(tx, UNUSED, { ref: committed }));
    await expect(
      tenantDb.transaction(async (tx) => {
        await jobs.enqueue(tx, UNUSED, { ref: rolledBack });
        throw new Error('business rule failed');
      }),
    ).rejects.toThrow('business rule failed');

    const rows = await adminQuery<{ ref: string }>(
      `select data->>'ref' as ref from pgboss.job where name = $1`,
      [UNUSED],
    );
    expect(rows.map((r) => r.ref)).toEqual([committed]);
  });

  it('ignores a second enqueue with the same job id', async () => {
    const id = randomUUID();
    const first = await tenantDb.transaction((tx) => jobs.enqueue(tx, UNUSED, {}, { id }));
    const second = await tenantDb.transaction((tx) => jobs.enqueue(tx, UNUSED, {}, { id }));
    expect(first).toBe(id);
    expect(second).toBeNull();
  });
});

describe('workers', () => {
  it('run the registered handler with the payload and job context', async () => {
    const ref = randomUUID();
    const jobId = await tenantDb.transaction((tx) => jobs.enqueue(tx, ECHO, { ref }));
    await waitFor(() => handled.some((h) => (h.data as { ref?: string }).ref === ref));
    const run = handled.find((h) => (h.data as { ref?: string }).ref === ref);
    expect(run?.ctx).toEqual({ jobId, queue: ECHO, retryCount: 0 });
  });

  it('retry a failing job, then move it to the failed-jobs queue', async () => {
    const ref = randomUUID();
    await tenantDb.transaction((tx) => jobs.enqueue(tx, FLAKY, { ref }));
    await waitFor(
      async () =>
        (
          await adminQuery(`select 1 from pgboss.job where name = $1 and data->>'ref' = $2`, [
            FAILED_JOBS_QUEUE,
            ref,
          ])
        ).length > 0,
      30_000,
    );
    expect(flakyAttempts).toBe(2); // first attempt + one retry
  });
});

describe('maintenance', () => {
  it('recreates missing audit partitions', async () => {
    const next = new Date();
    next.setUTCMonth(next.getUTCMonth() + 2, 1);
    const name = `audit_log_${next.toISOString().slice(0, 7).replace('-', '_')}`;
    await adminQuery(`drop table if exists ${name}`);
    await new MaintenanceJobs(jobs, new PlatformDb(platformPool)).ensureAuditPartitions();
    const rows = await adminQuery(`select to_regclass($1) as t`, [name]);
    expect(rows[0]).toEqual({ t: name });
  });
});
