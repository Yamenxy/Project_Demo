import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Clock, FixedClock } from '../../src/common';
import { adminQuery, insertMembership, insertUser, insertWorkspace } from '../support/fixtures';
import { createIntegrationApp } from '../support/integration-app';
import { signIn } from '../support/sessions';

const clock = new FixedClock('2026-10-01T09:30:00Z');
let app: NestFastifyApplication;

type Preview = { attemptsChanged: number; studentsChanged: number; passFailChanged: number };

function call(method: 'GET' | 'POST' | 'PUT', url: string, token: string, payload?: object) {
  return app.inject({
    method,
    url,
    cookies: { lms_session: token },
    ...(payload ? { payload } : {}),
  });
}

beforeAll(async () => {
  app = await createIntegrationApp((builder) => builder.overrideProvider(Clock).useValue(clock));
});

afterAll(async () => {
  await app.close();
});

describe('answer-key correction (REQ-EXAM-003)', () => {
  it('previews the changes, then regrades every attempt and updates released grades', async () => {
    const owner = await insertUser();
    const workspaceId = await insertWorkspace(owner);
    const ownerToken = await signIn(app, owner, { twoFactor: true });
    const w = `/api/v1/w/${workspaceId}`;
    const course = (await call('POST', `${w}/courses`, ownerToken, { title: 'علوم' })).json<{
      id: string;
    }>().id;
    const classId = (await call('POST', `${w}/classes`, ownerToken, { name: 'فصل' })).json<{
      id: string;
    }>().id;
    // The key is wrong: "جول" was marked correct by mistake.
    const q = (
      await call('POST', `${w}/courses/${course}/questions`, ownerToken, {
        kind: 'mcq',
        body: 'وحدة القوة؟',
        choices: ['نيوتن', 'جول'],
        correctIndex: 1,
      })
    ).json<{ id: string; choices: { id: string }[] }>();
    const newton = q.choices[0]?.id ?? '';
    const joule = q.choices[1]?.id ?? '';
    const users = [await insertUser(), await insertUser()];
    const members = [
      await insertMembership(workspaceId, users[0] ?? '', 'student'),
      await insertMembership(workspaceId, users[1] ?? '', 'student'),
    ];
    await call('POST', `${w}/classes/${classId}/students`, ownerToken, { membershipIds: members });
    const exam = (
      await call('POST', `${w}/courses/${course}/exams`, ownerToken, {
        title: 'اختبار',
        timeLimitMinutes: 20,
        opensAt: '2026-10-01T09:00:00Z',
        closesAt: '2026-10-01T12:00:00Z',
        classIds: [classId],
        questionIds: [q.id],
        passPercent: 50,
      })
    ).json<{ id: string }>().id;
    await call('POST', `${w}/exams/${exam}/publish`, ownerToken, { published: true });
    for (const [i, choice] of [newton, joule].entries()) {
      const token = await signIn(app, users[i] ?? '');
      const { attemptId } = (await call('POST', `${w}/my/exams/${exam}/attempts`, token)).json<{
        attemptId: string;
      }>();
      await call('PUT', `${w}/my/attempts/${attemptId}/answers/0`, token, {
        response: { choiceId: choice },
        seq: 1,
      });
      await call('POST', `${w}/my/attempts/${attemptId}/submit`, token);
    }
    await call('POST', `${w}/exams/${exam}/release`, ownerToken);

    const preview = await call('POST', `${w}/exams/${exam}/items/0/key-preview`, ownerToken, {
      key: { correctChoiceId: newton },
    });
    expect(preview.json<Preview>()).toMatchObject({
      attemptsChanged: 2,
      studentsChanged: 2,
      passFailChanged: 2,
    });
    // Settings stay locked; only the key may change.
    const [before] = await adminQuery<{ n: string }>(
      'select count(*) as n from question_versions where question_id = $1',
      [q.id],
    );
    expect(before?.n).toBe('1');

    const applied = await call('POST', `${w}/exams/${exam}/items/0/key`, ownerToken, {
      key: { correctChoiceId: newton },
    });
    expect(applied.json<Preview>()).toMatchObject({ attemptsChanged: 2 });
    const results = (await call('GET', `${w}/exams/${exam}/results`, ownerToken)).json<{
      rows: { membershipId: string; counted: number }[];
    }>();
    const byMember = Object.fromEntries(results.rows.map((r) => [r.membershipId, r.counted]));
    expect(byMember).toEqual({ [members[0] ?? '']: 1, [members[1] ?? '']: 0 });
    const grades = await adminQuery<{ membership_id: string; score: number }>(
      `select e.membership_id, e.score_centi as score from grade_entries e
         join grade_items i on i.id = e.item_id where i.source_id = $1`,
      [exam],
    );
    expect(Object.fromEntries(grades.map((g) => [g.membership_id, g.score]))).toEqual({
      [members[0] ?? '']: 100,
      [members[1] ?? '']: 0,
    });
    // The clock is frozen, so check the history by reason rather than by time.
    const [change] = await adminQuery<{ n: string }>(
      `select count(*) as n from grade_changes c join grade_entries e on e.id = c.entry_id
        where e.membership_id = $1 and c.reason = 'answer key corrected'
          and c.old_score_centi = 0 and c.new_score_centi = 100`,
      [members[0]],
    );
    expect(change?.n).toBe('1');
    const [versions] = await adminQuery<{ n: string }>(
      'select count(*) as n from question_versions where question_id = $1',
      [q.id],
    );
    expect(versions?.n).toBe('2');
    // Both counted scores changed after release: one regrade notification each.
    const notes = await adminQuery<{ recipient_user_id: string; type: string }>(
      `select recipient_user_id, type from notifications where workspace_id = $1
        and type = 'exam.regraded'`,
      [workspaceId],
    );
    expect(notes.map((n) => n.recipient_user_id).sort()).toEqual([...users].sort());
  });
});
