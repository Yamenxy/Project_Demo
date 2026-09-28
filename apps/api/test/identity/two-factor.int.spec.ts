import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Clock, FixedClock } from '../../src/common';
import { stepAt, TOTP_STEP_SECONDS, totpForStep } from '../../src/modules/identity/two-factor/totp';
import { adminQuery } from '../support/fixtures';
import {
  cookieValue,
  createIntegrationApp,
  randomIp,
  randomPhone,
} from '../support/integration-app';

const PASSWORD = 'نجمة-الصباح-2026';
const clock = new FixedClock('2026-10-01T08:00:00Z');
let app: NestFastifyApplication;

type ErrorJson = { error: { code: string } };

function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of input) {
    value = (value << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

const cookie = (res: { headers: Record<string, unknown> }, name: string) =>
  cookieValue(res.headers['set-cookie'] as string[] | undefined, name);

function call(method: 'GET' | 'POST', url: string, session: string, payload?: object) {
  return app.inject({
    method,
    url,
    cookies: { lms_session: session },
    ...(payload ? { payload } : {}),
    remoteAddress: randomIp(),
  });
}

/** Registers an account and enrols it in 2FA. Returns what later steps need. */
async function enrolled() {
  const phone = randomPhone();
  const reg = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { nameAr: 'معلم تجريبي', phone, password: PASSWORD },
    remoteAddress: randomIp(),
  });
  const session = cookie(reg, 'lms_session') ?? '';
  const device = cookie(reg, 'lms_device') ?? '';
  const setup = await call('POST', '/api/v1/auth/2fa/setup', session);
  const { secret } = setup.json<{ secret: string }>();
  const key = base32Decode(secret);
  const code = totpForStep(key, stepAt(clock.now().getTime()));
  const enable = await call('POST', '/api/v1/auth/2fa/enable', session, { code });
  expect(enable.statusCode).toBe(200);
  const { recoveryCodes } = enable.json<{ recoveryCodes: string[] }>();
  return { phone, device, key, recoveryCodes, session };
}

async function login(phone: string, device: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { identifier: phone, password: PASSWORD },
    cookies: { lms_device: device },
    remoteAddress: randomIp(),
  });
  expect(res.statusCode).toBe(200);
  return {
    body: res.json<{ secondFactorRequired: boolean }>(),
    session: cookie(res, 'lms_session') ?? '',
  };
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

describe('enrolment', () => {
  it('stores the secret encrypted and returns an otpauth URI', async () => {
    const phone = randomPhone();
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { nameAr: 'معلم تجريبي', phone, password: PASSWORD },
      remoteAddress: randomIp(),
    });
    const session = cookie(reg, 'lms_session') ?? '';
    const res = await call('POST', '/api/v1/auth/2fa/setup', session);
    expect(res.statusCode).toBe(200);
    const { secret, otpauthUri } = res.json<{ secret: string; otpauthUri: string }>();
    expect(otpauthUri).toContain(`secret=${secret}`);
    const [row] = await adminQuery<{ totp_secret_encrypted: string; totp_enabled_at: Date | null }>(
      'select totp_secret_encrypted, totp_enabled_at from users where phone_e164 = $1',
      [`+20${phone.slice(1)}`],
    );
    expect(row?.totp_secret_encrypted.startsWith('v1.')).toBe(true);
    expect(row?.totp_secret_encrypted).not.toContain(secret);
    expect(row?.totp_enabled_at).toBeNull(); // not active until confirmed

    const wrong = await call('POST', '/api/v1/auth/2fa/enable', session, { code: '000000' });
    expect(wrong.json<ErrorJson>().error.code).toBe('invalid_code');
  });

  it('returns 10 recovery codes once, and refuses a second setup', async () => {
    const { recoveryCodes, session } = await enrolled();
    expect(recoveryCodes).toHaveLength(10);
    for (const code of recoveryCodes) expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const again = await call('POST', '/api/v1/auth/2fa/setup', session);
    expect(again.json<ErrorJson>().error.code).toBe('two_factor_already_enabled');
  });
});

describe('signing in with 2FA', () => {
  it('keeps the session pending until the code is entered', async () => {
    const { phone, device, key } = await enrolled();
    clock.advance(TOTP_STEP_SECONDS * 1000 * 2);
    const { body, session } = await login(phone, device);
    expect(body.secondFactorRequired).toBe(true);

    const me = await call('GET', '/api/v1/auth/me', session);
    expect(me.statusCode).toBe(200);
    expect(me.json<{ secondFactorPending: boolean }>().secondFactorPending).toBe(true);
    const blocked = await call('GET', '/api/v1/auth/devices', session);
    expect(blocked.statusCode).toBe(401);
    expect(blocked.json<ErrorJson>().error.code).toBe('second_factor_required');

    const code = totpForStep(key, stepAt(clock.now().getTime()));
    expect((await call('POST', '/api/v1/auth/2fa/verify', session, { code })).statusCode).toBe(204);
    expect((await call('GET', '/api/v1/auth/devices', session)).statusCode).toBe(200);
  });

  it('refuses a code that was already used (replay)', async () => {
    const { phone, device, key } = await enrolled();
    clock.advance(TOTP_STEP_SECONDS * 1000 * 2);
    const code = totpForStep(key, stepAt(clock.now().getTime()));
    const first = await login(phone, device);
    expect(
      (await call('POST', '/api/v1/auth/2fa/verify', first.session, { code })).statusCode,
    ).toBe(204);
    const second = await login(phone, device);
    const replay = await call('POST', '/api/v1/auth/2fa/verify', second.session, { code });
    expect(replay.json<ErrorJson>().error.code).toBe('invalid_code');
  });

  it('accepts each recovery code once, in any case and without the dash', async () => {
    const { phone, device, recoveryCodes } = await enrolled();
    const recovery = recoveryCodes[0] ?? '';
    const typed = recovery.replace('-', '').toLowerCase();
    const first = await login(phone, device);
    expect(
      (await call('POST', '/api/v1/auth/2fa/verify', first.session, { code: typed })).statusCode,
    ).toBe(204);
    const second = await login(phone, device);
    const reuse = await call('POST', '/api/v1/auth/2fa/verify', second.session, { code: recovery });
    expect(reuse.json<ErrorJson>().error.code).toBe('invalid_code');
    const audit = await adminQuery(
      `select 1 from audit_log where action = 'auth.recovery_code_used' and occurred_at >= $1`,
      [clock.now()],
    );
    expect(audit.length).toBeGreaterThan(0);
  });

  it('locks out after 5 wrong codes', async () => {
    const { phone, device, key } = await enrolled();
    clock.advance(TOTP_STEP_SECONDS * 1000 * 2);
    const { session } = await login(phone, device);
    for (let i = 0; i < 5; i++) {
      await call('POST', '/api/v1/auth/2fa/verify', session, { code: '000000' });
    }
    const code = totpForStep(key, stepAt(clock.now().getTime()));
    const locked = await call('POST', '/api/v1/auth/2fa/verify', session, { code });
    expect(locked.statusCode).toBe(429);
  });

  it('does not ask accounts without 2FA for a second factor', async () => {
    const phone = randomPhone();
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { nameAr: 'طالب تجريبي', phone, password: PASSWORD },
      remoteAddress: randomIp(),
    });
    expect(reg.json<{ secondFactorRequired: boolean }>().secondFactorRequired).toBe(false);
    const session = cookie(reg, 'lms_session') ?? '';
    expect((await call('GET', '/api/v1/auth/devices', session)).statusCode).toBe(200);
  });
});
