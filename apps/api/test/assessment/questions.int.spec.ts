import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminQuery, insertMembership, insertUser, insertWorkspace } from '../support/fixtures';
import { createIntegrationApp } from '../support/integration-app';
import { signIn } from '../support/sessions';

let app: NestFastifyApplication;

type Question = {
  id: string;
  version: number;
  versionId: string;
  body: string;
  choices: { id: string; text: string }[];
  answer: { correct?: string; accepted?: string[] };
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
  const course = (await call('POST', `${w}/courses`, ownerToken, { title: 'فيزياء' })).json<{
    id: string;
  }>().id;
  return { owner, workspaceId, ownerToken, w, course };
}

beforeAll(async () => {
  app = await createIntegrationApp();
});

afterAll(async () => {
  await app.close();
});

describe('question bank (REQ-QBANK-001, -002)', () => {
  it('stores LaTeX with Arabic, and every edit makes a new immutable version', async () => {
    const s = await setup();
    const created = await call('POST', `${s.w}/courses/${s.course}/questions`, s.ownerToken, {
      kind: 'mcq',
      body: 'إذا كانت $F = ma$ فإن وحدة القوة هي:',
      choices: ['نيوتن', 'جول', 'واط'],
      correctIndex: 0,
      points: 2,
    });
    expect(created.statusCode).toBe(201);
    const v1 = created.json<Question>();
    expect(v1.version).toBe(1);
    expect(v1.answer.correct).toBe(v1.choices[0]?.id);

    const edited = (
      await call('POST', `${s.w}/questions/${v1.id}`, s.ownerToken, {
        kind: 'mcq',
        body: 'إذا كانت $F = ma$ فإن وحدة القوة في النظام الدولي هي:',
        choices: ['نيوتن', 'جول'],
        correctIndex: 0,
      })
    ).json<Question>();
    expect(edited.version).toBe(2);
    const versions = (await call('GET', `${s.w}/questions/${v1.id}/versions`, s.ownerToken)).json<{
      versions: Question[];
    }>().versions;
    expect(versions.map((v) => [v.version, v.body.includes('الدولي')])).toEqual([
      [2, true],
      [1, false],
    ]);
    const [privileges] = await adminQuery<{ upd: boolean }>(
      `select has_table_privilege('app_runtime', 'question_versions', 'UPDATE') as upd`,
    );
    expect(privileges?.upd).toBe(false);

    const list = (await call('GET', `${s.w}/courses/${s.course}/questions`, s.ownerToken)).json<{
      questions: Question[];
    }>().questions;
    expect(list.map((q) => q.version)).toEqual([2]);
  });

  it('validates each kind and checks permissions', async () => {
    const s = await setup();
    const bad = await call('POST', `${s.w}/courses/${s.course}/questions`, s.ownerToken, {
      kind: 'mcq',
      body: 'سؤال',
      choices: ['أ', 'ب'],
      correctIndex: 5,
    });
    expect(bad.statusCode).toBe(400);
    const short = await call('POST', `${s.w}/courses/${s.course}/questions`, s.ownerToken, {
      kind: 'short',
      body: 'عاصمة مصر؟',
      accepted: ['القاهرة'],
    });
    expect(short.json<Question>().answer).toEqual({ accepted: ['القاهرة'], arabicVariants: true });
    const helper = await insertUser();
    await insertMembership(s.workspaceId, helper, 'assistant');
    expect(
      (await call('GET', `${s.w}/courses/${s.course}/questions`, await signIn(app, helper)))
        .statusCode,
    ).toBe(403);
  });
});
