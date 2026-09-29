import { randomInt } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminQuery, insertMembership, insertUser, insertWorkspace } from '../support/fixtures';
import { createIntegrationApp } from '../support/integration-app';
import { signIn } from '../support/sessions';
import { buildXlsx } from '../support/xlsx';

let app: NestFastifyApplication;

type Report = {
  committed: boolean;
  added: number;
  rows: { row: number; name: string; phone: string; internalCode: string | null; status: string }[];
};
type ErrorJson = { error: { code: string } };

function upload(
  workspaceId: string,
  token: string,
  file: Buffer,
  fileName: string,
  commit = false,
) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/w/${workspaceId}/students/import`,
    cookies: { lms_session: token },
    payload: { fileName, content: file.toString('base64'), commit },
  });
}

async function workspace() {
  const owner = await insertUser();
  const workspaceId = await insertWorkspace(owner);
  return { owner, workspaceId, ownerToken: await signIn(app, owner, { twoFactor: true }) };
}

async function phoneOf(userId: string): Promise<string> {
  const [row] = await adminQuery<{ phone: string }>(
    'select phone_e164 as phone from users where id = $1',
    [userId],
  );
  return row?.phone ?? '';
}

/** A number no fixture user has, in the local form Excel leaves (no leading zero). */
const freshLocal = () => `12${String(randomInt(10_000_000, 99_999_999))}`;

beforeAll(async () => {
  app = await createIntegrationApp();
});

afterAll(async () => {
  await app.close();
});

describe('student import (REQ-USER-002)', () => {
  it('previews, then adds managed records, and the report never reveals an account', async () => {
    const w = await workspace();
    const outsider = await insertUser(); // has an account, but isn't in this workspace
    const outsiderLocal = (await phoneOf(outsider)).slice(3);
    const member = await insertUser();
    await insertMembership(w.workspaceId, member, 'student');
    const memberPhone = await phoneOf(member);
    const newcomer = freshLocal();
    const file = buildXlsx([
      ['اسم الطالب', 'رقم الموبايل', 'الكود'],
      ['سارة علي', Number(newcomer), 'S-1'],
      ['منى حسن', outsiderLocal, 'S-2'],
      ['عضو حالي', `0${memberPhone.slice(3)}`, ''],
      ['مكرر', `0${newcomer}`, ''],
      ['بدون رقم', '', ''],
      ['رقم خطأ', '123', ''],
      ['كود مكرر', freshLocal(), 'S-1'],
    ]);

    const preview = (await upload(w.workspaceId, w.ownerToken, file, 'طلاب.xlsx')).json<Report>();
    expect(preview.committed).toBe(false);
    expect(preview.rows.map((r) => [r.row, r.status])).toEqual([
      [2, 'ok'],
      [3, 'ok'], // an existing account reads exactly like a new number
      [4, 'already_member'],
      [5, 'duplicate_in_file'],
      [6, 'missing_phone'],
      [7, 'invalid_phone'],
      [8, 'code_taken'],
    ]);
    expect(preview.rows[0]?.phone).toBe(`+20${newcomer}`);
    expect(preview.added).toBe(2);
    const [before] = await adminQuery<{ n: string }>(
      `select count(*) as n from memberships where workspace_id = $1 and user_id is null`,
      [w.workspaceId],
    );
    expect(before?.n).toBe('0');

    const done = await upload(w.workspaceId, w.ownerToken, file, 'طلاب.xlsx', true);
    expect(done.json<Report>()).toMatchObject({ committed: true, added: 2 });
    const records = await adminQuery<{ name: string; phone: string; code: string }>(
      `select provisional_name as name, provisional_phone as phone, internal_code as code
         from memberships where workspace_id = $1 and user_id is null order by internal_code`,
      [w.workspaceId],
    );
    expect(records.map((r) => r.code)).toEqual(['S-1', 'S-2']);
    const audit = await adminQuery<{ action: string }>(
      `select action from audit_log where workspace_id = $1 and action in
         ('student.managed_created', 'students.imported')`,
      [w.workspaceId],
    );
    expect(audit).toHaveLength(3);

    // Importing the same file again adds nobody.
    const again = (
      await upload(w.workspaceId, w.ownerToken, file, 'طلاب.xlsx', true)
    ).json<Report>();
    expect(again.added).toBe(0);
    expect(again.rows.slice(0, 2).map((r) => r.status)).toEqual([
      'already_member',
      'already_member',
    ]);

    // The student with an account joins by code and lands on the imported record.
    const outsiderToken = await signIn(app, outsider);
    const [settings] = await adminQuery<{ code: string }>(
      'select join_code as code from workspace_settings where workspace_id = $1',
      [w.workspaceId],
    );
    const joined = await app.inject({
      method: 'POST',
      url: '/api/v1/join',
      cookies: { lms_session: outsiderToken },
      payload: { code: settings?.code },
    });
    expect(joined.json()).toMatchObject({ status: 'active' });
    const [claimed] = await adminQuery<{ code: string; n: string }>(
      `select internal_code as code, (select count(*) from memberships
          where workspace_id = $1 and user_id = $2) as n
         from memberships where workspace_id = $1 and user_id = $2`,
      [w.workspaceId, outsider],
    );
    expect(claimed).toEqual({ code: 'S-2', n: '1' });
  });

  it('reads Windows-1256 CSV files', async () => {
    const w = await workspace();
    const local = freshLocal();
    const csv = Buffer.concat([
      // "الاسم,الموبايل\r\nأحمد,"
      Buffer.from([
        0xc7, 0xe1, 0xc7, 0xd3, 0xe3, 0x2c, 0xc7, 0xe1, 0xe3, 0xe6, 0xc8, 0xc7, 0xed, 0xe1, 0x0d,
        0x0a, 0xc3, 0xcd, 0xe3, 0xcf, 0x2c,
      ]),
      Buffer.from(local),
    ]);
    const report = (await upload(w.workspaceId, w.ownerToken, csv, 'students.csv')).json<Report>();
    expect(report.rows).toEqual([
      { row: 2, name: 'أحمد', phone: `+20${local}`, internalCode: null, status: 'ok' },
    ]);
  });

  it('refuses unreadable, empty and oversized files', async () => {
    const w = await workspace();
    const code = async (file: Buffer, name: string) =>
      (await upload(w.workspaceId, w.ownerToken, file, name)).json<ErrorJson>().error.code;
    expect(await code(Buffer.from('not a zip'), 'x.xlsx')).toBe('import_unreadable');
    expect(await code(Buffer.from('\n\n'), 'x.csv')).toBe('import_empty');
    const rows = Array.from({ length: 1001 }, (_, i) => `طالب ${String(i)},${freshLocal()}`);
    expect(await code(Buffer.from(rows.join('\n')), 'x.csv')).toBe('import_too_large');
    expect(
      (await upload(w.workspaceId, w.ownerToken, Buffer.alloc(600 * 1024, 0x41), 'x.csv'))
        .statusCode,
    ).toBe(400);
  });

  it('needs students.import; enrollment.manage alone is not enough', async () => {
    const w = await workspace();
    const helper = await insertUser();
    const membership = await insertMembership(w.workspaceId, helper, 'assistant');
    const grant = (permission: string) =>
      adminQuery(
        `insert into permission_grants (workspace_id, id, membership_id, permission, granted_by, created_at)
         values ($1, gen_random_uuid(), $2, $3, $4, now())`,
        [w.workspaceId, membership, permission, w.owner],
      );
    await grant('enrollment.manage');
    const token = await signIn(app, helper);
    const file = Buffer.from(`name,phone\nسارة,${freshLocal()}`);
    expect((await upload(w.workspaceId, token, file, 'x.csv')).statusCode).toBe(403);
    await grant('students.import');
    expect((await upload(w.workspaceId, token, file, 'x.csv', true)).json<Report>().added).toBe(1);
  });
});
