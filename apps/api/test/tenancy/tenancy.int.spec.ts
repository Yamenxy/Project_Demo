import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { FixedClock, UuidV7Generator } from '../../src/common';
import { PlatformDb } from '../../src/database/platform-db';
import { TenantDb } from '../../src/database/tenant-db';
import { AuditService } from '../../src/modules/audit';
import { memberships, MembershipsService, WorkspacesService } from '../../src/modules/tenancy';
import { adminQuery, insertMembership, insertUser, insertWorkspace } from '../support/fixtures';
import { PG, pgErrorCode } from '../support/pg-error';

const urls = inject('databaseUrls');
let runtimePool: Pool;
let platformPool: Pool;
let tenantDb: TenantDb;
let service: MembershipsService;
let workspacesService: WorkspacesService;

beforeAll(() => {
  runtimePool = new Pool({ connectionString: urls.runtime, max: 2 });
  platformPool = new Pool({ connectionString: urls.platform, max: 2 });
  tenantDb = new TenantDb(runtimePool);
  service = new MembershipsService(tenantDb);
  const ids = new UuidV7Generator();
  const clock = new FixedClock(new Date());
  workspacesService = new WorkspacesService(
    new PlatformDb(platformPool),
    new AuditService(ids, clock),
    ids,
    clock,
  );
});

afterAll(async () => {
  await Promise.all([runtimePool.end(), platformPool.end()]);
});

describe('creating a workspace', () => {
  it('creates the workspace, its owner membership and an audit event together', async () => {
    const owner = await insertUser();
    const workspaceId = await workspacesService.create(
      { slug: `teacher-${owner.slice(0, 6)}`, name: 'أ. محمد — فيزياء', ownerUserId: owner },
      randomUUID(),
    );
    const rows = await adminQuery<{ role: string; user_id: string }>(
      'select role, user_id from memberships where workspace_id = $1',
      [workspaceId],
    );
    expect(rows).toEqual([{ role: 'owner', user_id: owner }]);
    const audit = await adminQuery<{ action: string }>(
      'select action from audit_log where workspace_id = $1',
      [workspaceId],
    );
    expect(audit).toEqual([{ action: 'workspace.created' }]);
  });

  it('rejects a taken or malformed slug and an inactive owner', async () => {
    const owner = await insertUser();
    const slug = `dup-${owner.slice(0, 6)}`;
    await workspacesService.create({ slug, name: 'مساحة', ownerUserId: owner }, randomUUID());
    await expect(
      workspacesService.create({ slug, name: 'مساحة', ownerUserId: owner }, randomUUID()),
    ).rejects.toMatchObject({ code: 'slug_taken' });
    await expect(
      workspacesService.create({ slug: 'Bad Slug!', name: 'x', ownerUserId: owner }, randomUUID()),
    ).rejects.toMatchObject({ code: 'invalid_slug' });
    const pending = await insertUser('pending');
    await expect(
      workspacesService.create(
        { slug: `p-${pending.slice(0, 6)}`, name: 'مساحة', ownerUserId: pending },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'owner_not_active' });
  });

  it('is not possible with the runtime role', async () => {
    const owner = await insertUser();
    const code = await pgErrorCode(
      runtimePool.query(
        `insert into workspaces (id, slug, name, owner_user_id, created_at, updated_at)
         values ($1, 'sneaky-ws', 'x y', $2, now(), now())`,
        [randomUUID(), owner],
      ),
    );
    expect(code).toBe(PG.insufficientPrivilege);
    const selfPromotion = await pgErrorCode(
      runtimePool.query('insert into platform_owners (user_id, created_at) values ($1, now())', [
        owner,
      ]),
    );
    expect(selfPromotion).toBe(PG.insufficientPrivilege);
  });
});

describe('membership constraints', () => {
  it('allows one role per user per workspace (never staff and student together)', async () => {
    const owner = await insertUser();
    const ws = await insertWorkspace(owner);
    const helper = await insertUser();
    await insertMembership(ws, helper, 'assistant');
    const code = await pgErrorCode(insertMembership(ws, helper, 'student'));
    expect(code).toBe(PG.uniqueViolation);
  });

  it('allows one owner per workspace', async () => {
    const ws = await insertWorkspace(await insertUser());
    const code = await pgErrorCode(insertMembership(ws, await insertUser(), 'owner'));
    expect(code).toBe(PG.uniqueViolation);
  });

  it('requires a managed record to be a student with a provisional name and phone', async () => {
    const ws = await insertWorkspace(await insertUser());
    await insertMembership(ws, null, 'student', {
      provisional_name: 'طالب مُدار',
      provisional_phone: '+201012345678',
    });
    const noPhone = await pgErrorCode(
      insertMembership(ws, null, 'student', { provisional_name: 'طالب مُدار' }),
    );
    const notStudent = await pgErrorCode(
      insertMembership(ws, null, 'assistant', {
        provisional_name: 'مساعد',
        provisional_phone: '+201012345679',
      }),
    );
    expect([noPhone, notStudent]).toEqual(['23514', '23514']); // check_violation
  });

  it('pauses students only, and always records who paused', async () => {
    const owner = await insertUser();
    const ws = await insertWorkspace(owner);
    await insertMembership(ws, await insertUser(), 'student', {
      paused_at: new Date(),
      paused_by: owner,
    });
    const helper = await pgErrorCode(
      insertMembership(ws, await insertUser(), 'assistant', {
        paused_at: new Date(),
        paused_by: owner,
      }),
    );
    const anonymous = await pgErrorCode(
      insertMembership(ws, await insertUser(), 'student', { paused_at: new Date() }),
    );
    expect([helper, anonymous]).toEqual(['23514', '23514']);
  });

  it('keeps internal codes unique within a workspace only', async () => {
    const a = await insertWorkspace(await insertUser());
    const b = await insertWorkspace(await insertUser());
    await insertMembership(a, await insertUser(), 'student', { internal_code: 'S-001' });
    await insertMembership(b, await insertUser(), 'student', { internal_code: 'S-001' });
    const code = await pgErrorCode(
      insertMembership(a, await insertUser(), 'student', { internal_code: 'S-001' }),
    );
    expect(code).toBe(PG.uniqueViolation);
  });

  it('rejects an invitation linked to a membership of another workspace', async () => {
    const owner = await insertUser();
    const a = await insertWorkspace(owner);
    const b = await insertWorkspace(await insertUser());
    const managedInB = await insertMembership(b, null, 'student', {
      provisional_name: 'طالب مُدار',
      provisional_phone: '+201012345670',
    });
    const code = await pgErrorCode(
      adminQuery(
        `insert into workspace_invitations
           (workspace_id, id, phone_e164, role, token_hash, invited_by, membership_id,
            created_at, expires_at)
         values ($1, $2, '+201012345670', 'student', $3, $4, $5, now(), now() + interval '7 days')`,
        [a, randomUUID(), randomUUID(), owner, managedInB],
      ),
    );
    expect(code).toBe(PG.foreignKeyViolation);
  });
});

describe('membership visibility', () => {
  it('shows a workspace only its own memberships, and a user only their own elsewhere', async () => {
    const userA = await insertUser();
    const userB = await insertUser();
    const wsA = await insertWorkspace(userA);
    const wsB = await insertWorkspace(userB);
    const student = await insertUser();
    await insertMembership(wsA, student, 'student');
    await insertMembership(wsB, student, 'student');

    const inA = await tenantDb.inWorkspace(wsA, (tx) =>
      tx.select({ userId: memberships.userId }).from(memberships),
    );
    expect(inA.map((r) => r.userId).sort()).toEqual([userA, student].sort());

    const mine = await tenantDb.forUser(student, (tx) =>
      tx.select({ workspaceId: memberships.workspaceId }).from(memberships),
    );
    expect(mine.map((r) => r.workspaceId).sort()).toEqual([wsA, wsB].sort());

    const unscoped = await tenantDb.transaction((tx) => tx.select().from(memberships));
    expect(unscoped).toEqual([]);

    // forUser grants reading only: it can't change the user's own membership rows.
    const updated = await tenantDb.forUser(student, (tx) =>
      tx
        .update(memberships)
        .set({ role: 'owner' })
        .where(eq(memberships.userId, student))
        .returning(),
    );
    expect(updated).toEqual([]);
  });

  it('lists my workspaces and resolves my membership in one', async () => {
    const owner = await insertUser();
    const ws = await insertWorkspace(owner);
    const helper = await insertUser();
    await insertMembership(ws, helper, 'assistant');

    const list = await service.listForUser(helper);
    expect(list).toEqual([
      expect.objectContaining({ workspaceId: ws, role: 'assistant', status: 'active' }),
    ]);

    const context = await tenantDb.inWorkspace(ws, (tx) => service.resolve(tx, ws, helper));
    expect(context).toMatchObject({ role: 'assistant', paused: false, workspaceSuspended: false });
    const outsider = await tenantDb.inWorkspace(ws, (tx) => service.resolve(tx, ws, randomUUID()));
    expect(outsider).toBeNull();
  });

  it('knows platform owners', async () => {
    const user = await insertUser();
    expect(await service.isPlatformOwner(user)).toBe(false);
    await adminQuery('insert into platform_owners (user_id, created_at) values ($1, now())', [
      user,
    ]);
    expect(await service.isPlatformOwner(user)).toBe(true);
    const count = await tenantDb.transaction((tx) =>
      tx.execute<{ n: string }>(sql`select count(*) as n from platform_owners`),
    );
    expect(Number(count.rows[0]?.n)).toBeGreaterThan(0);
  });
});
