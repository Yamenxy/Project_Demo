import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminQuery, insertMembership, insertUser, insertWorkspace } from '../support/fixtures';
import { createIntegrationApp } from '../support/integration-app';
import { signIn } from '../support/sessions';

let app: NestFastifyApplication;

type ErrorJson = { error: { code: string } };

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
  const create = async (name: string) =>
    (await call('POST', `${w}/classes`, ownerToken, { name })).json<{ id: string }>().id;
  const a = await create('فصل أ');
  const b = await create('فصل ب');
  const inA = await insertMembership(workspaceId, await insertUser(), 'student');
  const inB = await insertMembership(workspaceId, await insertUser(), 'student');
  await call('POST', `${w}/classes/${a}/students`, ownerToken, { membershipIds: [inA] });
  await call('POST', `${w}/classes/${b}/students`, ownerToken, { membershipIds: [inB] });
  const helper = await insertUser();
  const helperMembership = await insertMembership(workspaceId, helper, 'assistant');
  const helperToken = await signIn(app, helper);
  return { workspaceId, ownerToken, w, a, b, inA, inB, helperMembership, helperToken };
}

beforeAll(async () => {
  app = await createIntegrationApp();
});

afterAll(async () => {
  await app.close();
});

describe('class-scoped grants (REQ-RBAC-001, REQ-RBAC-002)', () => {
  it('a helper limited to class A sees and manages only class A and its students', async () => {
    const s = await setup();
    const granted = await call(
      'PUT',
      `${s.w}/memberships/${s.helperMembership}/permissions/enrollment.manage`,
      s.ownerToken,
      { classIds: [s.a] },
    );
    expect(granted.statusCode).toBe(204);

    const classes = (await call('GET', `${s.w}/classes`, s.helperToken)).json<{
      classes: { id: string }[];
    }>();
    expect(classes.classes.map((c) => c.id)).toEqual([s.a]);
    const students = (await call('GET', `${s.w}/students`, s.helperToken)).json<{
      students: { membershipId: string }[];
    }>();
    expect(students.students.map((x) => x.membershipId)).toEqual([s.inA]);

    // Class B and its students are out of reach.
    expect((await call('GET', `${s.w}/classes/${s.b}`, s.helperToken)).statusCode).toBe(404);
    const enrolB = await call('POST', `${s.w}/classes/${s.b}/students`, s.helperToken, {
      membershipIds: [s.inA],
    });
    expect(enrolB.statusCode).toBe(404);
    const moveToB = await call(
      'POST',
      `${s.w}/classes/${s.a}/students/${s.inA}/transfer`,
      s.helperToken,
      { toClassId: s.b },
    );
    expect(moveToB.statusCode).toBe(404);

    // Workspace-wide actions need a workspace-wide grant.
    const managed = await call('POST', `${s.w}/students`, s.helperToken, {
      name: 'طالب جديد',
      phone: '01012345670',
    });
    expect(managed.statusCode).toBe(403);
    expect(
      (await call('GET', `${s.w}/summary`, s.helperToken)).json<{ students: unknown }>().students,
    ).toBeNull();

    // Adding a new student to class A works through the candidate search (names only).
    const candidates = (
      await call(
        'GET',
        `${s.w}/classes/${s.a}/candidates?q=${encodeURIComponent('مستخدم')}`,
        s.helperToken,
      )
    ).json<{ students: { membershipId: string; phoneE164?: string }[] }>();
    expect(candidates.students.map((c) => c.membershipId)).toContain(s.inB);
    expect(JSON.stringify(candidates)).not.toContain('+20');
    const enrolled = await call('POST', `${s.w}/classes/${s.a}/students`, s.helperToken, {
      membershipIds: [s.inB],
    });
    expect(enrolled.json()).toEqual({ added: 1 });
  });

  it('re-granting changes the classes, and a workspace-wide grant sees everything', async () => {
    const s = await setup();
    const url = `${s.w}/memberships/${s.helperMembership}/permissions/enrollment.manage`;
    await call('PUT', url, s.ownerToken, { classIds: [s.a] });
    await call('PUT', url, s.ownerToken, { classIds: [s.b] });
    let classes = (await call('GET', `${s.w}/classes`, s.helperToken)).json<{
      classes: { id: string }[];
    }>();
    expect(classes.classes.map((c) => c.id)).toEqual([s.b]);
    await call('PUT', url, s.ownerToken);
    classes = (await call('GET', `${s.w}/classes`, s.helperToken)).json<{
      classes: { id: string }[];
    }>();
    expect(classes.classes).toHaveLength(2);
    const audit = await adminQuery<{ action: string }>(
      `select action from audit_log where workspace_id = $1 and action like 'permission.%'
        order by occurred_at`,
      [s.workspaceId],
    );
    expect(audit.map((x) => x.action)).toEqual([
      'permission.granted',
      'permission.scope_changed',
      'permission.scope_changed',
    ]);
  });

  it('refuses class scopes on workspace-only keys, for class teachers, and for unknown classes', async () => {
    const s = await setup();
    const importScoped = await call(
      'PUT',
      `${s.w}/memberships/${s.helperMembership}/permissions/students.import`,
      s.ownerToken,
      { classIds: [s.a] },
    );
    expect(importScoped.json<ErrorJson>().error.code).toBe('permission_not_class_scoped');
    const teacher = await insertMembership(s.workspaceId, await insertUser(), 'class_teacher');
    const teacherScoped = await call(
      'PUT',
      `${s.w}/memberships/${teacher}/permissions/payments.record`,
      s.ownerToken,
      { classIds: [s.a] },
    );
    expect(teacherScoped.json<ErrorJson>().error.code).toBe('permission_not_class_scoped');
    const other = await insertWorkspace(await insertUser());
    const [foreign] = await adminQuery<{ id: string }>(
      `insert into classes (workspace_id, id, name, responsible_membership_id, created_at, updated_at)
       values ($1, gen_random_uuid(), 'فصل آخر',
               (select id from memberships where workspace_id = $1 and role = 'owner'), now(), now())
       returning id`,
      [other],
    );
    const foreignScoped = await call(
      'PUT',
      `${s.w}/memberships/${s.helperMembership}/permissions/attendance.mark`,
      s.ownerToken,
      { classIds: [foreign?.id] },
    );
    expect(foreignScoped.statusCode).toBe(404);
  });

  it('a class teacher sees only the students of their classes', async () => {
    const s = await setup();
    const teacher = await insertUser();
    const teacherMembership = await insertMembership(s.workspaceId, teacher, 'class_teacher');
    await call('POST', `${s.w}/classes/${s.a}`, s.ownerToken, {
      responsibleMembershipId: teacherMembership,
    });
    const token = await signIn(app, teacher, { twoFactor: true });
    const students = (await call('GET', `${s.w}/students`, token)).json<{
      students: { membershipId: string }[];
    }>();
    expect(students.students.map((x) => x.membershipId)).toEqual([s.inA]);
  });
});
