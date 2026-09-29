import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Clock, FixedClock } from '../../src/common';
import { adminQuery, insertMembership, insertUser, insertWorkspace } from '../support/fixtures';
import { createIntegrationApp } from '../support/integration-app';
import { signIn } from '../support/sessions';

const clock = new FixedClock('2026-10-01T08:00:00Z');
let app: NestFastifyApplication;

type ErrorJson = { error: { code: string } };
type Course = {
  id: string;
  title: string;
  lessons: { id: string; title: string; position: number; published: boolean }[];
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
  return { owner, workspaceId, ownerToken, w: `/api/v1/w/${workspaceId}` };
}

beforeAll(async () => {
  app = await createIntegrationApp((builder) => builder.overrideProvider(Clock).useValue(clock));
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  clock.set('2026-10-01T08:00:00Z');
});

describe('courses and lessons (REQ-CONTENT-001, REQ-CONTENT-002)', () => {
  it('creates, orders, publishes and soft-deletes lessons, restorable for 30 days', async () => {
    const s = await setup();
    const course = (
      await call('POST', `${s.w}/courses`, s.ownerToken, { title: 'فيزياء — الترم الأول' })
    ).json<{ id: string }>().id;
    const first = (
      await call('POST', `${s.w}/courses/${course}/lessons`, s.ownerToken, {
        title: 'الحركة في خط مستقيم',
        body: 'السرعة = المسافة ÷ الزمن',
      })
    ).json<{ id: string }>().id;
    const second = (
      await call('POST', `${s.w}/courses/${course}/lessons`, s.ownerToken, { title: 'القوة' })
    ).json<{ id: string }>().id;
    await call('POST', `${s.w}/lessons/${first}/publish`, s.ownerToken);
    await call('POST', `${s.w}/lessons/${second}`, s.ownerToken, { position: 0 });
    await call('POST', `${s.w}/lessons/${first}`, s.ownerToken, { position: 1 });
    let view = (await call('GET', `${s.w}/courses/${course}`, s.ownerToken)).json<Course>();
    expect(view.lessons.map((l) => [l.title, l.published])).toEqual([
      ['القوة', false],
      ['الحركة في خط مستقيم', true],
    ]);

    expect((await call('POST', `${s.w}/lessons/${second}/delete`, s.ownerToken)).statusCode).toBe(
      204,
    );
    view = (await call('GET', `${s.w}/courses/${course}`, s.ownerToken)).json<Course>();
    expect(view.lessons.map((l) => l.id)).toEqual([first]);
    clock.set('2026-10-20T08:00:00Z');
    const ownerToken = await signIn(app, s.owner, { twoFactor: true });
    expect((await call('POST', `${s.w}/lessons/${second}/restore`, ownerToken)).statusCode).toBe(
      204,
    );
    await call('POST', `${s.w}/lessons/${second}/delete`, ownerToken);
    clock.set('2026-11-25T08:00:00Z');
    const later = await signIn(app, s.owner, { twoFactor: true });
    const tooLate = await call('POST', `${s.w}/lessons/${second}/restore`, later);
    expect(tooLate.json<ErrorJson>().error.code).toBe('restore_window_over');
    const audit = await adminQuery<{ action: string }>(
      `select action from audit_log where workspace_id = $1 and action like 'lesson.%'`,
      [s.workspaceId],
    );
    expect(audit.map((a) => a.action)).toContain('lesson.published');
  });

  it('helpers edit only with content.edit, publish only with content.publish, never delete', async () => {
    const s = await setup();
    const course = (await call('POST', `${s.w}/courses`, s.ownerToken, { title: 'كيمياء' })).json<{
      id: string;
    }>().id;
    const lesson = (
      await call('POST', `${s.w}/courses/${course}/lessons`, s.ownerToken, { title: 'الذرة' })
    ).json<{ id: string }>().id;
    const helper = await insertUser();
    const membership = await insertMembership(s.workspaceId, helper, 'assistant');
    const helperToken = await signIn(app, helper);
    expect((await call('GET', `${s.w}/courses`, helperToken)).statusCode).toBe(403);
    await call('PUT', `${s.w}/memberships/${membership}/permissions/content.edit`, s.ownerToken);
    expect(
      (await call('POST', `${s.w}/lessons/${lesson}`, helperToken, { title: 'بنية الذرة' }))
        .statusCode,
    ).toBe(204);
    expect((await call('POST', `${s.w}/lessons/${lesson}/publish`, helperToken)).statusCode).toBe(
      403,
    );
    expect((await call('POST', `${s.w}/lessons/${lesson}/delete`, helperToken)).statusCode).toBe(
      403,
    );
  });

  it('a class teacher edits only courses linked to their classes', async () => {
    const s = await setup();
    const linked = (
      await call('POST', `${s.w}/courses`, s.ownerToken, { title: 'مقرر الفصل' })
    ).json<{ id: string }>().id;
    const other = (await call('POST', `${s.w}/courses`, s.ownerToken, { title: 'مقرر آخر' })).json<{
      id: string;
    }>().id;
    const teacher = await insertUser();
    const teacherMembership = await insertMembership(s.workspaceId, teacher, 'class_teacher');
    await call('POST', `${s.w}/classes`, s.ownerToken, {
      name: 'فصل المعلم',
      responsibleMembershipId: teacherMembership,
      courseId: linked,
    });
    const token = await signIn(app, teacher, { twoFactor: true });
    const list = (await call('GET', `${s.w}/courses`, token)).json<{ courses: { id: string }[] }>();
    expect(list.courses.map((c) => c.id)).toEqual([linked]);
    expect((await call('GET', `${s.w}/courses/${other}`, token)).statusCode).toBe(404);
    // Creating a course needs a workspace-wide grant.
    expect((await call('POST', `${s.w}/courses`, token, { title: 'جديد' })).statusCode).toBe(403);
  });
});

describe('same-course rule (REQ-CLASS-001)', () => {
  it('refuses a second class of the same course unless overridden, and audits the override', async () => {
    const s = await setup();
    const course = (await call('POST', `${s.w}/courses`, s.ownerToken, { title: 'فيزياء' })).json<{
      id: string;
    }>().id;
    const make = async (name: string) =>
      (await call('POST', `${s.w}/classes`, s.ownerToken, { name, courseId: course })).json<{
        id: string;
      }>().id;
    const a = await make('فيزياء — السبت');
    const b = await make('فيزياء — الثلاثاء');
    const student = await insertMembership(s.workspaceId, await insertUser(), 'student');
    await call('POST', `${s.w}/classes/${a}/students`, s.ownerToken, { membershipIds: [student] });
    const refused = await call('POST', `${s.w}/classes/${b}/students`, s.ownerToken, {
      membershipIds: [student],
    });
    expect(refused.json<ErrorJson>().error.code).toBe('same_course_enrolled');
    const forced = await call('POST', `${s.w}/classes/${b}/students`, s.ownerToken, {
      membershipIds: [student],
      override: true,
    });
    expect(forced.json()).toEqual({ added: 1 });
    const [audit] = await adminQuery<{ n: string }>(
      `select count(*) as n from audit_log where workspace_id = $1
          and action = 'class.enrollment_override'`,
      [s.workspaceId],
    );
    expect(audit?.n).toBe('1');
    // Moving between classes of the same course is fine.
    const other = await insertMembership(s.workspaceId, await insertUser(), 'student');
    await call('POST', `${s.w}/classes/${a}/students`, s.ownerToken, { membershipIds: [other] });
    const moved = await call(
      'POST',
      `${s.w}/classes/${a}/students/${other}/transfer`,
      s.ownerToken,
      {
        toClassId: b,
      },
    );
    expect(moved.statusCode).toBe(204);
  });
});
