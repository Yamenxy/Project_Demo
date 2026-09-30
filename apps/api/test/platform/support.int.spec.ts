import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Clock, FixedClock } from '../../src/common';
import { adminQuery, insertMembership, insertUser, insertWorkspace } from '../support/fixtures';
import { createIntegrationApp } from '../support/integration-app';
import { signIn } from '../support/sessions';

const clock = new FixedClock('2026-10-05T10:00:00Z');
let app: NestFastifyApplication;

type ErrorJson = { error: { code: string } };

function call(method: 'GET' | 'POST', url: string, token: string, payload?: object) {
  return app.inject({
    method,
    url,
    cookies: { lms_session: token },
    ...(payload ? { payload } : {}),
  });
}

async function platformOwner(): Promise<{ userId: string; token: string }> {
  const userId = await insertUser();
  await adminQuery('insert into platform_owners (user_id, created_at) values ($1, now())', [
    userId,
  ]);
  return { userId, token: await signIn(app, userId, { twoFactor: true }) };
}

async function setup() {
  const owner = await insertUser();
  const workspaceId = await insertWorkspace(owner);
  await insertMembership(workspaceId, await insertUser(), 'student');
  const support = await platformOwner();
  const colleague = await platformOwner();
  return { owner, workspaceId, w: `/api/v1/w/${workspaceId}`, support, colleague };
}

beforeAll(async () => {
  app = await createIntegrationApp((builder) => builder.overrideProvider(Clock).useValue(clock));
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  clock.set('2026-10-05T10:00:00Z');
});

describe('support sessions (REQ-RBAC-003)', () => {
  it('without a session, a platform owner gets 404 for workspace data', async () => {
    const s = await setup();
    expect((await call('GET', `${s.w}/students`, s.support.token)).statusCode).toBe(404);
  });

  it('opens read-only access, tells the owner and the other platform owners, and audits every view', async () => {
    const s = await setup();
    const started = await call(
      'POST',
      `/api/v1/platform/workspaces/${s.workspaceId}/support-sessions`,
      s.support.token,
      { reason: 'المعلم لا يرى درجات فصل السبت', ticket: 'T-1042', minutes: 30 },
    );
    expect(started.statusCode).toBe(201);
    const session = started.json<{ id: string; active: boolean; expiresAt: string }>();
    expect(session).toMatchObject({ active: true, expiresAt: '2026-10-05T10:30:00.000Z' });
    const notes = await adminQuery<{ recipient_user_id: string; type: string }>(
      `select recipient_user_id, type from notifications where type like 'support.%'
          and recipient_user_id in ($1, $2, $3)`,
      [s.owner, s.colleague.userId, s.support.userId],
    );
    expect(notes.map((n) => [n.recipient_user_id, n.type]).sort()).toEqual(
      [
        [s.owner, 'support.session_started'],
        [s.colleague.userId, 'support.session_started_platform'],
      ].sort(),
    );

    // Reads work, with an owner's view.
    const students = await call('GET', `${s.w}/students`, s.support.token);
    expect(students.statusCode).toBe(200);
    // Writes, exports and student-only pages don't.
    const write = await call('POST', `${s.w}/classes`, s.support.token, { name: 'فصل الدعم' });
    expect(write.statusCode).toBe(403);
    expect(write.json<ErrorJson>().error.code).toBe('support_read_only');
    const exported = await call(
      'GET',
      `${s.w}/exports/payments.csv?from=2026-10-01&to=2026-10-05`,
      s.support.token,
    );
    expect(exported.json<ErrorJson>().error.code).toBe('support_no_export');
    expect((await call('GET', `${s.w}/my/lessons`, s.support.token)).statusCode).toBe(403);

    // The owner sees the session and what it viewed.
    const ownerToken = await signIn(app, s.owner, { twoFactor: true });
    const log = (await call('GET', `${s.w}/audit-log?area=support`, ownerToken)).json<{
      entries: { action: string; actorType: string }[];
    }>();
    const actions = log.entries.map((e) => e.action);
    expect(actions).toContain('support.session_started');
    expect(actions.filter((a) => a === 'support.viewed')).toHaveLength(1);
    const [viewed] = await adminQuery<{ route: string }>(
      `select new_value->>'route' as route from audit_log
        where workspace_id = $1 and action = 'support.viewed'`,
      [s.workspaceId],
    );
    expect(viewed?.route).toBe('/api/v1/w/:workspaceId/students');
  });

  it('ends at the time limit, or when closed', async () => {
    const s = await setup();
    const url = `/api/v1/platform/workspaces/${s.workspaceId}/support-sessions`;
    const tooLong = await call('POST', url, s.support.token, {
      reason: 'فحص طويل',
      ticket: 'T-1',
      minutes: 61,
    });
    expect(tooLong.statusCode).toBe(400);
    await call('POST', url, s.support.token, { reason: 'فحص المشكلة', ticket: 'T-2', minutes: 10 });
    expect((await call('GET', `${s.w}/students`, s.support.token)).statusCode).toBe(200);
    clock.set('2026-10-05T10:11:00Z');
    let token = await signIn(app, s.support.userId, { twoFactor: true });
    expect((await call('GET', `${s.w}/students`, token)).statusCode).toBe(404);

    const again = (
      await call('POST', url, token, { reason: 'فحص المشكلة مرة أخرى', ticket: 'T-2', minutes: 10 })
    ).json<{ id: string }>();
    expect((await call('GET', `${s.w}/students`, token)).statusCode).toBe(200);
    expect(
      (await call('POST', `/api/v1/platform/support-sessions/${again.id}/end`, token)).statusCode,
    ).toBe(204);
    token = await signIn(app, s.support.userId, { twoFactor: true });
    expect((await call('GET', `${s.w}/students`, token)).statusCode).toBe(404);
  });

  it('only platform owners open sessions', async () => {
    const s = await setup();
    const ownerToken = await signIn(app, s.owner, { twoFactor: true });
    const res = await call(
      'POST',
      `/api/v1/platform/workspaces/${s.workspaceId}/support-sessions`,
      ownerToken,
      { reason: 'أريد أن أرى', ticket: 'T-9' },
    );
    expect(res.statusCode).toBe(403);
  });
});
