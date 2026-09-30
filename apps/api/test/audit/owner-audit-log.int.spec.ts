import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminQuery, insertMembership, insertUser, insertWorkspace } from '../support/fixtures';
import { createIntegrationApp } from '../support/integration-app';
import { signIn } from '../support/sessions';

let app: NestFastifyApplication;

type Page = {
  entries: {
    id: string;
    occurredAt: string;
    action: string;
    actorType: string;
    actorName: string | null;
  }[];
  more: boolean;
};

function get(url: string, token: string) {
  return app.inject({ method: 'GET', url, cookies: { lms_session: token } });
}

/** Inserts `n` audit events a minute apart, the newest first in time order. */
async function events(workspaceId: string, actor: string, action: string, n: number) {
  await adminQuery(
    `insert into audit_log (id, occurred_at, workspace_id, actor_type, actor_user_id, action,
                            personal_context)
     select gen_random_uuid(), now() - (g || ' minutes')::interval, $1, 'user', $2, $3,
            '{"ip": "10.0.0.1"}'
       from generate_series(1, $4::int) g`,
    [workspaceId, actor, action, n],
  );
}

beforeAll(async () => {
  app = await createIntegrationApp();
});

afterAll(async () => {
  await app.close();
});

describe("the owner's audit log (REQ-AUDIT-002)", () => {
  it('shows every event of the workspace, newest first, page by page, without personal context', async () => {
    const owner = await insertUser();
    const workspaceId = await insertWorkspace(owner);
    const token = await signIn(app, owner, { twoFactor: true });
    await events(workspaceId, owner, 'grade.recorded', 40);
    await events(workspaceId, owner, 'access.paused', 20);
    const other = await insertWorkspace(await insertUser());
    await events(other, owner, 'grade.recorded', 5);

    const url = `/api/v1/w/${workspaceId}/audit-log`;
    const first = (await get(url, token)).json<Page>();
    expect(first.entries).toHaveLength(50);
    expect(first.more).toBe(true);
    const times = first.entries.map((e) => Date.parse(e.occurredAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(JSON.stringify(first)).not.toContain('10.0.0.1');
    const last = first.entries.at(-1);
    const second = (
      await get(
        `${url}?beforeAt=${encodeURIComponent(last?.occurredAt ?? '')}&beforeId=${last?.id ?? ''}`,
        token,
      )
    ).json<Page>();
    // Every event of this workspace exactly once (plus the workspace's own setup events).
    const ids = new Set([...first.entries, ...second.entries].map((e) => e.id));
    expect(ids.size).toBe(first.entries.length + second.entries.length);
    expect(second.more).toBe(false);
    const [count] = await adminQuery<{ n: string }>(
      'select count(*) as n from audit_log where workspace_id = $1',
      [workspaceId],
    );
    expect(ids.size).toBe(Number(count?.n));

    const access = (await get(`${url}?area=access`, token)).json<Page>();
    expect(access.entries).toHaveLength(20);
    expect(access.entries.every((e) => e.action.startsWith('access.'))).toBe(true);
  });

  it('is for the owner only', async () => {
    const owner = await insertUser();
    const workspaceId = await insertWorkspace(owner);
    const teacher = await insertUser();
    await insertMembership(workspaceId, teacher, 'class_teacher');
    const res = await get(
      `/api/v1/w/${workspaceId}/audit-log`,
      await signIn(app, teacher, { twoFactor: true }),
    );
    expect(res.statusCode).toBe(403);
  });
});
