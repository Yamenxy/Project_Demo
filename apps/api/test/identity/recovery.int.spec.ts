import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { Clock, FixedClock } from '../../src/common';
import { OtpSender } from '../../src/modules/identity';
import { CapturingOtpSender } from '../support/capturing-otp-sender';
import {
  cookieValue,
  createIntegrationApp,
  randomIp,
  randomPhone,
} from '../support/integration-app';

const urls = inject('databaseUrls');
const PASSWORD = 'نجمة-الصباح-2026';
const COOKIE = 'lms_session';
const DAY = 24 * 3600 * 1000;

const clock = new FixedClock('2026-10-01T08:00:00Z');
const otp = new CapturingOtpSender();
let app: NestFastifyApplication;

type ErrorJson = { error: { code: string } };
type UserJson = { user: { id: string; status: string; phoneVerified: boolean } };

async function admin<T extends object>(text: string, values: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: urls.admin });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}

const e164 = (local: string) => `+20${local.slice(1)}`;
const arabicDigits = (s: string) =>
  s.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)));

async function registerUser(phone = randomPhone(), password = PASSWORD) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { nameAr: 'طالب تجريبي', phone, password },
    remoteAddress: randomIp(),
  });
  expect(res.statusCode).toBe(201);
  return {
    phone,
    token: cookieValue(res.headers['set-cookie'], COOKIE) ?? '',
    userId: res.json<UserJson>().user.id,
  };
}

function post(url: string, payload?: object, token?: string) {
  return app.inject({
    method: 'POST',
    url,
    ...(payload ? { payload } : {}),
    cookies: token ? { [COOKIE]: token } : {},
    remoteAddress: randomIp(),
  });
}

async function verify(token: string, phone: string) {
  await post('/api/v1/auth/phone/send-code', undefined, token);
  const code = otp.lastCode(e164(phone), 'verify_phone') ?? '';
  return post('/api/v1/auth/phone/verify', { code }, token);
}

beforeAll(async () => {
  app = await createIntegrationApp((builder) =>
    builder.overrideProvider(Clock).useValue(clock).overrideProvider(OtpSender).useValue(otp),
  );
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  clock.set('2026-10-01T08:00:00Z');
});

describe('phone verification', () => {
  it('activates the account with the code, typed in Arabic digits', async () => {
    const { token, phone, userId } = await registerUser();
    const sent = await post('/api/v1/auth/phone/send-code', undefined, token);
    expect(sent.statusCode).toBe(202);
    expect(sent.json()).toEqual({ expiresInSeconds: 300 });
    const code = otp.lastCode(e164(phone), 'verify_phone') ?? '';
    expect(code).toMatch(/^\d{6}$/);

    const res = await post('/api/v1/auth/phone/verify', { code: arabicDigits(code) }, token);
    expect(res.statusCode).toBe(200);
    expect(res.json<UserJson>().user).toMatchObject({ status: 'active', phoneVerified: true });
    const audit = await admin<{ action: string }>(
      `select action from audit_log where entity_id = $1 order by occurred_at`,
      [userId],
    );
    expect(audit.map((a) => a.action)).toEqual(['auth.registered', 'auth.phone_verified']);

    const again = await post('/api/v1/auth/phone/send-code', undefined, token);
    expect(again.json<ErrorJson>().error.code).toBe('phone_already_verified');
  });

  it('requires a session', async () => {
    expect((await post('/api/v1/auth/phone/send-code')).statusCode).toBe(401);
  });

  it('stores only a hash of the code', async () => {
    const { token, phone, userId } = await registerUser();
    await post('/api/v1/auth/phone/send-code', undefined, token);
    const code = otp.lastCode(e164(phone), 'verify_phone') ?? '';
    const rows = await admin<{ code_hash: string }>(
      'select code_hash from otp_challenges where user_id = $1',
      [userId],
    );
    expect(rows[0]?.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]?.code_hash).not.toContain(code);
  });

  it('rejects an expired code', async () => {
    const { token, phone } = await registerUser();
    await post('/api/v1/auth/phone/send-code', undefined, token);
    const code = otp.lastCode(e164(phone), 'verify_phone') ?? '';
    clock.advance(301 * 1000);
    const res = await post('/api/v1/auth/phone/verify', { code }, token);
    expect(res.json<ErrorJson>().error.code).toBe('code_expired');
  });

  it('invalidates an older code when a new one is sent', async () => {
    const { token, phone } = await registerUser();
    await post('/api/v1/auth/phone/send-code', undefined, token);
    const first = otp.lastCode(e164(phone), 'verify_phone') ?? '';
    await post('/api/v1/auth/phone/send-code', undefined, token);
    const second = otp.lastCode(e164(phone), 'verify_phone') ?? '';
    if (first !== second) {
      const res = await post('/api/v1/auth/phone/verify', { code: first }, token);
      expect(res.json<ErrorJson>().error.code).toBe('invalid_code');
    }
    expect((await post('/api/v1/auth/phone/verify', { code: second }, token)).statusCode).toBe(200);
  });

  it('locks out after 5 wrong codes for 15 minutes', async () => {
    const { token, phone } = await registerUser();
    await post('/api/v1/auth/phone/send-code', undefined, token);
    const code = otp.lastCode(e164(phone), 'verify_phone') ?? '';
    const wrong = code === '000000' ? '111111' : '000000';
    const codes: string[] = [];
    for (let i = 0; i < 5; i++) {
      codes.push(
        (await post('/api/v1/auth/phone/verify', { code: wrong }, token)).json<ErrorJson>().error
          .code,
      );
    }
    expect(codes).toEqual([
      'invalid_code',
      'invalid_code',
      'invalid_code',
      'invalid_code',
      'code_attempts_exceeded',
    ]);
    const locked = await post('/api/v1/auth/phone/verify', { code }, token);
    expect(locked.statusCode).toBe(429);

    clock.advance(16 * 60 * 1000);
    await post('/api/v1/auth/phone/send-code', undefined, token);
    const fresh = otp.lastCode(e164(phone), 'verify_phone') ?? '';
    expect((await post('/api/v1/auth/phone/verify', { code: fresh }, token)).statusCode).toBe(200);
  });

  it('refuses a number that belongs to another active account', async () => {
    const phone = randomPhone();
    const owner = await registerUser(phone, 'owner-password-1');
    expect((await verify(owner.token, phone)).statusCode).toBe(200);
    const claimant = await registerUser(phone, 'claimant-password-1');
    const res = await verify(claimant.token, phone);
    expect(res.statusCode).toBe(409);
    expect(res.json<ErrorJson>().error.code).toBe('phone_in_use');
    const [row] = await admin<{ verified: boolean }>(
      'select phone_verified_at is not null as verified from users where id = $1',
      [owner.userId],
    );
    expect(row?.verified).toBe(true);
  });

  it('moves a recycled number from an account inactive for a year', async () => {
    const phone = randomPhone();
    const oldOwner = await registerUser(phone, 'old-owner-password-1');
    expect((await verify(oldOwner.token, phone)).statusCode).toBe(200);
    clock.advance(400 * DAY);
    const newOwner = await registerUser(phone, 'new-owner-password-1');
    expect((await verify(newOwner.token, phone)).statusCode).toBe(200);
    const rows = await admin<{ id: string; verified: boolean }>(
      'select id, phone_verified_at is not null as verified from users where id = any($1)',
      [[oldOwner.userId, newOwner.userId]],
    );
    expect(rows.find((r) => r.id === oldOwner.userId)?.verified).toBe(false);
    expect(rows.find((r) => r.id === newOwner.userId)?.verified).toBe(true);
    const audit = await admin<{ action: string }>(
      `select action from audit_log where entity_id = $1 and action = 'auth.phone_reassigned'`,
      [oldOwner.userId],
    );
    expect(audit).toHaveLength(1);
  });
});

describe('password reset', () => {
  it('answers the same whether or not the number has an account', async () => {
    const before = otp.sent.length;
    const res = await post('/api/v1/auth/password/forgot', { phone: randomPhone() });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({});
    expect(otp.sent.length).toBe(before);
  });

  it('refuses an OTP-only reset for an account used in the last year', async () => {
    const { token, phone, userId } = await registerUser();
    await verify(token, phone);
    await post('/api/v1/auth/password/forgot', { phone });
    const code = otp.lastCode(e164(phone), 'password_reset') ?? '';
    const res = await post('/api/v1/auth/password/reset', {
      phone,
      code,
      newPassword: 'a-brand-new-password',
    });
    expect(res.statusCode).toBe(403);
    expect(res.json<ErrorJson>().error.code).toBe('recovery_requires_support');
    const audit = await admin<{ reason: string }>(
      `select reason from audit_log where entity_id = $1 and action = 'auth.recovery_refused'`,
      [userId],
    );
    expect(audit).toEqual([{ reason: 'recent_activity' }]);
  });

  it('resets a dormant account and signs out every session', async () => {
    const { token, phone } = await registerUser();
    await verify(token, phone);
    clock.advance(400 * DAY);
    await post('/api/v1/auth/password/forgot', { phone });
    const code = otp.lastCode(e164(phone), 'password_reset') ?? '';
    const wrong = await post('/api/v1/auth/password/reset', {
      phone,
      code: code === '000000' ? '111111' : '000000',
      newPassword: 'a-brand-new-password',
    });
    expect(wrong.json<ErrorJson>().error.code).toBe('invalid_code');
    const res = await post('/api/v1/auth/password/reset', {
      phone,
      code,
      newPassword: 'a-brand-new-password',
    });
    expect(res.statusCode).toBe(204);

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      cookies: { [COOKIE]: token },
    });
    expect(me.statusCode).toBe(401);
    const login = (password: string) => post('/api/v1/auth/login', { identifier: phone, password });
    expect((await login(PASSWORD)).statusCode).toBe(401);
    expect((await login('a-brand-new-password')).statusCode).toBe(200);
  });

  it('applies the password policy before using the code', async () => {
    const { token, phone } = await registerUser();
    await verify(token, phone);
    clock.advance(400 * DAY);
    await post('/api/v1/auth/password/forgot', { phone });
    const code = otp.lastCode(e164(phone), 'password_reset') ?? '';
    const weak = await post('/api/v1/auth/password/reset', {
      phone,
      code,
      newPassword: '12345678',
    });
    expect(weak.json<ErrorJson>().error.code).toBe('password_too_common');
    const ok = await post('/api/v1/auth/password/reset', {
      phone,
      code,
      newPassword: 'a-brand-new-password',
    });
    expect(ok.statusCode).toBe(204);
  });
});
