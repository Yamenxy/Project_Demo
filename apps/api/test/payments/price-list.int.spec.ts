import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminQuery, insertMembership, insertUser, insertWorkspace } from '../support/fixtures';
import { createIntegrationApp } from '../support/integration-app';
import { signIn } from '../support/sessions';

let app: NestFastifyApplication;

type Item = { id: string; name: string; amountPiastres: number; archived: boolean };

function call(method: 'GET' | 'POST', url: string, token: string, payload?: object) {
  return app.inject({
    method,
    url,
    cookies: { lms_session: token },
    ...(payload ? { payload } : {}),
  });
}

beforeAll(async () => {
  app = await createIntegrationApp();
});

afterAll(async () => {
  await app.close();
});

describe('price list (REQ-PAY-006)', () => {
  it('the owner keeps items in piastres, archives them, and the public page shows active ones', async () => {
    const owner = await insertUser();
    const workspaceId = await insertWorkspace(owner);
    const token = await signIn(app, owner, { twoFactor: true });
    const url = `/api/v1/w/${workspaceId}/price-items`;
    const monthly = (
      await call('POST', url, token, { name: 'اشتراك شهري', amountPiastres: 30000 })
    ).json<{ id: string }>().id;
    const book = (
      await call('POST', url, token, {
        name: 'مذكرة الترم',
        amountPiastres: 12550,
        description: 'نسخة مطبوعة',
      })
    ).json<{ id: string }>().id;
    const items = (await call('GET', url, token)).json<{ items: Item[] }>().items;
    expect(items.map((i) => [i.name, i.amountPiastres])).toEqual([
      ['مذكرة الترم', 12550],
      ['اشتراك شهري', 30000],
    ]);
    expect(
      (await call('POST', url, token, { name: 'كسور', amountPiastres: 10.5 })).statusCode,
    ).toBe(400);

    expect((await call('POST', `${url}/${book}`, token, { archived: true })).statusCode).toBe(204);
    await call('POST', `${url}/${monthly}`, token, { amountPiastres: 35000 });
    const [slug] = await adminQuery<{ slug: string }>('select slug from workspaces where id = $1', [
      workspaceId,
    ]);
    const page = await app.inject({ method: 'GET', url: `/api/v1/public/teachers/${slug?.slug}` });
    expect(page.json<{ prices: unknown[] }>().prices).toEqual([
      { name: 'اشتراك شهري', amountPiastres: 35000, currency: 'EGP', description: null },
    ]);
    const archived = (await call('GET', `${url}?archived=true`, token)).json<{ items: Item[] }>();
    expect(archived.items.map((i) => i.id)).toEqual([book]);
    const audit = await adminQuery<{ action: string }>(
      `select action from audit_log where workspace_id = $1 and action like 'price_item.%'`,
      [workspaceId],
    );
    expect(audit.map((a) => a.action).sort()).toEqual([
      'price_item.archived',
      'price_item.created',
      'price_item.created',
      'price_item.updated',
    ]);
  });

  it('only the owner edits it; the database refuses deletes', async () => {
    const owner = await insertUser();
    const workspaceId = await insertWorkspace(owner);
    const helper = await insertUser();
    await insertMembership(workspaceId, helper, 'assistant');
    const res = await call(
      'POST',
      `/api/v1/w/${workspaceId}/price-items`,
      await signIn(app, helper),
      { name: 'بند', amountPiastres: 100 },
    );
    expect(res.statusCode).toBe(403);
    const [grant] = await adminQuery<{ allowed: boolean }>(
      `select has_table_privilege('app_runtime', 'price_items', 'DELETE') as allowed`,
    );
    expect(grant?.allowed).toBe(false);
  });
});
