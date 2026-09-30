import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TenantDb } from '../../src/database';
import { adminQuery, insertMembership, insertUser, insertWorkspace } from '../support/fixtures';
import { createIntegrationApp } from '../support/integration-app';
import { PG, pgErrorCode } from '../support/pg-error';
import { signIn } from '../support/sessions';

let app: NestFastifyApplication;

type ErrorJson = { error: { code: string } };
type Comment = { id: string; side: string; mine: boolean; body: string | null };

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
  const course = (await call('POST', `${w}/courses`, ownerToken, { title: 'أحياء' })).json<{
    id: string;
  }>().id;
  const classId = (
    await call('POST', `${w}/classes`, ownerToken, { name: 'فصل', courseId: course })
  ).json<{ id: string }>().id;
  const studentUser = await insertUser();
  const student = await insertMembership(workspaceId, studentUser, 'student');
  await call('POST', `${w}/classes/${classId}/students`, ownerToken, { membershipIds: [student] });
  const homework = (
    await call('POST', `${w}/courses/${course}/homework`, ownerToken, {
      title: 'واجب الخلية',
      dueAt: '2099-01-01T00:00:00Z',
      maxScore: 10,
      classIds: [classId],
    })
  ).json<{ id: string }>().id;
  await call('POST', `${w}/homework/${homework}/publish`, ownerToken, { published: true });
  const studentToken = await signIn(app, studentUser);
  const submission = (
    await call('POST', `${w}/my/homework/${homework}/submissions`, studentToken, { text: 'حل' })
  ).json<{ id: string }>().id;
  return { owner, workspaceId, ownerToken, w, studentUser, student, studentToken, submission };
}

beforeAll(async () => {
  app = await createIntegrationApp();
});

afterAll(async () => {
  await app.close();
});

describe('homework comments (REQ-MSG-001)', () => {
  it('the student and their teacher talk on the submission, and each side is notified', async () => {
    const s = await setup();
    const url = `${s.w}/homework-submissions/${s.submission}/comments`;
    const asked = await call('POST', url, s.studentToken, { body: 'هل الرسم مطلوب؟' });
    expect(asked.statusCode).toBe(201);
    expect(asked.json()).toMatchObject({ side: 'student', mine: true });
    expect((await call('POST', url, s.ownerToken, { body: 'نعم، ارسم الخلية' })).statusCode).toBe(
      201,
    );
    const seen = (await call('GET', url, s.studentToken)).json<{ comments: Comment[] }>();
    expect(seen.comments.map((c) => [c.side, c.mine, c.body])).toEqual([
      ['student', true, 'هل الرسم مطلوب؟'],
      ['staff', false, 'نعم، ارسم الخلية'],
    ]);
    const notes = await adminQuery<{ recipient_user_id: string }>(
      `select recipient_user_id from notifications where workspace_id = $1
          and type = 'homework.comment' order by created_at`,
      [s.workspaceId],
    );
    expect(notes.map((n) => n.recipient_user_id).sort()).toEqual([s.owner, s.studentUser].sort());
    const empty = await call('POST', url, s.studentToken, { body: '   ' });
    expect(empty.statusCode).toBe(400);
  });

  it('nobody outside the thread can read or write it', async () => {
    const s = await setup();
    const url = `${s.w}/homework-submissions/${s.submission}/comments`;
    const otherStudent = await insertUser();
    await insertMembership(s.workspaceId, otherStudent, 'student');
    const otherToken = await signIn(app, otherStudent);
    expect((await call('GET', url, otherToken)).statusCode).toBe(404);
    expect((await call('POST', url, otherToken, { body: 'مرحبا' })).statusCode).toBe(404);
    // An assistant without grading for this student sees nothing either.
    const assistant = await insertUser();
    await insertMembership(s.workspaceId, assistant, 'assistant');
    expect((await call('GET', url, await signIn(app, assistant))).statusCode).toBe(404);
  });

  it('comments are permanent for the app, reviewed by the owner, and reported to the platform', async () => {
    const s = await setup();
    const url = `${s.w}/homework-submissions/${s.submission}/comments`;
    const staffComment = (
      await call('POST', url, s.ownerToken, { body: 'تعليق غير لائق' })
    ).json<Comment>();

    // The runtime role can't edit or delete a comment.
    const db = app.get(TenantDb);
    expect(
      await pgErrorCode(
        db.inWorkspace(s.workspaceId, (tx) =>
          tx.execute(sql`delete from homework_comments where id = ${staffComment.id}`),
        ),
      ),
    ).toBe(PG.insufficientPrivilege);
    expect(
      await pgErrorCode(
        db.inWorkspace(s.workspaceId, (tx) =>
          tx.execute(sql`update homework_comments set body = 'x' where id = ${staffComment.id}`),
        ),
      ),
    ).toBe(PG.insufficientPrivilege);

    const review = (await call('GET', `${s.w}/homework-comments`, s.ownerToken)).json<{
      comments: { id: string; homeworkTitle: string }[];
    }>();
    expect(review.comments).toEqual([
      expect.objectContaining({ id: staffComment.id, homeworkTitle: 'واجب الخلية' }),
    ]);
    expect((await call('GET', `${s.w}/homework-comments`, s.studentToken)).statusCode).toBe(403);

    const reportUrl = `${s.w}/homework-comments/${staffComment.id}/report`;
    const own = await call('POST', reportUrl, s.ownerToken, { reason: 'تجربة' });
    expect(own.json<ErrorJson>().error.code).toBe('own_comment');
    expect(
      (await call('POST', reportUrl, s.studentToken, { reason: 'كلام مسيء' })).statusCode,
    ).toBe(204);
    // Reporting again adds nothing.
    await call('POST', reportUrl, s.studentToken, { reason: 'كلام مسيء' });
    const [count] = await adminQuery<{ n: string }>(
      'select count(*) as n from comment_reports where comment_id = $1',
      [staffComment.id],
    );
    expect(count?.n).toBe('1');

    const platformOwner = await insertUser();
    await adminQuery('insert into platform_owners (user_id, created_at) values ($1, now())', [
      platformOwner,
    ]);
    const platformToken = await signIn(app, platformOwner, { twoFactor: true });
    const queue = (await call('GET', '/api/v1/platform/comment-reports', platformToken)).json<{
      reports: { commentId: string; body: string; reports: { reason: string }[] }[];
    }>();
    expect(queue.reports).toContainEqual(
      expect.objectContaining({
        commentId: staffComment.id,
        body: 'تعليق غير لائق',
        reports: [expect.objectContaining({ reason: 'كلام مسيء' })],
      }),
    );
    expect((await call('GET', '/api/v1/platform/comment-reports', s.ownerToken)).statusCode).toBe(
      403,
    );
    expect(
      (
        await call(
          'POST',
          `/api/v1/platform/comment-reports/${staffComment.id}/resolve`,
          platformToken,
          { resolution: 'hidden' },
        )
      ).statusCode,
    ).toBe(204);
    const after = (await call('GET', url, s.studentToken)).json<{ comments: Comment[] }>();
    expect(after.comments[0]).toMatchObject({ id: staffComment.id, body: null });
    const again = await call(
      'POST',
      `/api/v1/platform/comment-reports/${staffComment.id}/resolve`,
      platformToken,
      { resolution: 'dismissed' },
    );
    expect(again.statusCode).toBe(404);
    const audit = await adminQuery<{ action: string }>(
      `select action from audit_log where workspace_id = $1 and action like '%comment%'
        order by action`,
      [s.workspaceId],
    );
    expect(audit.map((a) => a.action)).toEqual([
      'homework.comment_posted',
      'homework.comment_reported',
      'platform.comment_report_resolved',
    ]);
  });
});
