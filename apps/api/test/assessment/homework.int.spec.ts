import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Clock, FixedClock } from '../../src/common';
import { FilesService } from '../../src/modules/files';
import {
  adminQuery,
  grantConsent,
  insertMembership,
  insertUser,
  insertWorkspace,
} from '../support/fixtures';
import { createIntegrationApp } from '../support/integration-app';
import { signIn } from '../support/sessions';

const clock = new FixedClock('2026-10-01T09:00:00Z');
let app: NestFastifyApplication;

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');

type ErrorJson = { error: { code: string } };
type MyHomework = {
  id: string;
  canSubmit: boolean;
  submissions: {
    id: string;
    number: number;
    late: boolean;
    score: number | null;
    feedback: string | null;
  }[];
};
type Submission = {
  id: string;
  membershipId: string;
  number: number;
  late: boolean;
  score: number | null;
};

function call(method: 'GET' | 'POST', url: string, token: string, payload?: object) {
  return app.inject({
    method,
    url,
    cookies: { lms_session: token },
    ...(payload ? { payload } : {}),
  });
}

async function setup(extra: Record<string, unknown> = {}) {
  const owner = await insertUser();
  const workspaceId = await insertWorkspace(owner);
  const ownerToken = await signIn(app, owner, { twoFactor: true });
  const w = `/api/v1/w/${workspaceId}`;
  const course = (await call('POST', `${w}/courses`, ownerToken, { title: 'فيزياء' })).json<{
    id: string;
  }>().id;
  const classId = (
    await call('POST', `${w}/classes`, ownerToken, { name: 'فصل', courseId: course })
  ).json<{ id: string }>().id;
  const studentUser = await insertUser();
  const student = await insertMembership(workspaceId, studentUser, 'student');
  await grantConsent(studentUser);
  const outsiderUser = await insertUser();
  await insertMembership(workspaceId, outsiderUser, 'student');
  await call('POST', `${w}/classes/${classId}/students`, ownerToken, { membershipIds: [student] });
  const created = await call('POST', `${w}/courses/${course}/homework`, ownerToken, {
    title: 'واجب الوحدة الأولى',
    instructions: 'حل المسائل من 1 إلى 5',
    dueAt: '2026-10-02T21:00:00Z',
    maxScore: 10,
    classIds: [classId],
    ...extra,
  });
  expect(created.statusCode).toBe(201);
  const homework = created.json<{ id: string }>().id;
  return {
    workspaceId,
    ownerToken,
    w,
    course,
    classId,
    student,
    studentUser,
    homework,
    studentToken: await signIn(app, studentUser),
    outsiderToken: await signIn(app, outsiderUser),
  };
}

async function mine(s: { w: string }, token: string): Promise<MyHomework[]> {
  return (await call('GET', `${s.w}/my/homework`, token)).json<{ homework: MyHomework[] }>()
    .homework;
}

beforeAll(async () => {
  app = await createIntegrationApp((builder) => builder.overrideProvider(Clock).useValue(clock));
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  clock.set('2026-10-01T09:00:00Z');
});

describe('homework (REQ-HW-001, REQ-HW-002)', () => {
  it('runs submit, file, grade and release end to end; scores stay hidden until release', async () => {
    const s = await setup();
    // Unpublished homework is invisible and can't be submitted.
    expect(await mine(s, s.studentToken)).toEqual([]);
    expect(
      (await call('POST', `${s.w}/my/homework/${s.homework}/submissions`, s.studentToken, {}))
        .statusCode,
    ).toBe(404);
    await call('POST', `${s.w}/homework/${s.homework}/publish`, s.ownerToken, { published: true });
    expect(await mine(s, s.studentToken)).toEqual([
      expect.objectContaining({ id: s.homework, canSubmit: true, submissions: [] }),
    ]);

    const sub = await call('POST', `${s.w}/my/homework/${s.homework}/submissions`, s.studentToken, {
      text: 'الحل في الملف',
    });
    expect(sub.statusCode).toBe(201);
    const { id: submissionId, late } = sub.json<{ id: string; late: boolean }>();
    expect(late).toBe(false);

    // A file on the student's own submission; staff who grade can read it.
    const up = await app.inject({
      method: 'POST',
      url: `${s.w}/homework-submissions/${submissionId}/files?name=${encodeURIComponent('حل.pdf')}`,
      cookies: { lms_session: s.studentToken },
      headers: { 'content-type': 'application/octet-stream' },
      payload: PDF,
    });
    expect(up.statusCode).toBe(201);
    const fileId = up.json<{ id: string }>().id;
    await app.get(FilesService).scan(s.workspaceId, fileId);
    expect((await call('GET', `${s.w}/files/${fileId}`, s.ownerToken)).statusCode).toBe(200);
    expect((await call('GET', `${s.w}/files/${fileId}`, s.studentToken)).statusCode).toBe(200);
    expect((await call('GET', `${s.w}/files/${fileId}`, s.outsiderToken)).statusCode).toBe(404);

    // No resubmission by default.
    const again = await call(
      'POST',
      `${s.w}/my/homework/${s.homework}/submissions`,
      s.studentToken,
      {},
    );
    expect(again.json<ErrorJson>().error.code).toBe('no_resubmission');

    const listed = (
      await call('GET', `${s.w}/homework/${s.homework}/submissions`, s.ownerToken)
    ).json<{ submissions: Submission[] }>().submissions;
    expect(listed).toEqual([
      expect.objectContaining({ id: submissionId, membershipId: s.student }),
    ]);
    const tooHigh = await call(
      'POST',
      `${s.w}/homework-submissions/${submissionId}/grade`,
      s.ownerToken,
      {
        score: 11,
      },
    );
    expect(tooHigh.json<ErrorJson>().error.code).toBe('score_out_of_range');
    expect(
      (
        await call('POST', `${s.w}/homework-submissions/${submissionId}/grade`, s.ownerToken, {
          score: 8.5,
          feedback: 'أحسنت',
        })
      ).statusCode,
    ).toBe(204);
    // Graded, not released: the student sees neither score nor feedback.
    expect((await mine(s, s.studentToken))[0]?.submissions[0]).toMatchObject({
      score: null,
      feedback: null,
    });
    // A graded submission takes no more files.
    const afterGrade = await app.inject({
      method: 'POST',
      url: `${s.w}/homework-submissions/${submissionId}/files?name=x.pdf`,
      cookies: { lms_session: s.studentToken },
      headers: { 'content-type': 'application/octet-stream' },
      payload: PDF,
    });
    expect(afterGrade.statusCode).toBe(404);

    expect(
      (await call('POST', `${s.w}/homework/${s.homework}/release`, s.ownerToken)).statusCode,
    ).toBe(204);
    expect((await mine(s, s.studentToken))[0]?.submissions[0]).toMatchObject({
      score: 8.5,
      feedback: 'أحسنت',
    });
    const grades = (await call('GET', `${s.w}/my/grades`, s.studentToken)).json<{
      classes: { items: { title: string; score: number | null }[] }[];
    }>();
    expect(grades.classes[0]?.items).toEqual([
      expect.objectContaining({ title: 'واجب الوحدة الأولى', score: 8.5 }),
    ]);
    const audit = await adminQuery<{ action: string }>(
      `select action from audit_log where workspace_id = $1 and action like 'homework.%' order by action`,
      [s.workspaceId],
    );
    expect(audit.map((a) => a.action)).toEqual([
      'homework.created',
      'homework.graded',
      'homework.published',
      'homework.results_released',
      'homework.submitted',
    ]);
  });

  it('flags late work, or rejects it, by the homework policy; one resubmission if allowed', async () => {
    const flagged = await setup({ allowResubmission: true });
    await call('POST', `${flagged.w}/homework/${flagged.homework}/publish`, flagged.ownerToken, {
      published: true,
    });
    const url = `${flagged.w}/my/homework/${flagged.homework}/submissions`;
    expect((await call('POST', url, flagged.studentToken, { text: 'أولى' })).statusCode).toBe(201);
    clock.set('2026-10-03T09:00:00Z');
    const token = await signIn(app, flagged.studentUser);
    const second = await call('POST', url, token, { text: 'ثانية' });
    expect(second.json()).toMatchObject({ late: true });
    expect((await call('POST', url, token, {})).json<ErrorJson>().error.code).toBe(
      'no_resubmission',
    );
    expect((await mine(flagged, token))[0]).toMatchObject({ canSubmit: false });

    clock.set('2026-10-01T09:00:00Z');
    const strict = await setup({ latePolicy: 'reject' });
    await call('POST', `${strict.w}/homework/${strict.homework}/publish`, strict.ownerToken, {
      published: true,
    });
    clock.set('2026-10-03T09:00:00Z');
    const strictToken = await signIn(app, strict.studentUser);
    const refused = await call(
      'POST',
      `${strict.w}/my/homework/${strict.homework}/submissions`,
      strictToken,
      {},
    );
    expect(refused.json<ErrorJson>().error.code).toBe('homework_closed');
  });

  it('only enrolled, unpaused students of a target class may submit (REQ-HW-002)', async () => {
    const s = await setup();
    await call('POST', `${s.w}/homework/${s.homework}/publish`, s.ownerToken, { published: true });
    expect(await mine(s, s.outsiderToken)).toEqual([]);
    const outsider = await call(
      'POST',
      `${s.w}/my/homework/${s.homework}/submissions`,
      s.outsiderToken,
      {},
    );
    expect(outsider.statusCode).toBe(404);

    await call('POST', `${s.w}/access/pause`, s.ownerToken, {
      membershipIds: [s.student],
      paused: true,
    });
    const paused = await call(
      'POST',
      `${s.w}/my/homework/${s.homework}/submissions`,
      s.studentToken,
      {},
    );
    expect(paused.json<ErrorJson>().error.code).toBe('homework_unavailable');
    expect((await mine(s, s.studentToken))[0]).toMatchObject({ canSubmit: false });
  });
});
