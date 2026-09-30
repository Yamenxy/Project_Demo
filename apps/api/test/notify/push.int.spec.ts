import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TenantDb } from '../../src/database';
import { PlatformDb } from '../../src/database/platform-db';
import {
  NotificationsService,
  PushSender,
  PushService,
  type PushMessage,
  type PushResult,
  type PushTarget,
} from '../../src/modules/notify';
import { adminQuery, insertUser } from '../support/fixtures';
import { createIntegrationApp } from '../support/integration-app';
import { signIn } from '../support/sessions';

/** Records pushes instead of sending them; an endpoint containing "gone" answers 410. */
class FakePushSender extends PushSender {
  readonly publicKey = 'BFakePublicKeyForTests000000000000000000000000';
  sent: { endpoint: string; message: PushMessage }[] = [];

  send(target: PushTarget, message: PushMessage): Promise<PushResult> {
    if (target.endpoint.includes('gone')) return Promise.resolve('gone');
    this.sent.push({ endpoint: target.endpoint, message });
    return Promise.resolve('sent');
  }
}

const fake = new FakePushSender();
let app: NestFastifyApplication;

function call(method: 'GET' | 'POST', url: string, token: string, payload?: object) {
  return app.inject({
    method,
    url,
    cookies: { lms_session: token },
    ...(payload ? { payload } : {}),
  });
}

const subscription = (endpoint: string) => ({
  endpoint,
  keys: { p256dh: 'BPublicKeyOfTheBrowser0000000000000000', auth: 'authsecret123' },
});

beforeAll(async () => {
  app = await createIntegrationApp((builder) =>
    builder.overrideProvider(PushSender).useValue(fake),
  );
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  fake.sent = [];
});

describe('web push (REQ-NOTIF-001)', () => {
  it('a user subscribes this browser, and pushes carry no content, only a link', async () => {
    const user = await insertUser();
    const token = await signIn(app, user);
    expect((await call('GET', '/api/v1/push/key', token)).json()).toEqual({
      publicKey: fake.publicKey,
    });
    const endpoint = `https://push.example.test/${user}`;
    expect(
      (await call('POST', '/api/v1/push/subscriptions', token, subscription(endpoint))).statusCode,
    ).toBe(204);
    // Subscribing again is harmless.
    await call('POST', '/api/v1/push/subscriptions', token, subscription(endpoint));
    const rows = await adminQuery<{ n: string }>(
      'select count(*) as n from push_subscriptions where user_id = $1',
      [user],
    );
    expect(rows[0]?.n).toBe('1');

    await app.get(PushService).deliver({ userIds: [user], link: '/w/x/grades' });
    expect(fake.sent.map((p) => [p.endpoint, p.message.url])).toEqual([[endpoint, '/w/x/grades']]);
    // Generic text only: no notification content goes through the push service.
    expect(fake.sent[0]?.message.body).toContain('You have a new notification');
  });

  it('forgets subscriptions the browser reports gone, and only the owner can remove one', async () => {
    const user = await insertUser();
    const token = await signIn(app, user);
    const gone = `https://push.example.test/gone/${user}`;
    const live = `https://push.example.test/live/${user}`;
    await call('POST', '/api/v1/push/subscriptions', token, subscription(gone));
    await call('POST', '/api/v1/push/subscriptions', token, subscription(live));
    await app.get(PushService).deliver({ userIds: [user], link: null });
    const left = await adminQuery<{ endpoint: string }>(
      'select endpoint from push_subscriptions where user_id = $1',
      [user],
    );
    expect(left.map((r) => r.endpoint)).toEqual([live]);

    const other = await signIn(app, await insertUser());
    await call('POST', '/api/v1/push/subscriptions/remove', other, { endpoint: live });
    expect(
      await adminQuery('select 1 from push_subscriptions where endpoint = $1', [live]),
    ).toHaveLength(1);
    await call('POST', '/api/v1/push/subscriptions/remove', token, { endpoint: live });
    expect(
      await adminQuery('select 1 from push_subscriptions where endpoint = $1', [live]),
    ).toHaveLength(0);
  });

  it('refuses endpoints that are not https', async () => {
    const token = await signIn(app, await insertUser());
    const res = await call(
      'POST',
      '/api/v1/push/subscriptions',
      token,
      subscription('http://push.example.test/x'),
    );
    expect(res.statusCode).toBe(400);
  });

  it('a notification queues its push in the same transaction, and a rollback queues none', async () => {
    const user = await insertUser();
    const count = async () =>
      (
        await adminQuery<{ n: string }>(
          `select count(*) as n from pgboss.job where name = 'notify.push' and data->'userIds' ? $1`,
          [user],
        )
      )[0]?.n;
    const notifications = app.get(NotificationsService);
    const db = app.get(TenantDb);
    await db.transaction((tx) =>
      notifications.notify(tx, { recipientUserId: user, workspaceId: null, type: 'test.push' }),
    );
    expect(await count()).toBe('1');
    await expect(
      db.transaction(async (tx) => {
        await notifications.notify(tx, {
          recipientUserId: user,
          workspaceId: null,
          type: 'test.push',
        });
        throw new Error('roll back');
      }),
    ).rejects.toThrow('roll back');
    expect(await count()).toBe('1');
  });

  it('notifications written through the platform handle queue their push too', async () => {
    const user = await insertUser();
    await app
      .get(PlatformDb)
      .run('test: platform notification', (tx) =>
        app
          .get(NotificationsService)
          .notify(tx, { recipientUserId: user, workspaceId: null, type: 'test.platform' }),
      );
    const [row] = await adminQuery<{ n: string }>(
      `select count(*) as n from pgboss.job where name = 'notify.push' and data->'userIds' ? $1`,
      [user],
    );
    expect(row?.n).toBe('1');
  });
});
