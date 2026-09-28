import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { PlatformDb } from '../../src/database/platform-db';
import { assertApplicationRole } from '../../src/database/role-check';
import { TenantDb } from '../../src/database/tenant-db';
import { PG, pgErrorCode } from '../support/pg-error';

/**
 * Proves the tenancy mechanism of docs/architecture.md §4 (REQ-DATA-001) on fixture tables that
 * follow the same conventions as real tenant tables: workspace_id, composite foreign keys and
 * app.enable_tenant_rls().
 */
const urls = inject('databaseUrls');
const A = randomUUID();
const B = randomUUID();

let runtimePool: Pool;
let platformPool: Pool;
let tenantDb: TenantDb;
let platformDb: PlatformDb;

async function asAdmin(statements: string[]): Promise<void> {
  const client = new Client({ connectionString: urls.admin });
  await client.connect();
  try {
    for (const statement of statements) await client.query(statement);
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  await asAdmin([
    `create table fixture_parent (
       workspace_id uuid not null,
       id uuid primary key default gen_random_uuid(),
       name text not null,
       unique (workspace_id, id))`,
    `create table fixture_child (
       workspace_id uuid not null,
       id uuid primary key default gen_random_uuid(),
       parent_id uuid not null,
       foreign key (workspace_id, parent_id) references fixture_parent (workspace_id, id))`,
    `select app.enable_tenant_rls('fixture_parent')`,
    `select app.enable_tenant_rls('fixture_child')`,
    `insert into fixture_parent (workspace_id, name) values
       ('${A}', 'a1'), ('${A}', 'a2'), ('${B}', 'b1')`,
  ]);
  runtimePool = new Pool({ connectionString: urls.runtime, max: 2 });
  platformPool = new Pool({ connectionString: urls.platform, max: 2 });
  tenantDb = new TenantDb(runtimePool);
  platformDb = new PlatformDb(platformPool);
});

afterAll(async () => {
  await Promise.all([runtimePool.end(), platformPool.end()]);
});

type Row = { workspace_id: string; name: string };

const selectParents = sql`select workspace_id, name from fixture_parent order by name`;

describe('row-level security for the runtime role', () => {
  it('shows no tenant rows in an unscoped transaction (fails closed)', async () => {
    const result = await tenantDb.transaction((tx) => tx.execute<Row>(selectParents));
    expect(result.rows).toEqual([]);
  });

  it('refuses tenant writes in an unscoped transaction', async () => {
    const code = await pgErrorCode(
      tenantDb.transaction((tx) =>
        tx.execute(sql`insert into fixture_parent (workspace_id, name) values (${A}, 'x')`),
      ),
    );
    expect(code).toBe(PG.insufficientPrivilege);
  });

  it('shows only the scoped workspace rows', async () => {
    const a = await tenantDb.inWorkspace(A, (tx) => tx.execute<Row>(selectParents));
    const b = await tenantDb.inWorkspace(B, (tx) => tx.execute<Row>(selectParents));
    expect(a.rows.map((r) => r.name)).toEqual(['a1', 'a2']);
    expect(b.rows.map((r) => r.name)).toEqual(['b1']);
  });

  it('refuses writing a row for another workspace while scoped', async () => {
    const code = await pgErrorCode(
      tenantDb.inWorkspace(A, (tx) =>
        tx.execute(sql`insert into fixture_parent (workspace_id, name) values (${B}, 'intruder')`),
      ),
    );
    expect(code).toBe(PG.insufficientPrivilege);
  });

  it('cannot see or update another workspace rows even by id', async () => {
    const updated = await tenantDb.inWorkspace(A, (tx) =>
      tx.execute(sql`update fixture_parent set name = 'hacked' where name = 'b1'`),
    );
    expect(updated.rowCount).toBe(0);
  });

  it('rejects a non-UUID workspace id before touching the database', async () => {
    await expect(tenantDb.inWorkspace("x' or '1'='1", () => Promise.resolve(1))).rejects.toThrow(
      'workspaceId must be a UUID',
    );
  });
});

describe('composite foreign keys', () => {
  it('reject a reference to a row in another workspace, even without RLS', async () => {
    // The platform role bypasses tenant policies, so only the foreign key can stop this.
    const parentInA = await platformDb.run('test: composite FK', (tx) =>
      tx.execute<{ id: string }>(sql`select id from fixture_parent where name = 'a1'`),
    );
    const parentId = parentInA.rows[0]?.id;
    expect(parentId).toBeDefined();
    const code = await pgErrorCode(
      platformDb.run('test: composite FK', (tx) =>
        tx.execute(
          sql`insert into fixture_child (workspace_id, parent_id) values (${B}, ${parentId})`,
        ),
      ),
    );
    expect(code).toBe(PG.foreignKeyViolation);
  });
});

describe('pooled connections', () => {
  it('does not leak the workspace setting to the next transaction on the same connection', async () => {
    const singlePool = new Pool({ connectionString: urls.runtime, max: 1 });
    const db = new TenantDb(singlePool);
    try {
      await db.inWorkspace(A, (tx) => tx.execute(selectParents));
      const after = await db.transaction((tx) =>
        tx.execute<{ ws: string | null }>(
          sql`select nullif(current_setting('app.workspace_id', true), '') as ws`,
        ),
      );
      expect(after.rows[0]?.ws).toBeNull();
      const rows = await db.transaction((tx) => tx.execute<Row>(selectParents));
      expect(rows.rows).toEqual([]);
    } finally {
      await singlePool.end();
    }
  });

  it('keeps interleaved concurrent transactions for two workspaces isolated', async () => {
    const runs = Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? A : B));
    const results = await Promise.all(
      runs.map((ws) =>
        tenantDb.inWorkspace(ws, async (tx) => {
          const res = await tx.execute<Row>(selectParents);
          return { ws, seen: res.rows.map((r) => r.workspace_id) };
        }),
      ),
    );
    for (const { ws, seen } of results) {
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((id) => id === ws)).toBe(true);
    }
  });
});

describe('platform handle', () => {
  it('sees every workspace and requires a reason', async () => {
    const all = await platformDb.run('test: platform read', (tx) => tx.execute<Row>(selectParents));
    expect(all.rows.map((r) => r.name)).toEqual(['a1', 'a2', 'b1']);
    await expect(platformDb.run('  ', () => Promise.resolve(1))).rejects.toThrow(/reason/);
  });
});

describe('runtime role privileges', () => {
  it('cannot change schema or disable row-level security', async () => {
    await expect(runtimePool.query('create table sneaky (id int)')).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      runtimePool.query('alter table fixture_parent disable row level security'),
    ).rejects.toThrow(/must be owner/);
  });
});

describe('startup role check', () => {
  it('accepts the configured roles', async () => {
    await expect(assertApplicationRole(runtimePool, 'app_runtime')).resolves.toBeUndefined();
    await expect(assertApplicationRole(platformPool, 'app_platform')).resolves.toBeUndefined();
  });

  it('rejects a superuser or a user in the wrong group', async () => {
    const adminPool = new Pool({ connectionString: urls.admin, max: 1 });
    try {
      await expect(assertApplicationRole(adminPool, 'app_runtime')).rejects.toThrow(/superuser/);
      await expect(assertApplicationRole(runtimePool, 'app_platform')).rejects.toThrow(
        /not a member of app_platform/,
      );
    } finally {
      await adminPool.end();
    }
  });
});
