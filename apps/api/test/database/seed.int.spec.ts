import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { DEMO_PHONE_PREFIX, seedDemoData } from '../../src/database/seed';
import { adminQuery } from '../support/fixtures';
import { cookieValue, createIntegrationApp } from '../support/integration-app';

const urls = inject('databaseUrls');
const PASSWORD = 'demo-password-for-tests';
let app: NestFastifyApplication;
let pool: Pool;

beforeAll(async () => {
  app = await createIntegrationApp();
  pool = new Pool({ connectionString: urls.platform, max: 1 });
});

afterAll(async () => {
  await pool.end();
  await app.close();
});

describe('demo seed', () => {
  it('creates synthetic data once, then does nothing', async () => {
    const key = process.env.SECRET_ENCRYPTION_KEY ?? '';
    const first = await seedDemoData(pool, { password: PASSWORD, secretEncryptionKey: key });
    const second = await seedDemoData(pool, { password: PASSWORD, secretEncryptionKey: key });
    expect(first.created).toBe(true);
    expect(first.logins.length).toBeGreaterThan(5);
    expect(second.created).toBe(false);
  });

  it('uses only the demo phone block', async () => {
    const rows = await adminQuery<{ phone: string }>(
      `select phone_e164 as phone from users where name_ar in ('مريم أحمد', 'أ. محمد السيد')`,
    );
    expect(rows.length).toBe(2);
    for (const { phone } of rows) expect(phone.startsWith(DEMO_PHONE_PREFIX)).toBe(true);
  });

  it('lets the seeded helper sign in and see their granted permissions', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { identifier: '01000000005', password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    const token = cookieValue(login.headers['set-cookie'], 'lms_session') ?? '';
    const [workspace] = await adminQuery<{ id: string }>(
      `select id from workspaces where slug = 'mohamed-physics'`,
    );
    const context = await app.inject({
      method: 'GET',
      url: `/api/v1/w/${workspace?.id ?? ''}/context`,
      cookies: { lms_session: token },
    });
    expect(context.statusCode).toBe(200);
    expect(context.json<{ permissions: string[] }>().permissions.sort()).toEqual([
      'attendance.mark',
      'payments.record',
      'payments.view',
    ]);
  });

  it('includes a paused student, a student of both teachers and a managed record', async () => {
    const demoUsers = `select id from users where phone_e164 like '${DEMO_PHONE_PREFIX}%'`;
    const paused = await adminQuery(
      `select 1 from memberships where paused_at is not null and user_id in (${demoUsers})`,
    );
    expect(paused.length).toBeGreaterThan(0);
    const both = await adminQuery(
      `select user_id from memberships where role = 'student' and user_id in (${demoUsers})
        group by user_id having count(*) = 2`,
    );
    expect(both.length).toBe(2);
    const managed = await adminQuery(
      `select 1 from memberships where user_id is null and provisional_phone like $1`,
      [`${DEMO_PHONE_PREFIX}%`],
    );
    expect(managed.length).toBeGreaterThan(0);
  });
});
