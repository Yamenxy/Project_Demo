import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Clock, FixedClock } from '../../src/common';
import { adminQuery, insertMembership, insertUser, insertWorkspace } from '../support/fixtures';
import { createIntegrationApp } from '../support/integration-app';
import { signIn } from '../support/sessions';

const clock = new FixedClock('2026-10-03T13:30:00Z'); // Saturday, 16:30 in Cairo
let app: NestFastifyApplication;

type ErrorJson = { error: { code: string } };
type Roster = {
  session: { id: string; locked: boolean; cancelled: boolean };
  students: { membershipId: string; status: string | null; paused: boolean }[];
  others: { membershipId: string; platformCode: string | null }[];
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
  const w = `/api/v1/w/${workspaceId}`;
  const classId = (await call('POST', `${w}/classes`, ownerToken, { name: 'مجموعة السبت' })).json<{
    id: string;
  }>().id;
  await call('POST', `${w}/classes/${classId}/series`, ownerToken, {
    weekday: 6,
    startTime: '17:00',
    durationMinutes: 120,
    startsOn: '2026-10-01',
  });
  const sessions = (await call('GET', `${w}/classes/${classId}/schedule`, ownerToken)).json<{
    sessions: { id: string }[];
  }>().sessions;
  const sessionId = sessions[0]?.id ?? '';
  const studentUser = await insertUser();
  const student = await insertMembership(workspaceId, studentUser, 'student');
  const paused = await insertMembership(workspaceId, await insertUser(), 'student', {
    paused_at: new Date(),
    paused_by: owner,
  });
  const outsider = await insertMembership(workspaceId, await insertUser(), 'student');
  await call('POST', `${w}/classes/${classId}/students`, ownerToken, {
    membershipIds: [student, paused],
  });
  return {
    owner,
    workspaceId,
    ownerToken,
    w,
    classId,
    sessionId,
    student,
    studentUser,
    paused,
    outsider,
  };
}

beforeAll(async () => {
  app = await createIntegrationApp((builder) => builder.overrideProvider(Clock).useValue(clock));
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  clock.set('2026-10-03T13:30:00Z');
});

describe('attendance (REQ-ATT-001, REQ-ATT-002)', () => {
  it('builds the roster, and repeated scans from two devices make one record', async () => {
    const s = await setup();
    const roster = (
      await call('GET', `${s.w}/sessions/${s.sessionId}/attendance`, s.ownerToken)
    ).json<Roster>();
    expect(roster.students.map((x) => [x.membershipId, x.paused, x.status])).toEqual(
      expect.arrayContaining([
        [s.student, false, null],
        [s.paused, true, null],
      ]),
    );
    expect(roster.others.map((x) => x.membershipId)).toContain(s.outsider);

    const scan = { records: [{ membershipId: s.student, status: 'present', method: 'qr' }] };
    const first = await call(
      'POST',
      `${s.w}/sessions/${s.sessionId}/attendance`,
      s.ownerToken,
      scan,
    );
    expect(first.json()).toEqual({ saved: 1 });
    for (let i = 0; i < 3; i++) {
      const again = await call(
        'POST',
        `${s.w}/sessions/${s.sessionId}/attendance`,
        s.ownerToken,
        scan,
      );
      expect(again.json()).toEqual({ saved: 0 });
    }
    // A manual correction wins over the scan; a later scan doesn't undo it.
    await call('POST', `${s.w}/sessions/${s.sessionId}/attendance`, s.ownerToken, {
      records: [{ membershipId: s.student, status: 'late' }],
    });
    await call('POST', `${s.w}/sessions/${s.sessionId}/attendance`, s.ownerToken, scan);
    const [row] = await adminQuery<{ status: string; n: string }>(
      `select status, (select count(*) from attendance_records where session_id = $1) as n
         from attendance_records where session_id = $1`,
      [s.sessionId],
    );
    expect(row).toEqual({ status: 'late', n: '1' });
  });

  it('150 offline scans sync in one upload without duplicates', async () => {
    const s = await setup();
    const extra: string[] = [];
    for (let i = 0; i < 149; i++)
      extra.push(await insertMembership(s.workspaceId, await insertUser(), 'student'));
    const records = [s.student, ...extra].map((membershipId) => ({
      membershipId,
      status: 'present',
      method: 'qr',
      takenAt: '2026-10-03T14:05:00.000Z',
    }));
    const url = `${s.w}/sessions/${s.sessionId}/attendance`;
    expect((await call('POST', url, s.ownerToken, { records })).json()).toEqual({ saved: 150 });
    expect((await call('POST', url, s.ownerToken, { records })).json()).toEqual({ saved: 0 });
    const [count] = await adminQuery<{ n: string }>(
      'select count(*) as n from attendance_records where session_id = $1',
      [s.sessionId],
    );
    expect(count?.n).toBe('150');
  });

  it('locks records after 48 hours: late changes need attendance.edit_late and a reason', async () => {
    const s = await setup();
    const url = `${s.w}/sessions/${s.sessionId}/attendance`;
    await call('POST', url, s.ownerToken, {
      records: [{ membershipId: s.student, status: 'absent' }],
    });
    clock.set('2026-10-06T12:00:00Z'); // more than 48 hours after the 19:00 end
    const ownerToken = await signIn(app, s.owner, { twoFactor: true }); // sessions expire meanwhile
    const helper = await insertUser();
    const helperMembership = await insertMembership(s.workspaceId, helper, 'assistant');
    await adminQuery(
      `insert into permission_grants (workspace_id, id, membership_id, permission, granted_by, created_at)
       values ($1, gen_random_uuid(), $2, 'attendance.mark', $3, now())`,
      [s.workspaceId, helperMembership, s.owner],
    );
    const helperToken = await signIn(app, helper);
    const change = { records: [{ membershipId: s.student, status: 'excused' }] };
    expect((await call('POST', url, helperToken, change)).json<ErrorJson>().error.code).toBe(
      'attendance_locked',
    );
    expect((await call('POST', url, ownerToken, change)).json<ErrorJson>().error.code).toBe(
      'reason_required',
    );
    const ok = await call('POST', url, ownerToken, { ...change, reason: 'عذر طبي' });
    expect(ok.json()).toEqual({ saved: 1 });
    const [audit] = await adminQuery<{ old_value: { status: string }; reason: string }>(
      `select old_value, reason from audit_log where workspace_id = $1 and action = 'attendance.edited_late'`,
      [s.workspaceId],
    );
    expect(audit).toMatchObject({ old_value: { status: 'absent' }, reason: 'عذر طبي' });
  });

  it('cancelling a session with attendance needs confirmation; it then leaves the percentages', async () => {
    const s = await setup();
    const url = `${s.w}/sessions/${s.sessionId}/attendance`;
    await call('POST', url, s.ownerToken, {
      records: [{ membershipId: s.student, status: 'present' }],
    });
    const cancel = `${s.w}/sessions/${s.sessionId}/cancel`;
    expect(
      (await call('POST', cancel, s.ownerToken, { reason: 'خطأ في الموعد' })).json<ErrorJson>()
        .error.code,
    ).toBe('session_has_attendance');
    expect(
      (await call('POST', cancel, s.ownerToken, { reason: 'خطأ في الموعد', confirm: true }))
        .statusCode,
    ).toBe(204);
    const [kept] = await adminQuery<{ n: string }>(
      'select count(*) as n from attendance_records where session_id = $1',
      [s.sessionId],
    );
    expect(kept?.n).toBe('1');
    expect(
      (
        await call('POST', url, s.ownerToken, {
          records: [{ membershipId: s.student, status: 'late' }],
        })
      ).json<ErrorJson>().error.code,
    ).toBe('session_cancelled');

    const summary = (
      await call('GET', `${s.w}/classes/${s.classId}/attendance`, s.ownerToken)
    ).json<{ students: { membershipId: string; present: number; rate: number | null }[] }>();
    expect(summary.students.find((x) => x.membershipId === s.student)).toMatchObject({
      present: 0,
      rate: null,
    });
    const studentToken = await signIn(app, s.studentUser);
    const mine = (await call('GET', `${s.w}/my/attendance`, studentToken)).json<{
      records: { cancelled: boolean }[];
      rate: number | null;
    }>();
    expect(mine).toMatchObject({ records: [{ cancelled: true }], rate: null });
  });

  it('only staff whose scope covers the class can take attendance', async () => {
    const s = await setup();
    const url = `${s.w}/sessions/${s.sessionId}/attendance`;
    const other = (await call('POST', `${s.w}/classes`, s.ownerToken, { name: 'فصل آخر' })).json<{
      id: string;
    }>().id;
    const helper = await insertUser();
    const helperMembership = await insertMembership(s.workspaceId, helper, 'assistant');
    await call(
      'PUT',
      `${s.w}/memberships/${helperMembership}/permissions/attendance.mark`,
      s.ownerToken,
      { classIds: [other] },
    );
    const helperToken = await signIn(app, helper);
    expect((await call('GET', url, helperToken)).statusCode).toBe(404);
    const studentToken = await signIn(app, s.studentUser);
    expect((await call('GET', url, studentToken)).statusCode).toBe(403);
  });
});
