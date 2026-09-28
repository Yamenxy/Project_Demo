import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TenantDb } from '../../src/database';
import { JobsRuntime } from '../../src/jobs';
import { stepAt, totpForStep } from '../../src/modules/identity/two-factor/totp';
import { EmailSender, NotificationsService, type EmailMessage } from '../../src/modules/notify';
import { adminQuery, insertUser } from '../support/fixtures';
import { createIntegrationApp } from '../support/integration-app';
import { signIn } from '../support/sessions';
import { waitFor } from '../support/wait-for';

class CapturingEmailSender extends EmailSender {
  readonly sent: EmailMessage[] = [];
  send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }
}

const email = new CapturingEmailSender();
let app: NestFastifyApplication;
let service: NotificationsService;
let db: TenantDb;

type ListJson = { items: { id: string; type: string; read: boolean }[]; unread: number };

function list(token: string, query = '') {
  return app.inject({
    method: 'GET',
    url: `/api/v1/notifications${query}`,
    cookies: { lms_session: token },
  });
}

function notify(userId: string, type = 'account.two_factor_enabled', withEmail = false) {
  return db.transaction((tx) =>
    service.notify(tx, { recipientUserId: userId, workspaceId: null, type, email: withEmail }),
  );
}

beforeAll(async () => {
  app = await createIntegrationApp((b) => b.overrideProvider(EmailSender).useValue(email));
  service = app.get(NotificationsService);
  db = app.get(TenantDb);
  const jobs = app.get(JobsRuntime);
  await jobs.start();
  await jobs.startWorkers({ pollingIntervalSeconds: 0.5 });
});

afterAll(async () => {
  await app.close();
});

describe('in-app notifications', () => {
  it('lists the recipient notifications with an unread count, and marks them read', async () => {
    const user = await insertUser();
    const token = await signIn(app, user);
    const first = await notify(user);
    await notify(user, 'account.password_reset');

    const before = (await list(token)).json<ListJson>();
    expect(before.unread).toBe(2);
    expect(before.items.map((i) => i.type)).toEqual([
      'account.password_reset',
      'account.two_factor_enabled',
    ]);

    const read = await app.inject({
      method: 'POST',
      url: `/api/v1/notifications/${first}/read`,
      cookies: { lms_session: token },
    });
    expect(read.statusCode).toBe(204);
    expect((await list(token)).json<ListJson>().unread).toBe(1);

    await app.inject({
      method: 'POST',
      url: '/api/v1/notifications/read-all',
      cookies: { lms_session: token },
    });
    expect((await list(token)).json<ListJson>().unread).toBe(0);
  });

  it("never shows or changes someone else's notifications", async () => {
    const owner = await insertUser();
    const other = await insertUser();
    const id = await notify(owner);
    const otherToken = await signIn(app, other);
    expect((await list(otherToken)).json<ListJson>().items).toEqual([]);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/notifications/${id}/read`,
      cookies: { lms_session: otherToken },
    });
    expect(res.statusCode).toBe(404);
  });

  it('pages with a "before" cursor', async () => {
    const user = await insertUser();
    const token = await signIn(app, user);
    await notify(user);
    const all = (await list(token)).json<{ items: { createdAt: string }[] }>().items;
    const cursor = encodeURIComponent(
      new Date(Date.parse(all[0]?.createdAt ?? '') - 1).toISOString(),
    );
    expect((await list(token, `?before=${cursor}`)).json<ListJson>().items).toEqual([]);
  });

  it('stores notifications in the monthly partition', async () => {
    const user = await insertUser();
    const id = await notify(user);
    const [row] = await adminQuery<{ partition: string }>(
      'select tableoid::regclass::text as partition from notifications where id = $1',
      [id],
    );
    expect(row?.partition).toBe(
      `notifications_${new Date().toISOString().slice(0, 7).replace('-', '_')}`,
    );
  });

  it('exists only if the change that caused it commits', async () => {
    const user = await insertUser();
    await expect(
      db.transaction(async (tx) => {
        await service.notify(tx, {
          recipientUserId: user,
          workspaceId: null,
          type: 'account.password_reset',
          email: true,
        });
        throw new Error('business rule failed');
      }),
    ).rejects.toThrow('business rule failed');
    const rows = await adminQuery('select 1 from notifications where recipient_user_id = $1', [
      user,
    ]);
    expect(rows).toEqual([]);
    const jobs = await adminQuery(
      `select 1 from pgboss.job where name = 'notify.email' and data->>'userId' = $1`,
      [user],
    );
    expect(jobs).toEqual([]);
  });
});

describe('email', () => {
  it('emails a verified address in Arabic and English, and skips unverified ones', async () => {
    const verified = await insertUser();
    const address = `teacher-${verified.slice(0, 8)}@example.test`;
    await adminQuery('update users set email = $2, email_verified_at = now() where id = $1', [
      verified,
      address,
    ]);
    const unverified = await insertUser();
    await adminQuery(`update users set email = 'nobody@example.test' where id = $1`, [unverified]);

    await notify(unverified, 'account.password_reset', true);
    await notify(verified, 'account.password_reset', true);

    await waitFor(() => email.sent.some((m) => m.to === address), 15_000);
    const message = email.sent.find((m) => m.to === address);
    expect(message?.subject).toBe('تم تغيير كلمة المرور | Your password was changed');
    expect(message?.text).toContain('Your password was changed');
    expect(email.sent.some((m) => m.to === 'nobody@example.test')).toBe(false);
  });
});

describe('real events', () => {
  it('turning on two-step verification notifies the account', async () => {
    const user = await insertUser();
    const token = await signIn(app, user);
    const setup = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/2fa/setup',
      cookies: { lms_session: token },
    });
    const secret = setup.json<{ secret: string }>().secret;
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = 0;
    let value = 0;
    const bytes: number[] = [];
    for (const char of secret) {
      value = (value << 5) | alphabet.indexOf(char);
      bits += 5;
      if (bits >= 8) {
        bytes.push((value >>> (bits - 8)) & 0xff);
        bits -= 8;
      }
    }
    const code = totpForStep(Buffer.from(bytes), stepAt(Date.now()));
    const enabled = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/2fa/enable',
      payload: { code },
      cookies: { lms_session: token },
    });
    expect(enabled.statusCode).toBe(200);
    const items = (await list(token)).json<ListJson>().items;
    expect(items.map((i) => i.type)).toContain('account.two_factor_enabled');
  });
});
