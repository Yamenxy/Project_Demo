import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Clock, FixedClock } from '../../src/common';
import { PlatformService } from '../../src/modules/platform-admin';
import { adminQuery, insertUser } from '../support/fixtures';
import { createIntegrationApp } from '../support/integration-app';
import { signIn } from '../support/sessions';

const DAY = 24 * 3600 * 1000;
const clock = new FixedClock('2026-10-01T08:00:00Z');
let app: NestFastifyApplication;
let ownerToken: string;
let platformOwner: string;

type ErrorJson = { error: { code: string } };

function call(method: 'GET' | 'POST', url: string, token: string, payload?: object) {
  return app.inject({
    method,
    url,
    cookies: { lms_session: token },
    ...(payload ? { payload } : {}),
  });
}

async function phoneOf(userId: string): Promise<string> {
  const [row] = await adminQuery<{ phone: string }>(
    'select phone_e164 as phone from users where id = $1',
    [userId],
  );
  return `0${(row?.phone ?? '').slice(3)}`;
}

async function newTeacherWorkspace() {
  const teacher = await insertUser();
  const res = await call('POST', '/api/v1/platform/workspaces', ownerToken, {
    slug: `t-${teacher.slice(0, 8)}`,
    name: 'أ. تجريبي — رياضيات',
    ownerPhone: await phoneOf(teacher),
  });
  expect(res.statusCode).toBe(201);
  const workspaceId = res.json<{ id: string }>().id;
  const teacherToken = await signIn(app, teacher, { twoFactor: true });
  return { teacher, workspaceId, teacherToken };
}

beforeAll(async () => {
  app = await createIntegrationApp((b) => b.overrideProvider(Clock).useValue(clock));
  platformOwner = await insertUser();
  await adminQuery('insert into platform_owners (user_id, created_at) values ($1, now())', [
    platformOwner,
  ]);
  ownerToken = await signIn(app, platformOwner, { twoFactor: true });
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  clock.set('2026-10-01T08:00:00Z');
});

describe('access', () => {
  it('is for platform owners with 2FA only', async () => {
    const someone = await signIn(app, await insertUser(), { twoFactor: true });
    expect((await call('GET', '/api/v1/platform/workspaces', someone)).statusCode).toBe(403);
  });
});

describe('setting up a teacher', () => {
  it('creates the workspace with its owner and a 14-day trial', async () => {
    const { workspaceId } = await newTeacherWorkspace();
    const detail = await call('GET', `/api/v1/platform/workspaces/${workspaceId}`, ownerToken);
    expect(detail.json()).toMatchObject({
      status: 'trial',
      plan: 'starter',
      suspension: null,
      members: { owner: 1 },
      payments: [],
    });
    const ends = new Date(detail.json<{ periodEndsAt: string }>().periodEndsAt);
    expect(ends.getTime() - clock.now().getTime()).toBe(14 * DAY);
  });

  it('needs an existing account with a verified phone', async () => {
    const res = await call('POST', '/api/v1/platform/workspaces', ownerToken, {
      slug: 'nobody-here',
      name: 'لا أحد',
      ownerPhone: '01099999999',
    });
    expect(res.json<ErrorJson>().error.code).toBe('teacher_not_found');
  });
});

describe('payments and suspension', () => {
  it('records a payment, extends the period and tells the teacher', async () => {
    const { workspaceId, teacher, teacherToken } = await newTeacherWorkspace();
    const res = await call(
      'POST',
      `/api/v1/platform/workspaces/${workspaceId}/payments`,
      ownerToken,
      {
        amount: 1500,
        method: 'instapay',
        reference: 'IP-778812',
        paidOn: '2026-10-01',
        months: 1,
        plan: 'growth',
      },
    );
    expect(res.statusCode).toBe(201);
    // Trial ended 2026-10-15; paying early extends from there.
    expect(res.json<{ periodEndsAt: string }>().periodEndsAt).toBe('2026-11-15T08:00:00.000Z');

    const billing = await call('GET', `/api/v1/w/${workspaceId}/billing`, teacherToken);
    expect(billing.json()).toMatchObject({
      plan: 'growth',
      status: 'active',
      payments: [{ amountPiastres: 150000, method: 'instapay', months: 1 }],
    });
    const notes = await adminQuery<{ type: string }>(
      'select type from notifications where recipient_user_id = $1',
      [teacher],
    );
    expect(notes.map((n) => n.type)).toContain('billing.payment_recorded');
    const audit = await adminQuery<{ action: string }>(
      `select action from audit_log where workspace_id = $1 order by occurred_at, id`,
      [workspaceId],
    );
    expect(audit.map((a) => a.action)).toEqual([
      'workspace.created',
      'subscription.payment_recorded',
    ]);
  });

  it('suspends a lapsed workspace after the grace period, and payment brings it back', async () => {
    const { workspaceId, teacher } = await newTeacherWorkspace();
    const platform = app.get(PlatformService);

    clock.set(new Date(clock.now().getTime() + 20 * DAY)); // trial over, still in grace
    await platform.checkSubscriptions(workspaceId);
    // Sessions expire as time passes; sign in again at the new time.
    let teacherToken = await signIn(app, teacher, { twoFactor: true });
    expect(
      (await call('GET', `/api/v1/w/${workspaceId}/context`, teacherToken)).json(),
    ).toMatchObject({
      workspace: { suspended: false },
    });

    clock.set(new Date(clock.now().getTime() + 2 * DAY)); // grace over
    await platform.checkSubscriptions(workspaceId);
    teacherToken = await signIn(app, teacher, { twoFactor: true });
    const context = await call('GET', `/api/v1/w/${workspaceId}/context`, teacherToken);
    expect(context.json()).toMatchObject({ workspace: { suspended: true } });
    // A suspended owner can still see billing, to renew (D12a).
    const billing = await call('GET', `/api/v1/w/${workspaceId}/billing`, teacherToken);
    expect(billing.json()).toMatchObject({ status: 'lapsed' });

    const freshOwner = await signIn(app, platformOwner, { twoFactor: true });
    const paid = await call(
      'POST',
      `/api/v1/platform/workspaces/${workspaceId}/payments`,
      freshOwner,
      {
        amount: 1500,
        method: 'cash',
        paidOn: '2026-10-23',
        months: 1,
      },
    );
    expect(paid.statusCode).toBe(201);
    expect(
      (await call('GET', `/api/v1/w/${workspaceId}/context`, teacherToken)).json(),
    ).toMatchObject({
      workspace: { suspended: false },
    });
  });

  it('keeps an admin suspension through payments until restored', async () => {
    const { workspaceId, teacherToken } = await newTeacherWorkspace();
    const suspended = await call(
      'POST',
      `/api/v1/platform/workspaces/${workspaceId}/suspend`,
      ownerToken,
      {
        note: 'شكوى قيد المراجعة',
      },
    );
    expect(suspended.statusCode).toBe(204);
    await call('POST', `/api/v1/platform/workspaces/${workspaceId}/payments`, ownerToken, {
      amount: 1500,
      method: 'cash',
      paidOn: '2026-10-01',
      months: 1,
    });
    expect(
      (await call('GET', `/api/v1/w/${workspaceId}/context`, teacherToken)).json(),
    ).toMatchObject({
      workspace: { suspended: true },
    });
    await call('POST', `/api/v1/platform/workspaces/${workspaceId}/restore`, ownerToken, {
      note: 'تمت المراجعة',
    });
    expect(
      (await call('GET', `/api/v1/w/${workspaceId}/context`, teacherToken)).json(),
    ).toMatchObject({
      workspace: { suspended: false },
    });
  });

  it('sends each reminder once per period', async () => {
    const { workspaceId, teacher } = await newTeacherWorkspace();
    const platform = app.get(PlatformService);
    clock.set(new Date(clock.now().getTime() + 12 * DAY)); // 2 days before the trial ends
    await platform.checkSubscriptions(workspaceId);
    await platform.checkSubscriptions(workspaceId);
    clock.set(new Date(clock.now().getTime() + 2 * DAY)); // the day it ends
    await platform.checkSubscriptions(workspaceId);
    const notes = await adminQuery<{ type: string }>(
      `select type from notifications where recipient_user_id = $1 and type like 'billing.reminder%'
        order by created_at`,
      [teacher],
    );
    expect(notes.map((n) => n.type)).toEqual([
      'billing.reminder_before_end',
      'billing.reminder_on_end',
    ]);
  });
});
