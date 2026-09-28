import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Clock, FixedClock } from '../../src/common';
import { TenantDb } from '../../src/database';
import { DevicesService } from '../../src/modules/identity';
import { adminQuery, insertMembership, insertWorkspace } from '../support/fixtures';
import {
  cookieValue,
  createIntegrationApp,
  randomIp,
  randomPhone,
} from '../support/integration-app';

const PASSWORD = 'نجمة-الصباح-2026';
const DAY = 24 * 3600 * 1000;
const clock = new FixedClock('2026-10-01T08:00:00Z');
let app: NestFastifyApplication;

type ErrorJson = { error: { code: string; details?: Record<string, unknown> } };
type DevicesJson = { devices: { id: string; current: boolean; label: string | null }[] };

const cookie = (res: { headers: Record<string, unknown> }, name: string) =>
  cookieValue(res.headers['set-cookie'] as string[] | undefined, name);

async function register(phone = randomPhone()) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { nameAr: 'طالب تجريبي', phone, password: PASSWORD },
    remoteAddress: randomIp(),
    headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 13) Chrome/126.0 Mobile Safari/537.36' },
  });
  expect(res.statusCode).toBe(201);
  const [row] = await adminQuery<{ id: string }>('select id from users where phone_e164 = $1', [
    `+20${phone.slice(1)}`,
  ]);
  return {
    phone,
    userId: row?.id ?? '',
    session: cookie(res, 'lms_session') ?? '',
    device: cookie(res, 'lms_device') ?? '',
  };
}

function login(phone: string, device?: string) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { identifier: phone, password: PASSWORD },
    remoteAddress: randomIp(),
    cookies: device ? { lms_device: device } : {},
  });
}

function devices(session: string, device?: string) {
  return app.inject({
    method: 'GET',
    url: '/api/v1/auth/devices',
    cookies: { lms_session: session, ...(device ? { lms_device: device } : {}) },
  });
}

beforeAll(async () => {
  app = await createIntegrationApp((b) => b.overrideProvider(Clock).useValue(clock));
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  clock.set('2026-10-01T08:00:00Z');
});

describe('student device limits', () => {
  it('reuses a known device instead of registering it again', async () => {
    const student = await register();
    const again = await login(student.phone, student.device);
    expect(again.statusCode).toBe(200);
    expect(cookie(again, 'lms_device')).toBeNull(); // no new device cookie
    const list = (await devices(student.session, student.device)).json<DevicesJson>();
    expect(list.devices).toHaveLength(1);
    expect(list.devices[0]).toMatchObject({ current: true, label: 'Chrome on Android' });
  });

  it('allows a second device and refuses a third, listing the active ones', async () => {
    const student = await register();
    expect((await login(student.phone)).statusCode).toBe(200);
    const third = await login(student.phone);
    expect(third.statusCode).toBe(403);
    const body = third.json<ErrorJson>();
    expect(body.error.code).toBe('device_limit_reached');
    expect(body.error.details?.devices).toHaveLength(2);
  });

  it('frees a slot when a device is removed, but allows only 2 new devices per 30 days', async () => {
    const student = await register();
    const second = await login(student.phone);
    const secondSession = cookie(second, 'lms_session');
    const list = (await devices(student.session, student.device)).json<DevicesJson>();
    const other = list.devices.find((d) => !d.current);

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/v1/auth/devices/${other?.id ?? ''}`,
      cookies: { lms_session: student.session },
    });
    expect(removed.statusCode).toBe(204);
    // The removed device's session ends with it.
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      cookies: { lms_session: secondSession ?? '' },
    });
    expect(me.statusCode).toBe(401);

    const third = await login(student.phone);
    expect(third.statusCode).toBe(403);
    expect(third.json<ErrorJson>().error.code).toBe('device_cooldown');
    expect(third.json<ErrorJson>().error.details?.retryAfterSeconds).toBeGreaterThan(
      29 * 24 * 3600,
    );

    clock.advance(31 * DAY);
    expect((await login(student.phone)).statusCode).toBe(200);
  });

  it('lets staff reset a student: all devices end and a new window opens', async () => {
    const student = await register();
    await login(student.phone);
    const devicesService = app.get(DevicesService);
    const db = app.get(TenantDb);
    const revoked = await db.transaction((tx) =>
      devicesService.resetForUser(tx, student.userId, 'staff'),
    );
    expect(revoked).toBe(2);
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      cookies: { lms_session: student.session },
    });
    expect(me.statusCode).toBe(401);
    expect((await login(student.phone)).statusCode).toBe(200);
    expect((await login(student.phone)).statusCode).toBe(200);
    expect((await login(student.phone)).statusCode).toBe(403);
  });

  it('gives exactly one slot to simultaneous logins from new browsers', async () => {
    const student = await register();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => login(student.phone).then((r) => r.statusCode)),
    );
    expect(results.filter((s) => s === 200)).toHaveLength(1);
    expect(results.filter((s) => s === 403)).toHaveLength(4);
  });

  it("can't remove someone else's device", async () => {
    const a = await register();
    const b = await register();
    const [bDevice] = (await devices(b.session)).json<DevicesJson>().devices;
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/auth/devices/${bDevice?.id ?? ''}`,
      cookies: { lms_session: a.session },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('exemptions', () => {
  it('does not limit staff', async () => {
    const helper = await register();
    const owner = await register();
    await adminQuery(`update users set status = 'active' where id = any($1)`, [
      [helper.userId, owner.userId],
    ]);
    const ws = await insertWorkspace(owner.userId);
    await insertMembership(ws, helper.userId, 'assistant');
    for (let i = 0; i < 3; i++) expect((await login(helper.phone)).statusCode).toBe(200);
  });

  it('does not limit platform owners', async () => {
    const user = await register();
    await adminQuery('insert into platform_owners (user_id, created_at) values ($1, now())', [
      user.userId,
    ]);
    for (let i = 0; i < 3; i++) expect((await login(user.phone)).statusCode).toBe(200);
  });
});
