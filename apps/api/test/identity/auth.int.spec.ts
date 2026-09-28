import { createHash } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Clock, FixedClock } from '../../src/common';
import { TEST_WEB_ORIGIN } from '../support/http-app';
import {
  cookieValue,
  createIntegrationApp,
  randomIp,
  randomPhone,
} from '../support/integration-app';

const urls = inject('databaseUrls');
const PASSWORD = 'نجمة-الصباح-2026';
const COOKIE = 'lms_session';

let app: NestFastifyApplication;

type UserJson = {
  user: { id: string; status: string; platformCode: string; phoneVerified: boolean };
};
type ErrorJson = { error: { code: string; details?: unknown } };

async function admin<T extends object>(text: string, values: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: urls.admin });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}

function register(target: NestFastifyApplication, body: Record<string, unknown>, ip = randomIp()) {
  return target.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { nameAr: 'طالب تجريبي', password: PASSWORD, ...body },
    remoteAddress: ip,
  });
}

function login(
  target: NestFastifyApplication,
  identifier: string,
  password = PASSWORD,
  extra: { ip?: string; origin?: string; rememberMe?: boolean; device?: string | null } = {},
) {
  return target.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { identifier, password, rememberMe: extra.rememberMe ?? false },
    remoteAddress: extra.ip ?? randomIp(),
    headers: extra.origin ? { origin: extra.origin } : {},
    cookies: extra.device ? { lms_device: extra.device } : {},
  });
}

const deviceOf = (res: { headers: Record<string, unknown> }) =>
  cookieValue(res.headers['set-cookie'] as string[] | undefined, 'lms_device');

function me(target: NestFastifyApplication, token: string | null) {
  return target.inject({
    method: 'GET',
    url: '/api/v1/auth/me',
    cookies: token ? { [COOKIE]: token } : {},
  });
}

beforeAll(async () => {
  app = await createIntegrationApp();
});

afterAll(async () => {
  await app.close();
});

describe('registration', () => {
  it('creates a pending account, signs it in with a secure cookie, and audits it', async () => {
    const res = await register(app, { phone: randomPhone() });
    expect(res.statusCode).toBe(201);
    const { user } = res.json<UserJson>();
    expect(user).toMatchObject({ status: 'pending', phoneVerified: false });
    expect(user.platformCode).toMatch(/^[A-Z2-9]{8}$/);

    const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    const sessionCookie = cookies.find((c) => c.startsWith(`${COOKIE}=`)) ?? '';
    expect(sessionCookie).toContain('HttpOnly');
    expect(sessionCookie).toContain('SameSite=Lax');
    expect(sessionCookie).not.toContain('Expires'); // browser-session cookie without "remember me"
    expect(cookies.find((c) => c.startsWith('lms_device='))).toContain('HttpOnly');

    const token = cookieValue(res.headers['set-cookie'], COOKIE);
    expect(token).toBeTruthy();
    const [session] = await admin<{ token_hash: string }>(
      'select token_hash from sessions where user_id = $1',
      [user.id],
    );
    expect(session?.token_hash).toBe(
      createHash('sha256')
        .update(token ?? '')
        .digest('hex'),
    );
    expect(session?.token_hash).not.toBe(token);

    const audit = await admin<{ action: string; workspace_id: string | null }>(
      `select action, workspace_id from audit_log where entity_id = $1`,
      [user.id],
    );
    expect(audit).toEqual([{ action: 'auth.registered', workspace_id: null }]);
  });

  it('stores the phone in E.164 whatever format was typed', async () => {
    const local = randomPhone();
    const arabic = local.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)));
    const res = await register(app, { phone: arabic });
    const { user } = res.json<UserJson>();
    const [row] = await admin<{ phone_e164: string }>(
      'select phone_e164 from users where id = $1',
      [user.id],
    );
    expect(row?.phone_e164).toBe(`+20${local.slice(1)}`);
  });

  it.each([
    [{ phone: '0223456789' }, 'invalid_phone'],
    [{ phone: randomPhone(), password: '12345678' }, 'password_too_common'],
    [{ phone: randomPhone(), password: 'short' }, 'password_too_short'],
    [{ phone: randomPhone(), nameAr: 'x' }, 'validation_failed'],
    [{ phone: randomPhone(), dateOfBirth: '2010-02-30' }, 'validation_failed'],
  ])('rejects %o with %s', async (body, code) => {
    const res = await register(app, body);
    expect(res.statusCode).toBe(400);
    expect(res.json<ErrorJson>().error.code).toBe(code);
  });

  it('limits registrations per IP', async () => {
    const ip = randomIp();
    for (let i = 0; i < 10; i++) {
      expect((await register(app, { phone: randomPhone() }, ip)).statusCode).toBe(201);
    }
    const res = await register(app, { phone: randomPhone() }, ip);
    expect(res.statusCode).toBe(429);
    expect(res.json<ErrorJson>().error.code).toBe('rate_limited');
  });
});

describe('login and sessions', () => {
  it('signs in with the phone in any format and returns the current user', async () => {
    const phone = randomPhone();
    const { user } = (await register(app, { phone })).json<UserJson>();
    const res = await login(app, `+20 ${phone.slice(1)}`);
    expect(res.statusCode).toBe(200);
    const token = cookieValue(res.headers['set-cookie'], COOKIE);
    const current = await me(app, token);
    expect(current.statusCode).toBe(200);
    expect(current.json<UserJson>().user.id).toBe(user.id);
  });

  it('gives the same answer for a wrong password and an unknown account', async () => {
    const phone = randomPhone();
    await register(app, { phone });
    const wrong = await login(app, phone, 'wrong password here');
    const unknown = await login(app, randomPhone());
    expect([wrong.statusCode, unknown.statusCode]).toEqual([401, 401]);
    expect(wrong.body.replace(/"requestId":"[^"]+"/, '')).toBe(
      unknown.body.replace(/"requestId":"[^"]+"/, ''),
    );
  });

  it('requires a session for /me', async () => {
    expect((await me(app, null)).statusCode).toBe(401);
    expect((await me(app, 'forged-token')).statusCode).toBe(401);
  });

  it('logs out the current session only', async () => {
    const phone = randomPhone();
    const device = deviceOf(await register(app, { phone }));
    const a = cookieValue(
      (await login(app, phone, PASSWORD, { device })).headers['set-cookie'],
      COOKIE,
    );
    const b = cookieValue(
      (await login(app, phone, PASSWORD, { device })).headers['set-cookie'],
      COOKIE,
    );
    expect(a && b).toBeTruthy();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      cookies: { [COOKIE]: a ?? '' },
    });
    expect(res.statusCode).toBe(204);
    expect((await me(app, a)).statusCode).toBe(401);
    expect((await me(app, b)).statusCode).toBe(200);
  });

  it('logs out every device', async () => {
    const phone = randomPhone();
    const firstDevice = deviceOf(await register(app, { phone }));
    const a = cookieValue(
      (await login(app, phone, PASSWORD, { device: firstDevice })).headers['set-cookie'],
      COOKIE,
    );
    // A second browser: the account's second and last allowed device.
    const b = cookieValue((await login(app, phone)).headers['set-cookie'], COOKIE);
    expect(a && b).toBeTruthy();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout-all',
      cookies: { [COOKIE]: a ?? '' },
    });
    expect(res.statusCode).toBe(204);
    expect((await me(app, a)).statusCode).toBe(401);
    expect((await me(app, b)).statusCode).toBe(401);
  });

  it('locks an identifier after 10 failures, even for the right password', async () => {
    const phone = randomPhone();
    await register(app, { phone });
    for (let i = 0; i < 10; i++) {
      expect((await login(app, phone, `wrong-${i}-password`)).statusCode).toBe(401);
    }
    const res = await login(app, phone);
    expect(res.statusCode).toBe(429);
    expect(res.json<ErrorJson>().error.details).toMatchObject({
      retryAfterSeconds: expect.any(Number) as number,
    });
  });

  it('refuses a suspended account only after the correct password', async () => {
    const phone = randomPhone();
    const { user } = (await register(app, { phone })).json<UserJson>();
    await admin(`update users set status = 'suspended' where id = $1`, [user.id]);
    expect((await login(app, phone, 'wrong password here')).statusCode).toBe(401);
    const res = await login(app, phone);
    expect(res.statusCode).toBe(403);
    expect(res.json<ErrorJson>().error.code).toBe('account_unavailable');
  });

  it('prefers the verified holder of a phone number over unverified claims', async () => {
    const phone = randomPhone();
    const owner = (await register(app, { phone, password: 'owner-password-1' })).json<UserJson>();
    await register(app, { phone, password: 'squatter-password-1' });
    // Both unverified: each signs in with its own password.
    expect((await login(app, phone, 'squatter-password-1')).statusCode).toBe(200);
    await admin('update users set phone_verified_at = now() where id = $1', [owner.user.id]);
    expect((await login(app, phone, 'squatter-password-1')).statusCode).toBe(401);
    expect((await login(app, phone, 'owner-password-1')).statusCode).toBe(200);
  });
});

describe('CSRF defence', () => {
  it('refuses state-changing requests from another origin', async () => {
    const phone = randomPhone();
    await register(app, { phone });
    const evil = await login(app, phone, PASSWORD, { origin: 'https://evil.example' });
    expect(evil.statusCode).toBe(403);
    expect(evil.json<ErrorJson>().error.code).toBe('forbidden_origin');
    expect((await login(app, phone, PASSWORD, { origin: TEST_WEB_ORIGIN })).statusCode).toBe(200);
  });
});

describe('session expiry', () => {
  let timedApp: NestFastifyApplication;
  const clock = new FixedClock('2026-10-01T08:00:00Z');

  beforeAll(async () => {
    timedApp = await createIntegrationApp((builder) =>
      builder.overrideProvider(Clock).useValue(clock),
    );
  });

  afterAll(async () => {
    await timedApp.close();
  });

  it('ends a session without "remember me" after 12 hours', async () => {
    clock.set('2026-10-01T08:00:00Z');
    const phone = randomPhone();
    await register(timedApp, { phone });
    const token = cookieValue((await login(timedApp, phone)).headers['set-cookie'], COOKIE);
    clock.advance(11 * 3600 * 1000);
    expect((await me(timedApp, token)).statusCode).toBe(200);
    clock.advance(2 * 3600 * 1000);
    expect((await me(timedApp, token)).statusCode).toBe(401);
  });

  it('slides a remembered session while in use, and ends it after 14 idle days', async () => {
    clock.set('2026-10-01T08:00:00Z');
    const phone = randomPhone();
    await register(timedApp, { phone });
    const res = await login(timedApp, phone, PASSWORD, { rememberMe: true });
    expect(String(res.headers['set-cookie'])).toContain('Expires');
    const token = cookieValue(res.headers['set-cookie'], COOKIE);
    clock.advance(10 * 24 * 3600 * 1000);
    expect((await me(timedApp, token)).statusCode).toBe(200); // slides the idle window
    clock.advance(10 * 24 * 3600 * 1000);
    expect((await me(timedApp, token)).statusCode).toBe(200);
    clock.advance(15 * 24 * 3600 * 1000);
    expect((await me(timedApp, token)).statusCode).toBe(401);
  });
});
