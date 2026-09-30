import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminQuery, insertMembership, insertUser, insertWorkspace } from '../support/fixtures';
import { createIntegrationApp } from '../support/integration-app';
import { signIn } from '../support/sessions';

let app: NestFastifyApplication;

type ErrorJson = { error: { code: string } };
type Gradebook = {
  items: { id: string; classAverage: number | null; released: boolean }[];
  students: {
    membershipId: string;
    enrolled: boolean;
    scores: Record<string, number | null>;
    average: number | null;
  }[];
};
type MyGrades = {
  classes: {
    className: string;
    items: { title: string; score: number | null }[];
    average: number | null;
  }[];
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
  const w = `/api/v1/w/${workspaceId}`;
  const classId = (await call('POST', `${w}/classes`, ownerToken, { name: 'فصل أ' })).json<{
    id: string;
  }>().id;
  const studentUser = await insertUser();
  const student = await insertMembership(workspaceId, studentUser, 'student');
  const other = await insertMembership(workspaceId, await insertUser(), 'student');
  await call('POST', `${w}/classes/${classId}/students`, ownerToken, {
    membershipIds: [student, other],
  });
  const studentToken = await signIn(app, studentUser);
  return { owner, workspaceId, ownerToken, w, classId, student, studentUser, other, studentToken };
}

beforeAll(async () => {
  app = await createIntegrationApp();
});

afterAll(async () => {
  await app.close();
});

describe('gradebook (REQ-GRADE-001 to -003)', () => {
  it('enters scores in bulk, averages them, and hides them from students until released', async () => {
    const s = await setup();
    const item = (
      await call('POST', `${s.w}/classes/${s.classId}/grade-items`, s.ownerToken, {
        title: 'امتحان ورقي 1',
        maxScore: 20,
      })
    ).json<{ id: string }>().id;
    const saved = await call('POST', `${s.w}/grade-items/${item}/scores`, s.ownerToken, {
      scores: [
        { membershipId: s.student, score: 17.5 },
        { membershipId: s.other, score: null },
      ],
    });
    expect(saved.json()).toEqual({ changed: 2 });
    const tooHigh = await call('POST', `${s.w}/grade-items/${item}/scores`, s.ownerToken, {
      scores: [{ membershipId: s.student, score: 21 }],
    });
    expect(tooHigh.json<ErrorJson>().error.code).toBe('score_out_of_range');

    const book = (
      await call('GET', `${s.w}/classes/${s.classId}/gradebook`, s.ownerToken)
    ).json<Gradebook>();
    const row = book.students.find((x) => x.membershipId === s.student);
    expect(row?.scores[item]).toBe(17.5);
    expect(row?.average).toBe(87.5);
    expect(book.items[0]?.classAverage).toBe(87.5); // absent isn't counted

    // Unreleased: invisible to the student.
    expect(
      (await call('GET', `${s.w}/my/grades`, s.studentToken)).json<MyGrades>().classes,
    ).toEqual([]);
    await call('POST', `${s.w}/grade-items/${item}/release`, s.ownerToken, { released: true });
    const mine = (await call('GET', `${s.w}/my/grades`, s.studentToken)).json<MyGrades>();
    expect(mine.classes[0]?.items).toEqual([
      expect.objectContaining({ title: 'امتحان ورقي 1', score: 17.5 }),
    ]);
    expect(JSON.stringify(mine)).not.toContain(s.other);
    // One notification per student with a score; releasing again sends nothing more.
    await call('POST', `${s.w}/grade-items/${item}/release`, s.ownerToken, { released: true });
    const notes = await adminQuery<{ recipient_user_id: string; params: { title: string } }>(
      `select recipient_user_id, params from notifications
        where workspace_id = $1 and type = 'grades.released'`,
      [s.workspaceId],
    );
    expect(notes).toEqual([
      { recipient_user_id: s.studentUser, params: { title: 'امتحان ورقي 1' } },
    ]);
  });

  it('after release, a change needs a reason and every change keeps old and new values', async () => {
    const s = await setup();
    const item = (
      await call('POST', `${s.w}/classes/${s.classId}/grade-items`, s.ownerToken, {
        title: 'كويز',
        maxScore: 10,
      })
    ).json<{ id: string }>().id;
    await call('POST', `${s.w}/grade-items/${item}/scores`, s.ownerToken, {
      scores: [{ membershipId: s.student, score: 6 }],
    });
    await call('POST', `${s.w}/grade-items/${item}/release`, s.ownerToken, { released: true });
    const noReason = await call('POST', `${s.w}/grade-items/${item}/scores`, s.ownerToken, {
      scores: [{ membershipId: s.student, score: 7 }],
    });
    expect(noReason.json<ErrorJson>().error.code).toBe('reason_required');
    await call('POST', `${s.w}/grade-items/${item}/scores`, s.ownerToken, {
      scores: [{ membershipId: s.student, score: 7 }],
      reason: 'خطأ في الجمع',
    });
    const history = (await call('GET', `${s.w}/grade-items/${item}/history`, s.ownerToken)).json<{
      changes: { oldScore: number | null; newScore: number | null; reason: string | null }[];
    }>().changes;
    expect(history.map((h) => [h.oldScore, h.newScore, h.reason])).toEqual([
      [null, 6, null],
      [6, 7, 'خطأ في الجمع'],
    ]);
    const [audit] = await adminQuery<{ n: string }>(
      `select count(*) as n from audit_log where workspace_id = $1 and action = 'grade.changed_after_release'`,
      [s.workspaceId],
    );
    expect(audit?.n).toBe('1');
    const [privileges] = await adminQuery<{ upd: boolean }>(
      `select has_table_privilege('app_runtime', 'grade_changes', 'UPDATE') as upd`,
    );
    expect(privileges?.upd).toBe(false);
  });

  it('a transferred student keeps old scores in the old class, and sees every class', async () => {
    const s = await setup();
    const b = (await call('POST', `${s.w}/classes`, s.ownerToken, { name: 'فصل ب' })).json<{
      id: string;
    }>().id;
    const item = (
      await call('POST', `${s.w}/classes/${s.classId}/grade-items`, s.ownerToken, {
        title: 'امتحان أ',
        maxScore: 10,
      })
    ).json<{ id: string }>().id;
    await call('POST', `${s.w}/grade-items/${item}/scores`, s.ownerToken, {
      scores: [{ membershipId: s.student, score: 9 }],
    });
    await call('POST', `${s.w}/grade-items/${item}/release`, s.ownerToken, { released: true });
    await call('POST', `${s.w}/classes/${s.classId}/students/${s.student}/transfer`, s.ownerToken, {
      toClassId: b,
    });
    const itemB = (
      await call('POST', `${s.w}/classes/${b}/grade-items`, s.ownerToken, {
        title: 'امتحان ب',
        maxScore: 10,
      })
    ).json<{ id: string }>().id;
    await call('POST', `${s.w}/grade-items/${itemB}/scores`, s.ownerToken, {
      scores: [{ membershipId: s.student, score: 5 }],
    });
    await call('POST', `${s.w}/grade-items/${itemB}/release`, s.ownerToken, { released: true });

    const old = (
      await call('GET', `${s.w}/classes/${s.classId}/gradebook`, s.ownerToken)
    ).json<Gradebook>();
    expect(old.students.find((x) => x.membershipId === s.student)).toMatchObject({
      enrolled: false,
      scores: { [item]: 9 },
    });
    const mine = (await call('GET', `${s.w}/my/grades`, s.studentToken)).json<MyGrades>();
    expect(mine.classes.map((c) => [c.className, c.average])).toEqual([
      ['فصل أ', 90],
      ['فصل ب', 50],
    ]);
  });

  it('helpers need grading.grade for the class; releasing needs grading.release', async () => {
    const s = await setup();
    const item = (
      await call('POST', `${s.w}/classes/${s.classId}/grade-items`, s.ownerToken, {
        title: 'كويز',
        maxScore: 10,
      })
    ).json<{ id: string }>().id;
    const helper = await insertUser();
    const membership = await insertMembership(s.workspaceId, helper, 'assistant');
    const token = await signIn(app, helper);
    expect((await call('GET', `${s.w}/classes/${s.classId}/gradebook`, token)).statusCode).toBe(
      403,
    );
    await adminQuery(
      `insert into permission_grants (workspace_id, id, membership_id, permission, granted_by, created_at)
       values ($1, gen_random_uuid(), $2, 'grading.grade', $3, now())`,
      [s.workspaceId, membership, s.owner],
    );
    expect(
      (
        await call('POST', `${s.w}/grade-items/${item}/scores`, token, {
          scores: [{ membershipId: s.student, score: 8 }],
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await call('POST', `${s.w}/grade-items/${item}/release`, token, { released: true }))
        .statusCode,
    ).toBe(403);
  });
});
