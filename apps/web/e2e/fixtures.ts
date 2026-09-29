import { randomUUID } from 'node:crypto';
import type { BrowserContext } from '@playwright/test';
import { Client } from 'pg';
import { latestOtp, randomPhone, totp } from './support';

export const PASSWORD = 'نجمة-الصباح-2026';

/** The migrator connection, for fixtures only (workspaces are created by platform owners). */
const ADMIN_URL =
  process.env.E2E_ADMIN_DATABASE_URL ??
  'postgres://lms_admin:lms_admin_local_only@localhost:5432/lms_dev';

export async function adminQuery<T extends object>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const client = new Client({ connectionString: ADMIN_URL });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}

export interface Account {
  phone: string;
  userId: string;
  totpSecret?: string;
}

/**
 * Registers and verifies an account through the API (as the web app does), signed in within the
 * given browser context. With `twoFactor`, also enrols 2FA.
 */
export async function signUp(
  context: BrowserContext,
  options: { name?: string; twoFactor?: boolean } = {},
): Promise<Account> {
  // Every browser test signs up from the same local address; start each account with fresh
  // per-IP limits (test database only).
  await adminQuery('delete from rate_limit_counters');
  const phone = randomPhone();
  const api = context.request;
  const registered = await api.post('/api/v1/auth/register', {
    data: { nameAr: options.name ?? 'مستخدم تجريبي', phone, password: PASSWORD },
  });
  const userId = ((await registered.json()) as { user: { id: string } }).user.id;
  await api.post('/api/v1/auth/phone/send-code');
  await api.post('/api/v1/auth/phone/verify', {
    data: { code: await latestOtp(phone, 'verify_phone') },
  });
  if (!options.twoFactor) return { phone, userId };
  const setup = (await (await api.post('/api/v1/auth/2fa/setup')).json()) as { secret: string };
  await api.post('/api/v1/auth/2fa/enable', { data: { code: totp(setup.secret) } });
  return { phone, userId, totpSecret: setup.secret };
}

/** What a platform owner does in the console: a workspace with its owner and a trial. */
export async function createWorkspace(ownerUserId: string, name: string): Promise<string> {
  const id = randomUUID();
  await adminQuery(
    `insert into workspaces (id, slug, name, owner_user_id, created_at, updated_at)
     values ($1, $2, $3, $4, now(), now())`,
    [id, `e2e-${id.slice(0, 8)}`, name, ownerUserId],
  );
  await adminQuery(
    `insert into memberships (workspace_id, id, user_id, role, status, created_at, updated_at)
     values ($1, $2, $3, 'owner', 'active', now(), now())`,
    [id, randomUUID(), ownerUserId],
  );
  await adminQuery(
    `insert into subscriptions (workspace_id, plan, period_ends_at, grace_days, created_at, updated_at)
     values ($1, 'starter', now() + interval '14 days', 7, now(), now())`,
    [id],
  );
  return id;
}
