import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Clock, FixedClock } from '../../src/common';
import { adminQuery, insertMembership, insertUser, insertWorkspace } from '../support/fixtures';
import { createIntegrationApp } from '../support/integration-app';
import { signIn } from '../support/sessions';

// A Thursday. Egypt's summer time (UTC+3) ends on Thursday 29 October 2026 (back to UTC+2).
const clock = new FixedClock('2026-10-01T08:00:00Z');
let app: NestFastifyApplication;

type ErrorJson = { error: { code: string } };
type Session = {
  id: string;
  localDate: string;
  startsAt: string;
  endsAt: string;
  cancelled: boolean;
};
type Schedule = { series: { id: string }[]; sessions: Session[] };

function call(method: 'GET' | 'POST' | 'DELETE', url: string, token: string, payload?: object) {
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
  const classId = (
    await call('POST', `${w}/classes`, ownerToken, { name: 'فيزياء — السبت' })
  ).json<{ id: string }>().id;
  return { owner, workspaceId, ownerToken, w, classId };
}

const saturdays = { weekday: 6, startTime: '17:00', durationMinutes: 120, startsOn: '2026-10-01' };

beforeAll(async () => {
  app = await createIntegrationApp((builder) => builder.overrideProvider(Clock).useValue(clock));
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  clock.set('2026-10-01T08:00:00Z');
});

describe('schedules (REQ-SCHED-001, REQ-SCHED-002)', () => {
  it('a Saturday 17:00 Cairo series stays at 17:00 local time across the DST change', async () => {
    const s = await setup();
    const created = await call(
      'POST',
      `${s.w}/classes/${s.classId}/series`,
      s.ownerToken,
      saturdays,
    );
    expect(created.statusCode).toBe(201);
    expect(created.json<{ warnings: unknown[] }>().warnings).toEqual([]);

    const schedule = (
      await call('GET', `${s.w}/classes/${s.classId}/schedule`, s.ownerToken)
    ).json<Schedule>();
    const byDate = Object.fromEntries(schedule.sessions.map((x) => [x.localDate, x.startsAt]));
    expect(byDate['2026-10-03']).toBe('2026-10-03T14:00:00.000Z'); // UTC+3
    expect(byDate['2026-10-24']).toBe('2026-10-24T14:00:00.000Z');
    expect(byDate['2026-10-31']).toBe('2026-10-31T15:00:00.000Z'); // UTC+2
    expect(schedule.sessions[0]?.endsAt).toBe('2026-10-03T16:00:00.000Z');
    // Eight weeks ahead, and reading again creates nothing twice.
    expect(schedule.sessions).toHaveLength(8);
    await call('GET', `${s.w}/classes/${s.classId}/schedule`, s.ownerToken);
    const [count] = await adminQuery<{ n: string }>(
      'select count(*) as n from class_sessions where class_id = $1',
      [s.classId],
    );
    expect(count?.n).toBe('8');
  });

  it('skips holidays, and removing the holiday brings the session back', async () => {
    const s = await setup();
    await call('POST', `${s.w}/classes/${s.classId}/series`, s.ownerToken, saturdays);
    const added = await call('POST', `${s.w}/skip-dates`, s.ownerToken, {
      date: '2026-10-10',
      reason: 'إجازة',
    });
    expect(added.statusCode).toBe(204);
    let dates = (await call('GET', `${s.w}/classes/${s.classId}/schedule`, s.ownerToken))
      .json<Schedule>()
      .sessions.map((x) => x.localDate);
    expect(dates).not.toContain('2026-10-10');
    await call('DELETE', `${s.w}/skip-dates/2026-10-10`, s.ownerToken);
    dates = (await call('GET', `${s.w}/classes/${s.classId}/schedule`, s.ownerToken))
      .json<Schedule>()
      .sessions.map((x) => x.localDate);
    expect(dates).toContain('2026-10-10');
  });

  it('warns about overlapping sessions of the same teacher without blocking', async () => {
    const s = await setup();
    const other = (
      await call('POST', `${s.w}/classes`, s.ownerToken, { name: 'كيمياء — السبت' })
    ).json<{ id: string }>().id;
    await call('POST', `${s.w}/classes/${s.classId}/series`, s.ownerToken, saturdays);
    const overlapping = await call('POST', `${s.w}/classes/${other}/series`, s.ownerToken, {
      ...saturdays,
      startTime: '18:00',
    });
    expect(overlapping.statusCode).toBe(201);
    const warnings = overlapping.json<{ warnings: { className: string }[] }>().warnings;
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]?.className).toBe('فيزياء — السبت');
    const oneOff = await call('POST', `${s.w}/classes/${other}/sessions`, s.ownerToken, {
      date: '2026-10-05',
      startTime: '10:00',
      durationMinutes: 60,
    });
    expect(oneOff.json<{ warnings: unknown[] }>().warnings).toEqual([]);
  });

  it('cancels and restores a session, ends a series, and shows students their sessions', async () => {
    const s = await setup();
    const series = (
      await call('POST', `${s.w}/classes/${s.classId}/series`, s.ownerToken, saturdays)
    ).json<{ id: string }>().id;
    const first = (
      await call('GET', `${s.w}/classes/${s.classId}/schedule`, s.ownerToken)
    ).json<Schedule>().sessions[0];
    const cancelled = await call('POST', `${s.w}/sessions/${first?.id}/cancel`, s.ownerToken, {
      reason: 'ظرف طارئ',
    });
    expect(cancelled.statusCode).toBe(204);

    const student = await insertUser();
    const membership = await insertMembership(s.workspaceId, student, 'student');
    await call('POST', `${s.w}/classes/${s.classId}/students`, s.ownerToken, {
      membershipIds: [membership],
    });
    const studentToken = await signIn(app, student);
    const agenda = (
      await call('GET', `${s.w}/sessions?from=2026-10-01&to=2026-10-15`, studentToken)
    ).json<{ sessions: Session[] }>();
    expect(agenda.sessions.map((x) => [x.localDate, x.cancelled])).toEqual([
      ['2026-10-03', true],
      ['2026-10-10', false],
    ]);
    await call('POST', `${s.w}/sessions/${first?.id}/restore`, s.ownerToken);

    const ended = await call(
      'POST',
      `${s.w}/classes/${s.classId}/series/${series}/end`,
      s.ownerToken,
      { endsOn: '2026-10-10' },
    );
    expect(ended.statusCode).toBe(204);
    const left = (
      await call('GET', `${s.w}/classes/${s.classId}/schedule`, s.ownerToken)
    ).json<Schedule>().sessions;
    expect(left.map((x) => [x.localDate, x.cancelled])).toEqual([
      ['2026-10-03', false],
      ['2026-10-10', false],
    ]);
    const audit = await adminQuery<{ action: string }>(
      `select action from audit_log where workspace_id = $1 and action like 'schedule.%'
        order by occurred_at`,
      [s.workspaceId],
    );
    // The clock is frozen, so the events share a timestamp: compare them as a set.
    expect(audit.map((x) => x.action).sort()).toEqual([
      'schedule.series_created',
      'schedule.series_ended',
      'schedule.session_cancelled',
      'schedule.session_restored',
    ]);
  });

  it('checks scope and inputs', async () => {
    const s = await setup();
    const helper = await insertUser();
    await insertMembership(s.workspaceId, helper, 'assistant');
    const helperToken = await signIn(app, helper);
    expect(
      (await call('POST', `${s.w}/classes/${s.classId}/series`, helperToken, saturdays)).statusCode,
    ).toBe(403);
    const bad = await call('POST', `${s.w}/classes/${s.classId}/series`, s.ownerToken, {
      ...saturdays,
      startTime: '25:00',
    });
    expect(bad.statusCode).toBe(400);
    const range = await call('GET', `${s.w}/sessions?from=2026-10-01&to=2027-01-01`, s.ownerToken);
    expect(range.json<ErrorJson>().error.code).toBe('invalid_range');
  });
});
