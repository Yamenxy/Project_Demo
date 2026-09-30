import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminQuery, insertMembership, insertUser, insertWorkspace } from '../support/fixtures';
import { createIntegrationApp } from '../support/integration-app';
import { signIn } from '../support/sessions';

let app: NestFastifyApplication;

type ErrorJson = { error: { code: string } };
type ListJson = {
  students: {
    membershipId: string;
    name: string;
    status: string;
    managed: boolean;
    phoneE164?: string;
    guardianPhoneE164?: string;
  }[];
  pendingCount: number;
};

function call(method: 'GET' | 'POST', url: string, token: string, payload?: object) {
  return app.inject({
    method,
    url,
    cookies: { lms_session: token },
    ...(payload ? { payload } : {}),
  });
}

async function workspace() {
  const owner = await insertUser();
  const workspaceId = await insertWorkspace(owner);
  const [settings] = await adminQuery<{ code: string }>(
    'select join_code as code from workspace_settings where workspace_id = $1',
    [workspaceId],
  );
  return {
    owner,
    workspaceId,
    code: settings?.code ?? '',
    ownerToken: await signIn(app, owner, { twoFactor: true }),
  };
}

async function phoneOf(userId: string): Promise<string> {
  const [row] = await adminQuery<{ phone: string }>(
    'select phone_e164 as phone from users where id = $1',
    [userId],
  );
  return row?.phone ?? '';
}

beforeAll(async () => {
  app = await createIntegrationApp();
});

afterAll(async () => {
  await app.close();
});

describe('joining by code', () => {
  it('waits for approval, notifies the teacher, and opens the workspace once approved', async () => {
    const w = await workspace();
    const student = await insertUser();
    const token = await signIn(app, student);
    const joined = await call('POST', '/api/v1/join', token, { code: w.code.toLowerCase() });
    expect(joined.json()).toMatchObject({ workspaceId: w.workspaceId, status: 'pending' });
    // Asking again changes nothing.
    expect((await call('POST', '/api/v1/join', token, { code: w.code })).json()).toMatchObject({
      status: 'pending',
    });
    expect(
      (await call('GET', `/api/v1/w/${w.workspaceId}/context`, token)).json<ErrorJson>().error.code,
    ).toBe('membership_not_active');

    const list = (
      await call('GET', `/api/v1/w/${w.workspaceId}/students?status=pending`, w.ownerToken)
    ).json<ListJson>();
    expect(list.pendingCount).toBe(1);
    const request = list.students[0];
    expect(
      (
        await call(
          'POST',
          `/api/v1/w/${w.workspaceId}/students/${request?.membershipId ?? ''}/approve`,
          w.ownerToken,
        )
      ).statusCode,
    ).toBe(204);
    expect((await call('GET', `/api/v1/w/${w.workspaceId}/context`, token)).json()).toMatchObject({
      membership: { role: 'student' },
    });

    const types = async (userId: string) =>
      (
        await adminQuery<{ type: string }>(
          'select type from notifications where recipient_user_id = $1',
          [userId],
        )
      ).map((n) => n.type);
    expect(await types(w.owner)).toContain('student.join_requested');
    expect(await types(student)).toContain('student.join_approved');
  });

  it('admits at once when the teacher auto-approves, and a rotated code stops working', async () => {
    const w = await workspace();
    const settings = await call('POST', `/api/v1/w/${w.workspaceId}/joining`, w.ownerToken, {
      autoApproveJoins: true,
      rotateCode: true,
    });
    const { joinCode } = settings.json<{ joinCode: string }>();
    expect(joinCode).not.toBe(w.code);
    const token = await signIn(app, await insertUser());
    expect(
      (await call('POST', '/api/v1/join', token, { code: w.code })).json<ErrorJson>().error.code,
    ).toBe('join_code_invalid');
    expect((await call('POST', '/api/v1/join', token, { code: joinCode })).json()).toMatchObject({
      status: 'active',
    });
  });

  it('joins nothing with an unknown code, and joins by the public page slug', async () => {
    const w = await workspace();
    const token = await signIn(app, await insertUser());
    expect(
      (await call('POST', '/api/v1/join', token, { code: 'ZZZZZZ' })).json<ErrorJson>().error.code,
    ).toBe('join_code_invalid');
    const [row] = await adminQuery<{ slug: string }>('select slug from workspaces where id = $1', [
      w.workspaceId,
    ]);
    expect(
      (await call('POST', '/api/v1/join', token, { slug: row?.slug ?? '' })).json(),
    ).toMatchObject({
      workspaceId: w.workspaceId,
      status: 'pending',
    });
  });

  it('refuses staff joining as students, unverified accounts, and suspended workspaces', async () => {
    const w = await workspace();
    expect(
      (await call('POST', '/api/v1/join', w.ownerToken, { code: w.code })).json<ErrorJson>().error
        .code,
    ).toBe('already_member');
    const pending = await signIn(app, await insertUser('pending'));
    expect(
      (await call('POST', '/api/v1/join', pending, { code: w.code })).json<ErrorJson>().error.code,
    ).toBe('account_not_active');
    await adminQuery(
      `update workspaces set suspended_at = now(), suspension_reason = 'admin' where id = $1`,
      [w.workspaceId],
    );
    const someone = await signIn(app, await insertUser());
    expect(
      (await call('POST', '/api/v1/join', someone, { code: w.code })).json<ErrorJson>().error.code,
    ).toBe('join_code_invalid');
  });
});

describe('the student list', () => {
  it('is for staff with enrollment.manage, and searches by name or phone', async () => {
    const w = await workspace();
    const student = await insertUser();
    await insertMembership(w.workspaceId, student, 'student');
    const helper = await insertUser();
    const helperMembership = await insertMembership(w.workspaceId, helper, 'assistant');
    const helperToken = await signIn(app, helper);
    expect((await call('GET', `/api/v1/w/${w.workspaceId}/students`, helperToken)).statusCode).toBe(
      403,
    );
    await adminQuery(
      `insert into permission_grants (workspace_id, id, membership_id, permission, granted_by, created_at)
       values ($1, gen_random_uuid(), $2, 'enrollment.manage', $3, now())`,
      [w.workspaceId, helperMembership, w.owner],
    );
    await adminQuery(`update users set guardian_phone_e164 = '+201055550000' where id = $1`, [
      student,
    ]);
    const phone = await phoneOf(student);
    const byPhone = (
      await call(
        'GET',
        `/api/v1/w/${w.workspaceId}/students?q=${encodeURIComponent(`0${phone.slice(3)}`)}`,
        helperToken,
      )
    ).json<ListJson>();
    expect(byPhone.students).toHaveLength(1);
    expect(byPhone.students[0]?.phoneE164).toBe(phone);
    // The guardian's number, for the WhatsApp link (REQ-NOTIF-002), under the same rule.
    expect(byPhone.students[0]?.guardianPhoneE164).toBe('+201055550000');
    const byName = (
      await call(
        'GET',
        `/api/v1/w/${w.workspaceId}/students?q=${encodeURIComponent('تجريبي')}`,
        helperToken,
      )
    ).json<ListJson>();
    expect(byName.students.length).toBeGreaterThan(0);
  });

  it('lets only the owner remove a student, with a reason', async () => {
    const w = await workspace();
    const studentMembership = await insertMembership(w.workspaceId, await insertUser(), 'student');
    const teacher = await insertUser();
    await insertMembership(w.workspaceId, teacher, 'class_teacher');
    const teacherToken = await signIn(app, teacher, { twoFactor: true });
    const url = `/api/v1/w/${w.workspaceId}/students/${studentMembership}/remove`;
    expect((await call('POST', url, teacherToken, { reason: 'انتقل لمعلم آخر' })).statusCode).toBe(
      403,
    );
    expect((await call('POST', url, w.ownerToken, { reason: 'انتقل لمعلم آخر' })).statusCode).toBe(
      204,
    );
    const [audit] = await adminQuery<{ reason: string }>(
      `select reason from audit_log where entity_id = $1 and action = 'student.removed'`,
      [studentMembership],
    );
    expect(audit?.reason).toBe('انتقل لمعلم آخر');
  });
});

describe('managed students', () => {
  it('are claimed by the student with the recorded phone, keeping the record', async () => {
    const w = await workspace();
    const student = await insertUser();
    const created = await call('POST', `/api/v1/w/${w.workspaceId}/students`, w.ownerToken, {
      name: 'طالب مسجّل يدويًا',
      phone: `0${(await phoneOf(student)).slice(3)}`,
      internalCode: 'P-017',
    });
    expect(created.statusCode).toBe(201);
    const { membershipId, link } = created.json<{ membershipId: string; link: string }>();
    const token = new URL(link, 'http://x').searchParams.get('t') ?? '';

    const listed = (
      await call('GET', `/api/v1/w/${w.workspaceId}/students`, w.ownerToken)
    ).json<ListJson>();
    expect(listed.students.find((s) => s.membershipId === membershipId)).toMatchObject({
      managed: true,
    });

    const stranger = await signIn(app, await insertUser());
    expect(
      (
        await call('POST', '/api/v1/invitations/accept', stranger, {
          workspaceId: w.workspaceId,
          token,
        })
      ).json<ErrorJson>().error.code,
    ).toBe('invitation_phone_mismatch');

    const studentToken = await signIn(app, student);
    const claimed = await call('POST', '/api/v1/invitations/accept', studentToken, {
      workspaceId: w.workspaceId,
      token,
    });
    expect(claimed.json()).toMatchObject({ membershipId });
    expect(
      (await call('GET', `/api/v1/w/${w.workspaceId}/context`, studentToken)).json(),
    ).toMatchObject({
      membership: { id: membershipId, role: 'student' },
    });
  });

  it('keeps internal codes unique within the workspace', async () => {
    const w = await workspace();
    const add = (phone: string) =>
      call('POST', `/api/v1/w/${w.workspaceId}/students`, w.ownerToken, {
        name: 'طالب مسجّل يدويًا',
        phone,
        internalCode: 'DUP-1',
      });
    expect((await add('01011110001')).statusCode).toBe(201);
    expect((await add('01011110002')).json<ErrorJson>().error.code).toBe('internal_code_taken');
  });
});

describe('the staff home summary', () => {
  it('counts students for staff who manage them, and nothing for others', async () => {
    const w = await workspace();
    await insertMembership(w.workspaceId, await insertUser(), 'student', { status: 'active' });
    await insertMembership(w.workspaceId, await insertUser(), 'student', { status: 'pending' });
    await insertMembership(w.workspaceId, null, 'student', {
      status: 'active',
      provisional_name: 'سجل يدوي',
      provisional_phone: '+201012349999',
    });
    const summary = await call('GET', `/api/v1/w/${w.workspaceId}/summary`, w.ownerToken);
    expect(summary.json()).toEqual({
      students: { active: 2, pending: 1, managed: 1, missingConsent: 2 },
    });

    const helper = await insertUser();
    await insertMembership(w.workspaceId, helper, 'assistant');
    const helperToken = await signIn(app, helper);
    expect((await call('GET', `/api/v1/w/${w.workspaceId}/summary`, helperToken)).json()).toEqual({
      students: null,
    });
    const student = await insertUser();
    await insertMembership(w.workspaceId, student, 'student');
    expect(
      (await call('GET', `/api/v1/w/${w.workspaceId}/summary`, await signIn(app, student)))
        .statusCode,
    ).toBe(403);
  });
});
