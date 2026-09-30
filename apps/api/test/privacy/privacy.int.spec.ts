import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Clock, FixedClock } from '../../src/common';
import { AnonymizeService, ANONYMIZED_NAME } from '../../src/modules/platform-admin';
import { adminQuery, insertMembership, insertUser, insertWorkspace } from '../support/fixtures';
import { createIntegrationApp } from '../support/integration-app';
import { signIn } from '../support/sessions';

const clock = new FixedClock('2026-10-01T09:00:00Z');
let app: NestFastifyApplication;

type ErrorJson = { error: { code: string } };

function call(method: 'GET' | 'POST', url: string, token: string, payload?: object) {
  return app.inject({
    method,
    url,
    cookies: { lms_session: token },
    ...(payload ? { payload } : {}),
  });
}

/** A workspace with a class, a student in it, a released grade and an unreleased one. */
async function setup() {
  const owner = await insertUser();
  const workspaceId = await insertWorkspace(owner);
  const ownerToken = await signIn(app, owner, { twoFactor: true });
  const w = `/api/v1/w/${workspaceId}`;
  const classId = (await call('POST', `${w}/classes`, ownerToken, { name: 'فصل' })).json<{
    id: string;
  }>().id;
  const student = await insertUser();
  const name = `طالب ${student.slice(0, 6)}`;
  await adminQuery(`update users set name_ar = $2 where id = $1`, [student, name]);
  const [{ phone } = { phone: '' }] = await adminQuery<{ phone: string }>(
    'select phone_e164 as phone from users where id = $1',
    [student],
  );
  const membership = await insertMembership(workspaceId, student, 'student');
  await call('POST', `${w}/classes/${classId}/students`, ownerToken, {
    membershipIds: [membership],
  });
  const other = await insertMembership(workspaceId, await insertUser(), 'student');
  await call('POST', `${w}/classes/${classId}/students`, ownerToken, { membershipIds: [other] });
  const item = async (title: string, score: number, release: boolean) => {
    const id = (
      await call('POST', `${w}/classes/${classId}/grade-items`, ownerToken, { title, maxScore: 20 })
    ).json<{ id: string }>().id;
    await call('POST', `${w}/grade-items/${id}/scores`, ownerToken, {
      scores: [
        { membershipId: membership, score },
        { membershipId: other, score: 3 },
      ],
    });
    if (release)
      await call('POST', `${w}/grade-items/${id}/release`, ownerToken, { released: true });
  };
  await item('اختبار معلن', 17, true);
  await item('اختبار غير معلن', 12, false);
  return { owner, workspaceId, w, student, name, phone, membership };
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

describe('download my data (REQ-PRIV-003)', () => {
  it('contains the account and the student’s own released records, and nothing else', async () => {
    const s = await setup();
    const token = await signIn(app, s.student);
    const res = await call('GET', '/api/v1/me/data-export', token);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="my-data.json"');
    const data = res.json<{
      account: { nameAr: string; phone: string };
      workspaces: { role: string; grades: { classes: { items: { title: string }[] }[] } }[];
    }>();
    expect(data.account).toMatchObject({ nameAr: s.name, phone: s.phone });
    const titles = data.workspaces[0]?.grades.classes.flatMap((c) => c.items.map((i) => i.title));
    expect(titles).toEqual(['اختبار معلن']);
    expect(res.body).not.toContain('اختبار غير معلن');
    const [audit] = await adminQuery<{ n: string }>(
      `select count(*) as n from audit_log where actor_user_id = $1 and action = 'account.data_exported'`,
      [s.student],
    );
    expect(audit?.n).toBe('1');
  });
});

describe('correcting one’s name', () => {
  it('changes the global name and keeps the old one only where anonymization clears it', async () => {
    const s = await setup();
    const token = await signIn(app, s.student);
    const res = await call('POST', '/api/v1/me/profile', token, { nameAr: 'اسم مصحح للطالب' });
    expect(res.statusCode).toBe(204);
    const [user] = await adminQuery<{ name: string }>(
      'select name_ar as name from users where id = $1',
      [s.student],
    );
    expect(user?.name).toBe('اسم مصحح للطالب');
    const [audit] = await adminQuery<{ nv: unknown; pc: { before: { nameAr: string } } }>(
      `select new_value as nv, personal_context as pc from audit_log
        where actor_user_id = $1 and action = 'account.profile_updated'`,
      [s.student],
    );
    expect(audit?.nv).toBeNull();
    expect(audit?.pc.before.nameAr).toBe(s.name);
  });
});

describe('deleting an account (REQ-PRIV-003, REQ-AUDIT-001)', () => {
  it('an owner of a workspace must hand it over first', async () => {
    const s = await setup();
    const res = await call(
      'POST',
      '/api/v1/me/deletion',
      await signIn(app, s.owner, { twoFactor: true }),
    );
    expect(res.json<ErrorJson>().error.code).toBe('owner_cannot_delete');
  });

  it('waits 14 days, can be cancelled, then anonymizes everywhere and keeps the records', async () => {
    const s = await setup();
    let token = await signIn(app, s.student);
    // A name change leaves the old name in an audit personal context, to be cleared later.
    await call('POST', '/api/v1/me/profile', token, { nameAr: `${s.name} معدل` });
    const requested = await call('POST', '/api/v1/me/deletion', token);
    expect(requested.json()).toEqual({ anonymizeAfter: '2026-10-15T09:00:00.000Z' });
    expect((await call('POST', '/api/v1/me/deletion/cancel', token)).statusCode).toBe(204);
    await call('POST', '/api/v1/me/deletion', token);

    // Not yet: the 14 days aren't over.
    clock.set('2026-10-15T08:59:00Z');
    expect(await app.get(AnonymizeService).run()).toEqual({ anonymized: 0 });
    clock.set('2026-10-15T09:01:00Z');
    token = await signIn(app, s.student);
    const result = await app.get(AnonymizeService).run();
    expect(result.anonymized).toBeGreaterThanOrEqual(1);

    const [user] = await adminQuery<{ name: string; status: string; phone: string }>(
      'select name_ar as name, status, phone_e164 as phone from users where id = $1',
      [s.student],
    );
    expect(user).toMatchObject({ name: ANONYMIZED_NAME, status: 'anonymized' });
    expect(user?.phone).toMatch(/^\+999\d{11}$/);
    // The session no longer works.
    expect((await call('GET', '/api/v1/auth/me', token)).statusCode).toBe(401);

    // Neither the name nor the phone is left anywhere, the audit log included.
    for (const needle of [s.name, s.phone]) {
      const found = await adminQuery<{ source: string }>(
        `select 'users' as source from users where name_ar like '%' || $1 || '%' or phone_e164 = $1
         union all select 'audit' from audit_log where audit_log::text like '%' || $1 || '%'
         union all select 'notifications' from notifications where notifications::text like '%' || $1 || '%'
         union all select 'memberships' from memberships where memberships::text like '%' || $1 || '%'
         union all select 'invitations' from workspace_invitations where phone_e164 = $1`,
        [needle],
      );
      expect(found).toEqual([]);
    }
    // The records stay, under the anonymized account; the owner is told.
    const [grades] = await adminQuery<{ n: string }>(
      'select count(*) as n from grade_entries where membership_id = $1',
      [s.membership],
    );
    expect(grades?.n).toBe('2');
    const [membership] = await adminQuery<{ status: string }>(
      'select status from memberships where id = $1',
      [s.membership],
    );
    expect(membership?.status).toBe('removed');
    const told = await adminQuery<{ type: string }>(
      'select type from notifications where recipient_user_id = $1 and workspace_id = $2',
      [s.owner, s.workspaceId],
    );
    expect(told.map((n) => n.type)).toContain('privacy.account_deleted');
  });
});
