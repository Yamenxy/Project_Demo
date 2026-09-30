import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminQuery, insertMembership, insertUser, insertWorkspace } from '../support/fixtures';
import { createIntegrationApp } from '../support/integration-app';
import { signIn } from '../support/sessions';

let app: NestFastifyApplication;

type Note = { recipient_user_id: string; type: string; params: Record<string, unknown> };

function call(url: string, token: string, payload?: object) {
  return app.inject({
    method: 'POST',
    url,
    cookies: { lms_session: token },
    ...(payload ? { payload } : {}),
  });
}

async function lesson(workspaceId: string, courseId: string, title: string, published: boolean) {
  const [row] = await adminQuery<{ id: string }>(
    `insert into lessons (workspace_id, id, course_id, title, position, published_at, created_at, updated_at)
     values ($1, gen_random_uuid(), $2, $3, 0, ${published ? 'now()' : 'null'}, now(), now())
     returning id`,
    [workspaceId, courseId, title],
  );
  return row?.id ?? '';
}

async function setup() {
  const owner = await insertUser();
  const workspaceId = await insertWorkspace(owner);
  const ownerToken = await signIn(app, owner, { twoFactor: true });
  const w = `/api/v1/w/${workspaceId}`;
  const [course] = await adminQuery<{ id: string }>(
    `insert into courses (workspace_id, id, title, created_at, updated_at)
     values ($1, gen_random_uuid(), 'كيمياء', now(), now()) returning id`,
    [workspaceId],
  );
  const users = { a: await insertUser(), b: await insertUser(), paused: await insertUser() };
  const members = {
    a: await insertMembership(workspaceId, users.a, 'student'),
    b: await insertMembership(workspaceId, users.b, 'student'),
    paused: await insertMembership(workspaceId, users.paused, 'student'),
  };
  await call(`${w}/access/pause`, ownerToken, { membershipIds: [members.paused], paused: true });
  const group = (await call(`${w}/access-groups`, ownerToken, { name: 'مجموعة الشهر' })).json<{
    id: string;
  }>().id;
  await call(`${w}/access-groups/${group}/members`, ownerToken, {
    add: [members.a, members.paused],
    remove: [],
  });
  return { workspaceId, ownerToken, w, courseId: course?.id ?? '', users, members, group };
}

async function notes(workspaceId: string): Promise<Note[]> {
  return adminQuery<Note>(
    `select recipient_user_id, type, params from notifications
      where workspace_id = $1 and type like 'lesson%' order by created_at`,
    [workspaceId],
  );
}

beforeAll(async () => {
  app = await createIntegrationApp();
});

afterAll(async () => {
  await app.close();
});

describe('lesson notifications (REQ-NOTIF-003)', () => {
  it('publishing notifies only students who can open the lesson now', async () => {
    const s = await setup();
    const id = await lesson(s.workspaceId, s.courseId, 'الروابط الكيميائية', false);
    await call(`${s.w}/access-groups/${s.group}/lessons`, s.ownerToken, { add: [id], remove: [] });
    // Unpublished: adding it to the group opened nothing, so nobody heard.
    expect(await notes(s.workspaceId)).toEqual([]);
    expect((await call(`${s.w}/lessons/${id}/publish`, s.ownerToken)).statusCode).toBe(204);
    expect(await notes(s.workspaceId)).toEqual([
      {
        recipient_user_id: s.users.a,
        type: 'lesson.published',
        params: { title: 'الروابط الكيميائية' },
      },
    ]);
  });

  it('granting ten lessons at once sends one notification, and nothing for a paused student', async () => {
    const s = await setup();
    const ids: string[] = [];
    for (let i = 1; i <= 10; i++)
      ids.push(await lesson(s.workspaceId, s.courseId, `درس ${String(i)}`, true));
    const res = await call(`${s.w}/access/rules`, s.ownerToken, {
      membershipIds: [s.members.b, s.members.paused],
      lessonIds: ids,
      rule: 'grant',
    });
    expect(res.statusCode).toBe(200);
    expect(await notes(s.workspaceId)).toEqual([
      { recipient_user_id: s.users.b, type: 'lessons.available', params: { count: 10 } },
    ]);
    // Granting again opens nothing new.
    await call(`${s.w}/access/rules`, s.ownerToken, {
      membershipIds: [s.members.b],
      lessonIds: ids,
      rule: 'grant',
    });
    expect(await notes(s.workspaceId)).toHaveLength(1);
  });

  it('joining a group notifies once about the lessons it opens; pausing sends nothing', async () => {
    const s = await setup();
    const one = await lesson(s.workspaceId, s.courseId, 'درس المجموعة', true);
    await call(`${s.w}/access-groups/${s.group}/lessons`, s.ownerToken, { add: [one], remove: [] });
    // a (in the group) hears; the paused member doesn't.
    expect((await notes(s.workspaceId)).map((n) => [n.recipient_user_id, n.type])).toEqual([
      [s.users.a, 'lesson.available'],
    ]);
    await call(`${s.w}/access-groups/${s.group}/members`, s.ownerToken, {
      add: [s.members.b],
      remove: [],
    });
    expect((await notes(s.workspaceId)).map((n) => n.recipient_user_id)).toEqual([
      s.users.a,
      s.users.b,
    ]);
    await call(`${s.w}/access/pause`, s.ownerToken, { membershipIds: [s.members.b], paused: true });
    expect(await notes(s.workspaceId)).toHaveLength(2);
  });
});
