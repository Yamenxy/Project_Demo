import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminQuery, insertMembership, insertUser, insertWorkspace } from '../support/fixtures';
import { createIntegrationApp } from '../support/integration-app';
import { signIn } from '../support/sessions';

let app: NestFastifyApplication;

type ErrorJson = { error: { code: string; details?: { reason?: string } } };
type MyLessons = {
  lessons: { lessonId: string; decision: { allowed: boolean; via?: string } }[];
  paused: boolean;
};

function call(method: 'GET' | 'POST' | 'PUT', url: string, token: string, payload?: object) {
  return app.inject({
    method,
    url,
    cookies: { lms_session: token },
    ...(payload ? { payload } : {}),
  });
}

async function setup() {
  const owner = await insertUser();
  const workspaceId = await insertWorkspace(owner);
  const ownerToken = await signIn(app, owner, { twoFactor: true });
  const w = `/api/v1/w/${workspaceId}`;
  const course = (await call('POST', `${w}/courses`, ownerToken, { title: 'فيزياء' })).json<{
    id: string;
  }>().id;
  const lesson = async (title: string, publish = true) => {
    const id = (await call('POST', `${w}/courses/${course}/lessons`, ownerToken, { title })).json<{
      id: string;
    }>().id;
    if (publish) await call('POST', `${w}/lessons/${id}/publish`, ownerToken);
    return id;
  };
  const l1 = await lesson('الدرس الأول');
  const l2 = await lesson('الدرس الثاني');
  const draft = await lesson('مسودة', false);
  const studentUser = await insertUser();
  const student = await insertMembership(workspaceId, studentUser, 'student');
  const studentToken = await signIn(app, studentUser);
  const [name] = await adminQuery<{ name: string }>(
    'select name_ar as name from users where id = $1',
    [studentUser],
  );
  return {
    owner,
    workspaceId,
    ownerToken,
    w,
    course,
    l1,
    l2,
    draft,
    student,
    studentToken,
    studentName: name?.name ?? '',
  };
}

const open = async (s: Awaited<ReturnType<typeof setup>>) =>
  (await call('GET', `${s.w}/my/lessons`, s.studentToken))
    .json<MyLessons>()
    .lessons.map((l) => l.lessonId);

beforeAll(async () => {
  app = await createIntegrationApp();
});

afterAll(async () => {
  await app.close();
});

describe('access (REQ-CONTENT-001, -005 to -010)', () => {
  it('groups and grants open lessons; blocks, pauses and drafts close them', async () => {
    const s = await setup();
    expect(await open(s)).toEqual([]);
    const denied = await call('GET', `${s.w}/lessons/${s.l1}`, s.studentToken);
    expect(denied.statusCode).toBe(403);

    const group = (
      await call('POST', `${s.w}/access-groups`, s.ownerToken, { name: 'مجموعة السبت' })
    ).json<{ id: string }>().id;
    await call('POST', `${s.w}/access-groups/${group}/lessons`, s.ownerToken, {
      add: [s.l1, s.draft],
    });
    await call('POST', `${s.w}/access-groups/${group}/members`, s.ownerToken, { add: [s.student] });
    expect(await open(s)).toEqual([s.l1]); // the draft stays closed even in the group
    const read = await call('GET', `${s.w}/lessons/${s.l1}`, s.studentToken);
    expect(read.json()).toMatchObject({ title: 'الدرس الأول', preview: false });

    // An individual grant for lesson 2; then a block on lesson 1 beats the group.
    const granted = await call('POST', `${s.w}/access/rules`, s.ownerToken, {
      membershipIds: [s.student],
      lessonIds: [s.l2],
      rule: 'grant',
    });
    expect(granted.json()).toEqual({ changed: 1 });
    await call('POST', `${s.w}/access/rules`, s.ownerToken, {
      membershipIds: [s.student],
      lessonIds: [s.l1],
      rule: 'block',
    });
    expect(await open(s)).toEqual([s.l2]);
    const blocked = await call('GET', `${s.w}/lessons/${s.l1}`, s.studentToken);
    expect(blocked.json<ErrorJson>().error.details?.reason).toBe('blocked');

    // Pausing closes everything and keeps groups; resuming brings it back.
    await call('POST', `${s.w}/access/pause`, s.ownerToken, {
      membershipIds: [s.student],
      paused: true,
      reason: 'لم يدفع',
    });
    expect(await open(s)).toEqual([]);
    await call('POST', `${s.w}/access/pause`, s.ownerToken, {
      membershipIds: [s.student],
      paused: false,
    });
    expect(await open(s)).toEqual([s.l2]);

    // Archiving the group removes its effect.
    await call('POST', `${s.w}/access/rules`, s.ownerToken, {
      membershipIds: [s.student],
      lessonIds: [s.l1],
      rule: 'none',
    });
    expect(await open(s)).toEqual([s.l1, s.l2]);
    await call('POST', `${s.w}/access-groups/${group}`, s.ownerToken, { archived: true });
    expect(await open(s)).toEqual([s.l2]);
  });

  it('bulk rules are idempotent and audited once per operation', async () => {
    const s = await setup();
    const other = await insertMembership(s.workspaceId, await insertUser(), 'student');
    const body = { membershipIds: [s.student, other], lessonIds: [s.l1, s.l2], rule: 'grant' };
    expect((await call('POST', `${s.w}/access/rules`, s.ownerToken, body)).json()).toEqual({
      changed: 4,
    });
    expect((await call('POST', `${s.w}/access/rules`, s.ownerToken, body)).json()).toEqual({
      changed: 0,
    });
    const audit = await adminQuery<{ n: string }>(
      `select count(*) as n from audit_log where workspace_id = $1 and action = 'access.rules_granted'`,
      [s.workspaceId],
    );
    expect(audit[0]?.n).toBe('2');
  });

  it('"add all students from class" adds the current students once', async () => {
    const s = await setup();
    const classId = (await call('POST', `${s.w}/classes`, s.ownerToken, { name: 'فصل' })).json<{
      id: string;
    }>().id;
    await call('POST', `${s.w}/classes/${classId}/students`, s.ownerToken, {
      membershipIds: [s.student],
    });
    const group = (
      await call('POST', `${s.w}/access-groups`, s.ownerToken, { name: 'مجموعة' })
    ).json<{
      id: string;
    }>().id;
    expect(
      (
        await call('POST', `${s.w}/access-groups/${group}/add-class`, s.ownerToken, { classId })
      ).json(),
    ).toEqual({ added: 1 });
    // A later enrolment is not added automatically.
    const late = await insertMembership(s.workspaceId, await insertUser(), 'student');
    await call('POST', `${s.w}/classes/${classId}/students`, s.ownerToken, {
      membershipIds: [late],
    });
    const groups = (await call('GET', `${s.w}/access-groups`, s.ownerToken)).json<{
      groups: { members: { membershipId: string }[] }[];
    }>().groups;
    expect(groups[0]?.members.map((m) => m.membershipId)).toEqual([s.student]);
  });

  it('remove from all groups and grants: owner only, typed name, blocks kept', async () => {
    const s = await setup();
    const group = (
      await call('POST', `${s.w}/access-groups`, s.ownerToken, { name: 'مجموعة' })
    ).json<{
      id: string;
    }>().id;
    await call('POST', `${s.w}/access-groups/${group}/members`, s.ownerToken, { add: [s.student] });
    await call('POST', `${s.w}/access/rules`, s.ownerToken, {
      membershipIds: [s.student],
      lessonIds: [s.l1],
      rule: 'grant',
    });
    await call('POST', `${s.w}/access/rules`, s.ownerToken, {
      membershipIds: [s.student],
      lessonIds: [s.l2],
      rule: 'block',
    });
    const url = `${s.w}/access/students/${s.student}/remove-all`;
    expect(
      (await call('POST', url, s.ownerToken, { confirmation: 'اسم خطأ' })).json<ErrorJson>().error
        .code,
    ).toBe('confirmation_mismatch');
    expect((await call('POST', url, s.ownerToken, { confirmation: s.studentName })).json()).toEqual(
      {
        groups: 1,
        grants: 1,
      },
    );
    const view = (await call('GET', `${s.w}/access/students/${s.student}`, s.ownerToken)).json<{
      groups: unknown[];
      rules: { kind: string }[];
    }>();
    expect(view.groups).toEqual([]);
    expect(view.rules.map((r) => r.kind)).toEqual(['block']);
  });

  it('staff preview drafts with content.edit; helpers need the right access keys', async () => {
    const s = await setup();
    const preview = await call('GET', `${s.w}/lessons/${s.draft}`, s.ownerToken);
    expect(preview.json()).toMatchObject({ title: 'مسودة', preview: true });
    const helper = await insertUser();
    const membership = await insertMembership(s.workspaceId, helper, 'assistant');
    const helperToken = await signIn(app, helper);
    expect(
      (
        await call('POST', `${s.w}/access/rules`, helperToken, {
          membershipIds: [s.student],
          lessonIds: [s.l1],
          rule: 'grant',
        })
      ).statusCode,
    ).toBe(403);
    await call('PUT', `${s.w}/memberships/${membership}/permissions/access.grants`, s.ownerToken);
    expect(
      (
        await call('POST', `${s.w}/access/rules`, helperToken, {
          membershipIds: [s.student],
          lessonIds: [s.l1],
          rule: 'grant',
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await call('POST', `${s.w}/access-groups`, helperToken, { name: 'مجموعة' })).statusCode,
    ).toBe(403);
  });
});
