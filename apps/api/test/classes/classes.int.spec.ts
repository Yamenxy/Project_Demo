import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminQuery, insertMembership, insertUser, insertWorkspace } from '../support/fixtures';
import { createIntegrationApp } from '../support/integration-app';
import { signIn } from '../support/sessions';

let app: NestFastifyApplication;

type ErrorJson = { error: { code: string } };
type ClassJson = {
  id: string;
  name: string;
  responsible: { membershipId: string };
  studentCount: number;
  students: { membershipId: string }[];
};

function call(method: 'GET' | 'POST', url: string, token: string, payload?: object) {
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
  const teacher = await insertUser();
  const teacherMembership = await insertMembership(workspaceId, teacher, 'class_teacher');
  const teacherToken = await signIn(app, teacher, { twoFactor: true });
  const base = `/api/v1/w/${workspaceId}/classes`;
  return { owner, workspaceId, ownerToken, teacherMembership, teacherToken, base };
}

async function createClass(base: string, token: string, payload: object): Promise<string> {
  return (await call('POST', base, token, payload)).json<{ id: string }>().id;
}

beforeAll(async () => {
  app = await createIntegrationApp();
});

afterAll(async () => {
  await app.close();
});

describe('classes (REQ-CLASS-001)', () => {
  it('the owner creates classes and assigns a class teacher, who sees only their own', async () => {
    const s = await setup();
    const mine = await call('POST', s.base, s.ownerToken, { name: 'الصف الثالث — مجموعة أ' });
    expect(mine.statusCode).toBe(201);
    const theirs = await createClass(s.base, s.ownerToken, {
      name: 'الصف الثالث — مجموعة ب',
      responsibleMembershipId: s.teacherMembership,
    });
    const duplicate = await call('POST', s.base, s.ownerToken, { name: 'الصف الثالث — مجموعة أ' });
    expect(duplicate.json<ErrorJson>().error.code).toBe('class_name_taken');

    const ownerList = (await call('GET', s.base, s.ownerToken)).json<{ classes: ClassJson[] }>();
    expect(ownerList.classes).toHaveLength(2);
    const teacherList = (await call('GET', s.base, s.teacherToken)).json<{
      classes: ClassJson[];
    }>();
    expect(teacherList.classes.map((c) => c.id)).toEqual([theirs]);
    const otherId = ownerList.classes.find((c) => c.id !== theirs)?.id ?? '';
    expect((await call('GET', `${s.base}/${otherId}`, s.teacherToken)).statusCode).toBe(404);

    // Only the owner or a class teacher can be responsible; class teachers can't create classes.
    const helper = await insertMembership(s.workspaceId, await insertUser(), 'assistant');
    const invalid = await call('POST', s.base, s.ownerToken, {
      name: 'مجموعة ج',
      responsibleMembershipId: helper,
    });
    expect(invalid.json<ErrorJson>().error.code).toBe('invalid_responsible');
    expect((await call('POST', s.base, s.teacherToken, { name: 'مجموعة د' })).statusCode).toBe(403);
  });

  it('enrols, removes and transfers students, keeping history', async () => {
    const s = await setup();
    const a = await createClass(s.base, s.ownerToken, { name: 'مجموعة السبت' });
    const b = await createClass(s.base, s.ownerToken, { name: 'مجموعة الأحد' });
    const s1 = await insertMembership(s.workspaceId, await insertUser(), 'student');
    const s2 = await insertMembership(s.workspaceId, await insertUser(), 'student');

    const enrolled = await call('POST', `${s.base}/${a}/students`, s.ownerToken, {
      membershipIds: [s1, s2, s1],
    });
    expect(enrolled.json()).toEqual({ added: 2 });
    const again = await call('POST', `${s.base}/${a}/students`, s.ownerToken, {
      membershipIds: [s1],
    });
    expect(again.json()).toEqual({ added: 0 });

    // A staff member can't be enrolled.
    const staff = await insertMembership(s.workspaceId, await insertUser(), 'assistant');
    const refused = await call('POST', `${s.base}/${a}/students`, s.ownerToken, {
      membershipIds: [staff],
    });
    expect(refused.statusCode).toBe(404);

    const moved = await call('POST', `${s.base}/${a}/students/${s1}/transfer`, s.ownerToken, {
      toClassId: b,
    });
    expect(moved.statusCode).toBe(204);
    const removed = await call('POST', `${s.base}/${a}/students/${s2}/remove`, s.ownerToken);
    expect(removed.statusCode).toBe(204);

    const classA = (await call('GET', `${s.base}/${a}`, s.ownerToken)).json<ClassJson>();
    expect(classA.students).toEqual([]);
    const classB = (await call('GET', `${s.base}/${b}`, s.ownerToken)).json<ClassJson>();
    expect(classB.students.map((x) => x.membershipId)).toEqual([s1]);
    const history = await adminQuery<{ class_id: string; end_reason: string | null }>(
      `select class_id, end_reason from class_enrollments where membership_id = $1
        order by enrolled_at`,
      [s1],
    );
    expect(history).toEqual([
      { class_id: a, end_reason: 'transferred' },
      { class_id: b, end_reason: null },
    ]);
    const audit = await adminQuery<{ action: string }>(
      `select action from audit_log where workspace_id = $1 and action like 'class.%'
        order by occurred_at`,
      [s.workspaceId],
    );
    expect(audit.map((x) => x.action)).toEqual([
      'class.created',
      'class.created',
      'class.student_enrolled',
      'class.student_enrolled',
      'class.student_transferred',
      'class.student_removed',
    ]);
  });

  it('archived classes are hidden, take no new students, and can be restored', async () => {
    const s = await setup();
    const c = await createClass(s.base, s.ownerToken, { name: 'مجموعة قديمة' });
    const archived = await call('POST', `${s.base}/${c}`, s.ownerToken, { archived: true });
    expect(archived.statusCode).toBe(204);
    const list = (await call('GET', s.base, s.ownerToken)).json<{ classes: unknown[] }>();
    expect(list.classes).toHaveLength(0);
    const student = await insertMembership(s.workspaceId, await insertUser(), 'student');
    const refused = await call('POST', `${s.base}/${c}/students`, s.ownerToken, {
      membershipIds: [student],
    });
    expect(refused.json<ErrorJson>().error.code).toBe('class_archived');
    await call('POST', `${s.base}/${c}`, s.ownerToken, { archived: false });
    const restored = (await call('GET', s.base, s.ownerToken)).json<{ classes: unknown[] }>();
    expect(restored.classes).toHaveLength(1);
  });

  it('a class teacher manages students only in their own classes', async () => {
    const s = await setup();
    const own = await createClass(s.base, s.ownerToken, {
      name: 'فصل المعلم',
      responsibleMembershipId: s.teacherMembership,
    });
    const other = await createClass(s.base, s.ownerToken, { name: 'فصل المالك' });
    const student = await insertMembership(s.workspaceId, await insertUser(), 'student');
    const body = { membershipIds: [student] };
    expect((await call('POST', `${s.base}/${own}/students`, s.teacherToken, body)).statusCode).toBe(
      200,
    );
    expect(
      (await call('POST', `${s.base}/${other}/students`, s.teacherToken, body)).statusCode,
    ).toBe(404);
    const transfer = await call(
      'POST',
      `${s.base}/${own}/students/${student}/transfer`,
      s.teacherToken,
      { toClassId: other },
    );
    expect(transfer.statusCode).toBe(404);
  });
});
