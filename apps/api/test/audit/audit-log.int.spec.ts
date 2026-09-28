import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { FixedClock, UuidV7Generator } from '../../src/common';
import { PlatformDb } from '../../src/database/platform-db';
import { TenantDb } from '../../src/database/tenant-db';
import { AuditService } from '../../src/modules/audit';
import { PG, pgErrorCode } from '../support/pg-error';

const urls = inject('databaseUrls');
const A = randomUUID();
const B = randomUUID();
const actor = { type: 'user' as const, userId: randomUUID() };

let runtimePool: Pool;
let platformPool: Pool;
let tenantDb: TenantDb;
let platformDb: PlatformDb;
let audit: AuditService;
const clock = new FixedClock(new Date());

type AuditRow = { id: string; action: string; workspace_id: string | null };

beforeAll(() => {
  runtimePool = new Pool({ connectionString: urls.runtime, max: 2 });
  platformPool = new Pool({ connectionString: urls.platform, max: 2 });
  tenantDb = new TenantDb(runtimePool);
  platformDb = new PlatformDb(platformPool);
  audit = new AuditService(new UuidV7Generator(), clock);
});

afterAll(async () => {
  await Promise.all([runtimePool.end(), platformPool.end()]);
});

const byId = (id: string) => sql`select id, action, workspace_id from audit_log where id = ${id}`;

describe('audit log writes', () => {
  it('records a workspace event in the caller transaction and shows it only in that workspace', async () => {
    const id = await tenantDb.inWorkspace(A, (tx) =>
      audit.record(tx, {
        action: 'membership.paused',
        workspaceId: A,
        actor,
        entity: { type: 'membership', id: randomUUID() },
        newValue: { paused: true },
        reason: 'unpaid',
      }),
    );
    const inA = await tenantDb.inWorkspace(A, (tx) => tx.execute<AuditRow>(byId(id)));
    const inB = await tenantDb.inWorkspace(B, (tx) => tx.execute<AuditRow>(byId(id)));
    expect(inA.rows).toEqual([{ id, action: 'membership.paused', workspace_id: A }]);
    expect(inB.rows).toEqual([]);
  });

  it('rolls back with the change it describes', async () => {
    let id = '';
    await expect(
      tenantDb.inWorkspace(A, async (tx) => {
        id = await audit.record(tx, { action: 'grade.changed', workspaceId: A, actor });
        throw new Error('business rule failed');
      }),
    ).rejects.toThrow('business rule failed');
    const all = await platformDb.run('test', (tx) => tx.execute<AuditRow>(byId(id)));
    expect(all.rows).toEqual([]);
  });

  it('refuses an event for another workspace', async () => {
    const code = await pgErrorCode(
      tenantDb.inWorkspace(A, (tx) =>
        audit.record(tx, { action: 'grade.changed', workspaceId: B, actor }),
      ),
    );
    expect(code).toBe(PG.insufficientPrivilege);
  });

  it('lets the runtime role write platform-level events but not read them', async () => {
    const id = await tenantDb.transaction((tx) =>
      audit.record(tx, { action: 'auth.password_changed', workspaceId: null, actor }),
    );
    const asRuntime = await tenantDb.transaction((tx) => tx.execute<AuditRow>(byId(id)));
    expect(asRuntime.rows).toEqual([]);
    const asPlatform = await platformDb.run('test', (tx) => tx.execute<AuditRow>(byId(id)));
    expect(asPlatform.rows).toHaveLength(1);
  });

  it('validates the action format', async () => {
    await expect(
      tenantDb.inWorkspace(A, (tx) =>
        audit.record(tx, { action: 'Bad Action', workspaceId: A, actor }),
      ),
    ).rejects.toThrow('Invalid audit action');
  });
});

describe('audit log is append-only', () => {
  let id: string;

  beforeAll(async () => {
    id = await tenantDb.inWorkspace(A, (tx) =>
      audit.record(tx, {
        action: 'attendance.changed',
        workspaceId: A,
        actor,
        personalContext: { ip: '198.51.100.7' },
      }),
    );
  });

  it('refuses UPDATE and DELETE from the runtime role', async () => {
    const update = await pgErrorCode(
      tenantDb.inWorkspace(A, (tx) =>
        tx.execute(sql`update audit_log set action = 'x.y' where id = ${id}`),
      ),
    );
    const del = await pgErrorCode(
      tenantDb.inWorkspace(A, (tx) => tx.execute(sql`delete from audit_log where id = ${id}`)),
    );
    expect([update, del]).toEqual([PG.insufficientPrivilege, PG.insufficientPrivilege]);
  });

  it('refuses direct access to partitions, where parent policies would not apply', async () => {
    const month = new Date().toISOString().slice(0, 7).replace('-', '_');
    for (const partition of [`audit_log_${month}`, 'audit_log_default']) {
      const code = await pgErrorCode(runtimePool.query(`select * from ${partition}`));
      expect(code).toBe(PG.insufficientPrivilege);
    }
  });

  it('lets the platform role clear personal context only', async () => {
    await platformDb.run('test: anonymize', (tx) =>
      tx.execute(sql`update audit_log set personal_context = null where id = ${id}`),
    );
    const row = await platformDb.run('test', (tx) =>
      tx.execute<{ personal_context: unknown }>(
        sql`select personal_context from audit_log where id = ${id}`,
      ),
    );
    expect(row.rows[0]?.personal_context).toBeNull();
    const code = await pgErrorCode(
      platformDb.run('test', (tx) =>
        tx.execute(sql`update audit_log set action = 'x.y' where id = ${id}`),
      ),
    );
    expect(code).toBe(PG.insufficientPrivilege);
    const del = await pgErrorCode(
      platformDb.run('test', (tx) => tx.execute(sql`delete from audit_log where id = ${id}`)),
    );
    expect(del).toBe(PG.insufficientPrivilege);
  });
});

describe('monthly partitions', () => {
  it('stores current events in the month partition, not the default one', async () => {
    // Other test files write events at fixed clock dates, so check this test's own event only.
    const id = await tenantDb.inWorkspace(A, (tx) =>
      audit.record(tx, { action: 'grade.changed', workspaceId: A, actor }),
    );
    const client = new Client({ connectionString: urls.admin });
    await client.connect();
    try {
      const { rows } = await client.query<{ partition: string }>(
        `select tableoid::regclass::text as partition from audit_log where id = $1`,
        [id],
      );
      const month = clock.now().toISOString().slice(0, 7).replace('-', '_');
      expect(rows).toEqual([{ partition: `audit_log_${month}` }]);
    } finally {
      await client.end();
    }
  });

  it('creates future partitions idempotently, and only the platform role may do so', async () => {
    await platformPool.query('select app.ensure_audit_partitions(6)');
    await platformPool.query('select app.ensure_audit_partitions(6)');
    const { rows } = await platformPool.query<{ n: string }>(
      `select count(*) as n from pg_inherits where inhparent = 'audit_log'::regclass`,
    );
    expect(Number(rows[0]?.n)).toBe(8); // default + current month + 6 ahead
    const code = await pgErrorCode(runtimePool.query('select app.ensure_audit_partitions(1)'));
    expect(code).toBe(PG.insufficientPrivilege);
  });
});
