import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AnnouncementsService, FANOUT_BATCH } from '../../src/modules/announcements';
import { adminQuery, insertMembership, insertUser, insertWorkspace } from '../support/fixtures';
import { createIntegrationApp } from '../support/integration-app';
import { signIn } from '../support/sessions';

let app: NestFastifyApplication;

type Listed = { announcements: { id: string; title: string; delivered: boolean }[] };

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
  const classA = (await call('POST', `${w}/classes`, ownerToken, { name: 'فصل أ' })).json<{
    id: string;
  }>().id;
  const classB = (await call('POST', `${w}/classes`, ownerToken, { name: 'فصل ب' })).json<{
    id: string;
  }>().id;
  const inAUser = await insertUser();
  const inA = await insertMembership(workspaceId, inAUser, 'student');
  const inBUser = await insertUser();
  const inB = await insertMembership(workspaceId, inBUser, 'student');
  await call('POST', `${w}/classes/${classA}/students`, ownerToken, { membershipIds: [inA] });
  await call('POST', `${w}/classes/${classB}/students`, ownerToken, { membershipIds: [inB] });
  // Neither a managed record nobody has taken over nor a removed student gets anything.
  await insertMembership(workspaceId, null, 'student', {
    provisional_name: 'سجل مُدار',
    provisional_phone: '+201099990000',
  });
  await insertMembership(workspaceId, await insertUser(), 'student', { status: 'removed' });
  return { owner, workspaceId, ownerToken, w, classA, classB, inAUser, inBUser };
}

async function notified(workspaceId: string): Promise<string[]> {
  const rows = await adminQuery<{ recipient_user_id: string }>(
    `select recipient_user_id from notifications
      where workspace_id = $1 and type = 'announcement.posted'`,
    [workspaceId],
  );
  return rows.map((r) => r.recipient_user_id).sort();
}

/** Runs the fan-out the way the queue would: batch after batch, following the cursor. */
async function drain(workspaceId: string, announcementId: string): Promise<number[]> {
  const service = app.get(AnnouncementsService);
  const sizes: number[] = [];
  for (;;) {
    const [a] = await adminQuery<{ cursor: string | null; done: Date | null }>(
      'select fanout_cursor as cursor, fanout_done_at as done from announcements where id = $1',
      [announcementId],
    );
    if (a?.done) return sizes;
    const before = (await notified(workspaceId)).length;
    await service.fanout({ workspaceId, announcementId, after: a?.cursor ?? null });
    sizes.push((await notified(workspaceId)).length - before);
  }
}

beforeAll(async () => {
  app = await createIntegrationApp();
});

afterAll(async () => {
  await app.close();
});

describe('announcements (REQ-NOTIF-001)', () => {
  it('a workspace announcement reaches every active student once, through the queue', async () => {
    const s = await setup();
    const posted = await call('POST', `${s.w}/announcements`, s.ownerToken, {
      title: 'تأجيل حصة السبت',
      body: 'تؤجل حصة السبت إلى الأحد في نفس الموعد.',
    });
    expect(posted.statusCode).toBe(201);
    const { id, recipients } = posted.json<{ id: string; recipients: number }>();
    expect(recipients).toBe(2);
    // Posting only enqueues; nothing is sent in the request.
    expect(await notified(s.workspaceId)).toEqual([]);
    await drain(s.workspaceId, id);
    expect(await notified(s.workspaceId)).toEqual([s.inAUser, s.inBUser].sort());
    // A duplicate or retried first batch finds the cursor moved on.
    await app.get(AnnouncementsService).fanout({
      workspaceId: s.workspaceId,
      announcementId: id,
      after: null,
    });
    expect(await notified(s.workspaceId)).toHaveLength(2);

    const token = await signIn(app, s.inBUser);
    const mine = (await call('GET', `${s.w}/my/announcements`, token)).json<Listed>();
    expect(mine.announcements).toEqual([
      expect.objectContaining({ id, title: 'تأجيل حصة السبت', delivered: true }),
    ]);
    const [audit] = await adminQuery<{ n: string }>(
      `select count(*) as n from audit_log where workspace_id = $1 and action = 'announcement.posted'`,
      [s.workspaceId],
    );
    expect(audit?.n).toBe('1');
  });

  it('sends big announcements in limited batches', async () => {
    const s = await setup();
    const extra = FANOUT_BATCH + 40;
    await adminQuery(
      `with u as (
         insert into users (id, platform_code, name_ar, phone_e164, status, password_hash,
                            password_changed_at, created_at, updated_at)
         select gen_random_uuid(), translate(upper(substr(md5(random()::text), 1, 8)), '01', 'XY'),
                'طالب ' || g, '+2010' || lpad(g::text, 8, '0'), 'active', 'x', now(), now(), now()
           from generate_series(1, $2::int) g
         returning id)
       insert into memberships (workspace_id, id, user_id, role, created_at, updated_at)
       select $1::uuid, gen_random_uuid(), u.id, 'student', now(), now() from u`,
      [s.workspaceId, extra],
    );
    const { id } = (
      await call('POST', `${s.w}/announcements`, s.ownerToken, { title: 'إعلان كبير', body: 'نص' })
    ).json<{ id: string }>();
    const sizes = await drain(s.workspaceId, id);
    expect(sizes.every((n) => n <= FANOUT_BATCH)).toBe(true);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(extra + 2);
    expect(sizes.length).toBe(2);
  });

  it('a class teacher announces to their own class only, and students see only theirs', async () => {
    const s = await setup();
    const teacher = await insertUser();
    const teacherMembership = await insertMembership(s.workspaceId, teacher, 'class_teacher');
    await call('POST', `${s.w}/classes/${s.classA}`, s.ownerToken, {
      responsibleMembershipId: teacherMembership,
    });
    const token = await signIn(app, teacher, { twoFactor: true });
    const everyone = await call('POST', `${s.w}/announcements`, token, {
      title: 'للجميع',
      body: 'x',
    });
    expect(everyone.statusCode).toBe(403);
    const otherClass = await call('POST', `${s.w}/announcements`, token, {
      classId: s.classB,
      title: 'فصل ب',
      body: 'x',
    });
    expect(otherClass.statusCode).toBe(403);
    const own = await call('POST', `${s.w}/announcements`, token, {
      classId: s.classA,
      title: 'واجب فصل أ',
      body: 'لا تنسوا الواجب',
    });
    expect(own.json<{ recipients: number }>().recipients).toBe(1);
    await drain(s.workspaceId, own.json<{ id: string }>().id);
    expect(await notified(s.workspaceId)).toEqual([s.inAUser]);

    const seenByB = (
      await call('GET', `${s.w}/my/announcements`, await signIn(app, s.inBUser))
    ).json<Listed>();
    expect(seenByB.announcements).toEqual([]);
    const studentPost = await call('POST', `${s.w}/announcements`, await signIn(app, s.inAUser), {
      title: 'طالب',
      body: 'x',
    });
    expect(studentPost.statusCode).toBe(403);
  });

  it("another workspace's class is not found", async () => {
    const s = await setup();
    const other = await setup();
    const res = await call('POST', `${s.w}/announcements`, s.ownerToken, {
      classId: other.classA,
      title: 'تجربة',
      body: 'x',
    });
    expect(res.statusCode).toBe(404);
  });
});
