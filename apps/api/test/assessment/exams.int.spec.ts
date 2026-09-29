import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Clock, FixedClock } from '../../src/common';
import { AttemptsService } from '../../src/modules/assessment';
import { adminQuery, insertMembership, insertUser, insertWorkspace } from '../support/fixtures';
import { createIntegrationApp } from '../support/integration-app';
import { signIn } from '../support/sessions';

const clock = new FixedClock('2026-10-01T09:00:00Z');
let app: NestFastifyApplication;

type ErrorJson = { error: { code: string } };
type Paper = {
  attemptId: string;
  deadlineAt: string;
  submitted: boolean;
  questions: { position: number; kind: string; choices: { id: string; text: string }[] }[];
  answers: Record<string, { seq: number; response: unknown }>;
  result: { score: number | null; max: number } | null;
};

function call(method: 'GET' | 'POST' | 'PUT', url: string, token: string, payload?: object) {
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
  ).json<{
    id: string;
  }>().id;
  const q = async (body: object) =>
    (await call('POST', `${w}/courses/${course}/questions`, ownerToken, body)).json<{
      id: string;
      choices: { id: string; text: string }[];
    }>();
  const mcq = await q({
    kind: 'mcq',
    body: 'وحدة القوة؟',
    choices: ['نيوتن', 'جول'],
    correctIndex: 0,
    points: 2,
  });
  const tf = await q({ kind: 'true_false', body: 'الضوء أسرع من الصوت', value: true });
  const short = await q({ kind: 'short', body: 'عاصمة مصر؟', accepted: ['القاهرة'] });
  const studentUser = await insertUser();
  const student = await insertMembership(workspaceId, studentUser, 'student');
  await call('POST', `${w}/classes/${classId}/students`, ownerToken, { membershipIds: [student] });
  const exam = (
    await call('POST', `${w}/courses/${course}/exams`, ownerToken, {
      title: 'امتحان الوحدة الأولى',
      timeLimitMinutes: 30,
      opensAt: '2026-10-01T09:00:00Z',
      closesAt: '2026-10-01T12:00:00Z',
      classIds: [classId],
      questionIds: [mcq.id, tf.id, short.id],
      passPercent: 50,
      ...extra,
    })
  ).json<{ id: string }>().id;
  await call('POST', `${w}/exams/${exam}/publish`, ownerToken, { published: true });
  return {
    owner,
    workspaceId,
    ownerToken,
    w,
    course,
    classId,
    mcq,
    student,
    studentUser,
    exam,
    studentToken: await signIn(app, studentUser),
  };
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

describe('exams (REQ-EXAM-001, -002, -004, -006)', () => {
  it('runs an attempt end to end without leaking answers, then releases results to the gradebook', async () => {
    const s = await setup();
    const listed = (await call('GET', `${s.w}/my/exams`, s.studentToken)).json<{
      exams: { id: string; status: string; canStart: boolean }[];
    }>().exams;
    expect(listed).toEqual([
      expect.objectContaining({ id: s.exam, status: 'open', canStart: true }),
    ]);

    clock.set('2026-10-01T10:00:00Z');
    const token = await signIn(app, s.studentUser);
    const { attemptId } = (await call('POST', `${s.w}/my/exams/${s.exam}/attempts`, token)).json<{
      attemptId: string;
    }>();
    const paperRes = await call('GET', `${s.w}/my/attempts/${attemptId}`, token);
    const paper = paperRes.json<Paper>();
    expect(paper.deadlineAt).toBe('2026-10-01T10:30:00.000Z');
    expect(paperRes.body).not.toMatch(/"correct"|"answer"|"accepted"|"value":true/);

    const save = (position: number, response: object, seq: number) =>
      call('PUT', `${s.w}/my/attempts/${attemptId}/answers/${position}`, token, { response, seq });
    const correctChoice = s.mcq.choices[0]?.id ?? '';
    const wrongChoice = s.mcq.choices[1]?.id ?? '';
    expect((await save(0, { choiceId: wrongChoice }, 1)).json()).toEqual({ saved: true, seq: 1 });
    await save(0, { choiceId: correctChoice }, 3);
    await save(0, { choiceId: wrongChoice }, 2); // a late, older save doesn't win
    await save(1, { value: true }, 4);
    await save(2, { text: 'القاهره' }, 5);
    expect((await save(2, { choiceId: 'x' }, 6)).json<ErrorJson>().error.code).toBe(
      'invalid_response',
    );
    const saved = (await call('GET', `${s.w}/my/attempts/${attemptId}`, token)).json<Paper>();
    expect(saved.answers['0']).toEqual({ seq: 3, response: { choiceId: correctChoice } });

    expect((await call('POST', `${s.w}/my/attempts/${attemptId}/submit`, token)).statusCode).toBe(
      204,
    );
    const after = (await call('GET', `${s.w}/my/attempts/${attemptId}`, token)).json<Paper>();
    expect(after).toMatchObject({ submitted: true, result: null }); // not released yet

    const ownerToken = await signIn(app, s.owner, { twoFactor: true });
    const results = (await call('GET', `${s.w}/exams/${s.exam}/results`, ownerToken)).json<{
      max: number;
      rows: { counted: number; passed: boolean }[];
    }>();
    expect(results).toMatchObject({ max: 4, rows: [{ counted: 4, passed: true }] });
    expect((await call('POST', `${s.w}/exams/${s.exam}/release`, ownerToken)).statusCode).toBe(204);
    const grades = (await call('GET', `${s.w}/my/grades`, token)).json<{
      classes: { items: { title: string; score: number; maxScore: number }[] }[];
    }>();
    expect(grades.classes[0]?.items).toEqual([
      expect.objectContaining({ title: 'امتحان الوحدة الأولى', score: 4, maxScore: 4 }),
    ]);
    // Settings are locked once attempts exist.
    const locked = await call('PUT', `${s.w}/exams/${s.exam}`, ownerToken, {
      title: 'تغيير',
      timeLimitMinutes: 30,
      opensAt: '2026-10-01T09:00:00Z',
      closesAt: '2026-10-01T12:00:00Z',
      classIds: [s.classId],
      questionIds: [s.mcq.id],
    });
    expect(locked.json<ErrorJson>().error.code).toBe('exam_has_attempts');
  });

  it('accepts answers until deadline + 60 s and closes the attempt at +61 s without the sweeper', async () => {
    const s = await setup();
    const { attemptId } = (
      await call('POST', `${s.w}/my/exams/${s.exam}/attempts`, s.studentToken)
    ).json<{
      attemptId: string;
    }>();
    const save = (seq: number) =>
      call('PUT', `${s.w}/my/attempts/${attemptId}/answers/1`, s.studentToken, {
        response: { value: true },
        seq,
      });
    clock.set('2026-10-01T09:31:00Z'); // deadline 09:30 + 60 s
    expect((await save(1)).statusCode).toBe(200);
    clock.set('2026-10-01T09:31:01Z');
    expect((await save(2)).json<ErrorJson>().error.code).toBe('attempt_closed');
    const [row] = await adminQuery<{ reason: string; score: number }>(
      'select submit_reason as reason, score_centi as score from exam_attempts where id = $1',
      [attemptId],
    );
    expect(row).toEqual({ reason: 'timeout', score: 100 });
  });

  it('an accommodation goes past the window end; the sweeper closes overdue attempts', async () => {
    const s = await setup();
    await call('PUT', `${s.w}/exams/${s.exam}/accommodations/${s.student}`, s.ownerToken, {
      extraMinutes: 20,
    });
    clock.set('2026-10-01T11:50:00Z'); // late start: cut at 12:00, plus 20 minutes
    const token = await signIn(app, s.studentUser);
    const { attemptId } = (await call('POST', `${s.w}/my/exams/${s.exam}/attempts`, token)).json<{
      attemptId: string;
    }>();
    const paper = (await call('GET', `${s.w}/my/attempts/${attemptId}`, token)).json<Paper>();
    expect(paper.deadlineAt).toBe('2026-10-01T12:20:00.000Z');
    clock.set('2026-10-01T12:21:30Z');
    expect(await app.get(AttemptsService).sweep()).toBeGreaterThanOrEqual(1);
    const [row] = await adminQuery<{ reason: string }>(
      'select submit_reason as reason from exam_attempts where id = $1',
      [attemptId],
    );
    expect(row?.reason).toBe('timeout');
  });

  it('a paused student gets a neutral refusal, but an attempt started before the pause can finish', async () => {
    const s = await setup({ maxAttempts: 2 });
    const { attemptId } = (
      await call('POST', `${s.w}/my/exams/${s.exam}/attempts`, s.studentToken)
    ).json<{
      attemptId: string;
    }>();
    await call('POST', `${s.w}/access/pause`, s.ownerToken, {
      membershipIds: [s.student],
      paused: true,
    });
    expect(
      (
        await call('PUT', `${s.w}/my/attempts/${attemptId}/answers/1`, s.studentToken, {
          response: { value: false },
          seq: 1,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await call('POST', `${s.w}/my/attempts/${attemptId}/submit`, s.studentToken)).statusCode,
    ).toBe(204);
    const refused = await call('POST', `${s.w}/my/exams/${s.exam}/attempts`, s.studentToken);
    expect(refused.json<ErrorJson>().error.code).toBe('exam_unavailable');
  });

  it('parallel starts create one attempt; students outside the target classes see nothing', async () => {
    const s = await setup();
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        call('POST', `${s.w}/my/exams/${s.exam}/attempts`, s.studentToken),
      ),
    );
    const ids = new Set(results.map((r) => r.json<{ attemptId: string }>().attemptId));
    expect(ids.size).toBe(1);
    const outsider = await insertUser();
    await insertMembership(s.workspaceId, outsider, 'student');
    const token = await signIn(app, outsider);
    expect(
      (await call('GET', `${s.w}/my/exams`, token)).json<{ exams: unknown[] }>().exams,
    ).toEqual([]);
    expect((await call('POST', `${s.w}/my/exams/${s.exam}/attempts`, token)).statusCode).toBe(404);
    expect((await call('GET', `${s.w}/my/attempts/${[...ids][0] ?? ''}`, token)).statusCode).toBe(
      404,
    );
  });
});
