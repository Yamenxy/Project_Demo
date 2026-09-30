import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminQuery, insertMembership, insertUser, insertWorkspace } from '../support/fixtures';
import { createIntegrationApp } from '../support/integration-app';
import { signIn } from '../support/sessions';

let app: NestFastifyApplication;

function call(method: 'GET' | 'POST', url: string, token: string, payload?: object) {
  return app.inject({
    method,
    url,
    cookies: { lms_session: token },
    ...(payload ? { payload } : {}),
  });
}

/** Parses CSV with quoted cells (RFC 4180), after checking the byte-order mark. */
function lines(body: string): string[][] {
  expect(body.startsWith('﻿')).toBe(true);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const text = body.slice(1);
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\r' && text[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
    } else cell += c;
  }
  return rows;
}

async function grant(
  workspaceId: string,
  membershipId: string,
  permission: string,
  by: string,
  classIds: string[] = [],
) {
  const id = randomUUID();
  await adminQuery(
    `insert into permission_grants (workspace_id, id, membership_id, permission, granted_by, created_at)
     values ($1, $2, $3, $4, $5, now())`,
    [workspaceId, id, membershipId, permission, by],
  );
  for (const classId of classIds) {
    await adminQuery(
      'insert into permission_grant_classes (workspace_id, grant_id, class_id) values ($1, $2, $3)',
      [workspaceId, id, classId],
    );
  }
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
  const student = await insertMembership(workspaceId, await insertUser(), 'student');
  // A name that a spreadsheet would run as a formula.
  await adminQuery(
    `update users set name_ar = '=HYPERLINK("http://evil.test","اضغط")'
      where id = (select user_id from memberships where id = $1)`,
    [student],
  );
  await call('POST', `${w}/classes/${classA}/students`, ownerToken, { membershipIds: [student] });
  return { owner, workspaceId, ownerToken, w, classA, classB, student };
}

beforeAll(async () => {
  app = await createIntegrationApp();
});

afterAll(async () => {
  await app.close();
});

describe('CSV exports (REQ-REPORT-001)', () => {
  it('exports the gradebook with a BOM and a neutralised formula name, and audits it', async () => {
    const s = await setup();
    const item = (
      await call('POST', `${s.w}/classes/${s.classA}/grade-items`, s.ownerToken, {
        title: 'اختبار 1',
        maxScore: 20,
      })
    ).json<{ id: string }>().id;
    await call('POST', `${s.w}/grade-items/${item}/scores`, s.ownerToken, {
      scores: [{ membershipId: s.student, score: 15 }],
    });
    const res = await call('GET', `${s.w}/exports/classes/${s.classA}/gradebook.csv`, s.ownerToken);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename\*=UTF-8''/);
    expect(res.body).toContain('الطالب,اختبار 1 (20),المتوسط %');
    // The formula is inert text: a leading apostrophe, inside quotes.
    expect(res.body).toContain(`"'=HYPERLINK(""http://evil.test"",""اضغط"")",15,75`);
    const english = await call(
      'GET',
      `${s.w}/exports/classes/${s.classA}/gradebook.csv?lang=en`,
      s.ownerToken,
    );
    expect(english.body).toContain('Student,اختبار 1 (20),Average %');
    const audit = await adminQuery<{ report: string; rows: number }>(
      `select new_value->>'report' as report, (new_value->>'rows')::int as rows from audit_log
        where workspace_id = $1 and action = 'data.exported'`,
      [s.workspaceId],
    );
    expect(audit).toEqual([
      { report: 'gradebook', rows: 1 },
      { report: 'gradebook', rows: 1 },
    ]);
  });

  it('needs data.export, and a class-scoped grant covers only its classes', async () => {
    const s = await setup();
    const teacher = await insertUser();
    const teacherMembership = await insertMembership(s.workspaceId, teacher, 'class_teacher');
    await call('POST', `${s.w}/classes/${s.classA}`, s.ownerToken, {
      responsibleMembershipId: teacherMembership,
    });
    const teacherToken = await signIn(app, teacher, { twoFactor: true });
    // The class teacher bundle has no data.export.
    expect(
      (await call('GET', `${s.w}/exports/classes/${s.classA}/attendance.csv`, teacherToken))
        .statusCode,
    ).toBe(403);

    const helper = await insertUser();
    const helperMembership = await insertMembership(s.workspaceId, helper, 'assistant');
    await grant(s.workspaceId, helperMembership, 'data.export', s.owner, [s.classA]);
    await grant(s.workspaceId, helperMembership, 'attendance.mark', s.owner, [s.classA]);
    const helperToken = await signIn(app, helper);
    const own = await call('GET', `${s.w}/exports/classes/${s.classA}/attendance.csv`, helperToken);
    expect(own.statusCode).toBe(200);
    expect(lines(own.body)[0]).toEqual([
      'الطالب',
      'حاضر',
      'متأخر',
      'غائب',
      'بعذر',
      'نسبة الحضور %',
    ]);
    expect(
      (await call('GET', `${s.w}/exports/classes/${s.classB}/attendance.csv`, helperToken))
        .statusCode,
    ).toBe(404);
    // Payment records are workspace-wide exports.
    expect(
      (await call('GET', `${s.w}/exports/payments.csv?from=2026-01-01&to=2026-12-31`, helperToken))
        .statusCode,
    ).toBe(403);
  });

  it('the cash report per collector matches the ledger, with the status of handovers (REQ-REPORT-002)', async () => {
    const s = await setup();
    const collector = await insertUser();
    const collectorMembership = await insertMembership(s.workspaceId, collector, 'assistant');
    await grant(s.workspaceId, collectorMembership, 'payments.record', s.owner);
    const collectorToken = await signIn(app, collector);
    for (const amount of [15000, 25000]) {
      const res = await call('POST', `${s.w}/payments`, collectorToken, {
        membershipId: s.student,
        amountPiastres: amount,
        method: 'cash',
      });
      expect(res.statusCode).toBe(201);
    }
    const handed = (
      await call('POST', `${s.w}/cash/handovers`, collectorToken, { amountPiastres: 30000 })
    ).json<{ id: string }>().id;
    await call('POST', `${s.w}/cash/handovers/${handed}/confirm`, s.ownerToken);
    await call('POST', `${s.w}/cash/handovers`, collectorToken, { amountPiastres: 5000 });

    const [today] = await adminQuery<{ d: string }>(
      `select to_char((now() at time zone 'Africa/Cairo')::date, 'YYYY-MM-DD') as d`,
    );
    const cash = await call(
      'GET',
      `${s.w}/exports/cash-day.csv?date=${today?.d ?? ''}&lang=en`,
      s.ownerToken,
    );
    expect(cash.statusCode).toBe(200);
    const rows = lines(cash.body);
    expect(rows[0]).toEqual([
      'Collected by',
      'Payments',
      'Collected',
      'Handed over (confirmed)',
      'Handed over (pending)',
      'Handover rejected',
    ]);
    expect(rows.slice(1).map((r) => r.slice(1))).toEqual([
      ['2', '400.00', '300.00', '50.00', '0.00'],
    ]);

    const payments = await call(
      'GET',
      `${s.w}/exports/payments.csv?from=${today?.d ?? ''}&to=${today?.d ?? ''}`,
      s.ownerToken,
    );
    const amounts = lines(payments.body)
      .slice(1)
      .map((r) => Number(r[3]));
    const [ledger] = await adminQuery<{ total: string }>(
      `select sum(amount_piastres) as total from payment_entries where workspace_id = $1`,
      [s.workspaceId],
    );
    expect(amounts.reduce((a, b) => a + b, 0) * 100).toBe(Number(ledger?.total));
  });
});
