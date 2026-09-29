import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OtpSender } from '../../src/modules/identity';
import { CapturingOtpSender } from '../support/capturing-otp-sender';
import { adminQuery, insertMembership, insertUser, insertWorkspace } from '../support/fixtures';
import { createIntegrationApp, randomIp, randomPhone } from '../support/integration-app';
import { signIn } from '../support/sessions';

const otp = new CapturingOtpSender();
let app: NestFastifyApplication;

type ErrorJson = { error: { code: string } };
type StatusJson = {
  state: string;
  dueAt: string | null;
  dateOfBirth: string | null;
  guardianPhone: string | null;
  method: string | null;
  version: string;
};
type ListJson = {
  students: { membershipId: string; consent: string | null }[];
  missingConsentCount: number;
};

function call(method: 'GET' | 'POST', url: string, token: string, payload?: object) {
  return app.inject({
    method,
    url,
    cookies: { lms_session: token },
    remoteAddress: randomIp(),
    ...(payload ? { payload } : {}),
  });
}

const e164 = (local: string) => `+20${local.slice(1)}`;

/** A date of birth `years` years before today. */
function bornYearsAgo(years: number): string {
  const now = new Date();
  return `${String(now.getUTCFullYear() - years)}-${now.toISOString().slice(5, 10)}`;
}

async function phoneOf(userId: string): Promise<string> {
  const [row] = await adminQuery<{ phone: string }>(
    'select phone_e164 as phone from users where id = $1',
    [userId],
  );
  return row?.phone ?? '';
}

beforeAll(async () => {
  app = await createIntegrationApp((builder) => builder.overrideProvider(OtpSender).useValue(otp));
});

afterAll(async () => {
  await app.close();
});

describe('guardian consent by code (REQ-PRIV-001)', () => {
  it('sends a code to the guardian and records the consent', async () => {
    const student = await insertUser();
    const token = await signIn(app, student);
    expect((await call('GET', '/api/v1/auth/consent', token)).json<StatusJson>()).toMatchObject({
      state: 'needed',
      dateOfBirth: null,
    });

    // OQ-09: the student's own number can't stand in for the guardian's.
    const own = await call('POST', '/api/v1/auth/consent/details', token, {
      dateOfBirth: bornYearsAgo(15),
      guardianPhone: `0${(await phoneOf(student)).slice(3)}`,
    });
    expect(own.json<ErrorJson>().error.code).toBe('guardian_phone_is_own');

    const guardian = randomPhone();
    const details = await call('POST', '/api/v1/auth/consent/details', token, {
      dateOfBirth: bornYearsAgo(15),
      guardianPhone: guardian,
    });
    expect(details.json<StatusJson>()).toMatchObject({
      state: 'needed',
      guardianPhone: e164(guardian),
    });
    expect(
      (
        await call('POST', '/api/v1/auth/consent/details', token, {
          dateOfBirth: bornYearsAgo(19),
        })
      ).json<ErrorJson>().error.code,
    ).toBe('date_of_birth_locked');

    expect((await call('POST', '/api/v1/auth/consent/send-code', token)).statusCode).toBe(202);
    const code = otp.lastCode(e164(guardian), 'guardian_consent') ?? '';
    expect(code).toMatch(/^\d{6}$/);
    const wrong = code === '000000' ? '111111' : '000000';
    expect(
      (await call('POST', '/api/v1/auth/consent/verify', token, { code: wrong })).json<ErrorJson>()
        .error.code,
    ).toBe('invalid_code');
    const verified = await call('POST', '/api/v1/auth/consent/verify', token, { code });
    expect(verified.json<StatusJson>()).toMatchObject({
      state: 'granted',
      method: 'otp',
      dueAt: null,
    });

    const [record] = await adminQuery<{ method: string; version: string; phone: string }>(
      `select method, version, guardian_phone_e164 as phone from guardian_consents where user_id = $1`,
      [student],
    );
    expect(record).toMatchObject({ method: 'otp', phone: e164(guardian) });
    expect(record?.version).toMatch(/^\d{4}-\d{2}$/);
    const audit = await adminQuery<{ action: string }>(
      `select action from audit_log where entity_id = $1 and action = 'consent.granted'`,
      [student],
    );
    expect(audit).toHaveLength(1);
    expect(
      (await call('POST', '/api/v1/auth/consent/send-code', token)).json<ErrorJson>().error.code,
    ).toBe('consent_not_needed');
  });

  it('a code sent to an old guardian number stops working when the number changes', async () => {
    const token = await signIn(app, await insertUser());
    const first = randomPhone();
    await call('POST', '/api/v1/auth/consent/details', token, {
      dateOfBirth: bornYearsAgo(14),
      guardianPhone: first,
    });
    await call('POST', '/api/v1/auth/consent/send-code', token);
    const code = otp.lastCode(e164(first), 'guardian_consent') ?? '';
    await call('POST', '/api/v1/auth/consent/details', token, { guardianPhone: randomPhone() });
    expect(
      (await call('POST', '/api/v1/auth/consent/verify', token, { code })).json<ErrorJson>().error
        .code,
    ).toBe('code_expired');
  });

  it('needs nothing from adults', async () => {
    const token = await signIn(app, await insertUser());
    const status = await call('POST', '/api/v1/auth/consent/details', token, {
      dateOfBirth: bornYearsAgo(18),
    });
    expect(status.json<StatusJson>()).toMatchObject({ state: 'not_required', dueAt: null });
    expect(
      (await call('POST', '/api/v1/auth/consent/send-code', token)).json<ErrorJson>().error.code,
    ).toBe('consent_not_needed');
  });
});

describe('the 14-day limit and paper consent', () => {
  it('blocks an overdue student, lists them for staff, and paper consent restores access', async () => {
    const owner = await insertUser();
    const workspaceId = await insertWorkspace(owner);
    const ownerToken = await signIn(app, owner, { twoFactor: true });
    const student = await insertUser();
    const membershipId = await insertMembership(workspaceId, student, 'student', {
      status: 'active',
    });
    await adminQuery(
      `update users set date_of_birth = $2, created_at = now() - interval '15 days' where id = $1`,
      [student, bornYearsAgo(13)],
    );
    const studentToken = await signIn(app, student);
    const context = await call('GET', `/api/v1/w/${workspaceId}/context`, studentToken);
    expect(context.statusCode).toBe(403);
    expect(context.json<ErrorJson>().error.code).toBe('guardian_consent_required');
    // The consent screens still work, so the student can fix it.
    expect((await call('GET', '/api/v1/auth/consent', studentToken)).json<StatusJson>().state).toBe(
      'overdue',
    );

    const missing = (
      await call('GET', `/api/v1/w/${workspaceId}/students?consent=missing`, ownerToken)
    ).json<ListJson>();
    expect(missing.missingConsentCount).toBe(1);
    expect(missing.students).toEqual([
      expect.objectContaining({ membershipId, consent: 'overdue' }),
    ]);
    expect(JSON.stringify(missing)).not.toContain('dateOfBirth');

    const recorded = await call(
      'POST',
      `/api/v1/w/${workspaceId}/students/${membershipId}/consent`,
      ownerToken,
      { note: 'نموذج ورقي موقّع من ولي الأمر' },
    );
    expect(recorded.statusCode).toBe(204);
    expect((await call('GET', `/api/v1/w/${workspaceId}/context`, studentToken)).statusCode).toBe(
      200,
    );
    const [paper] = await adminQuery<{ method: string; workspace: string; by: string }>(
      `select method, workspace_id as workspace, recorded_by as by
         from guardian_consents where user_id = $1`,
      [student],
    );
    expect(paper).toEqual({ method: 'paper', workspace: workspaceId, by: owner });
    const after = (
      await call('GET', `/api/v1/w/${workspaceId}/students?consent=missing`, ownerToken)
    ).json<ListJson>();
    expect(after.missingConsentCount).toBe(0);
    expect(
      (
        await call(
          'POST',
          `/api/v1/w/${workspaceId}/students/${membershipId}/consent`,
          ownerToken,
          {},
        )
      ).json<ErrorJson>().error.code,
    ).toBe('consent_not_needed');
  });

  it('never blocks staff for missing consent', async () => {
    const owner = await insertUser();
    const workspaceId = await insertWorkspace(owner);
    const helper = await insertUser();
    await insertMembership(workspaceId, helper, 'assistant', { status: 'active' });
    await adminQuery(`update users set created_at = now() - interval '30 days' where id = $1`, [
      helper,
    ]);
    const token = await signIn(app, helper);
    expect((await call('GET', `/api/v1/w/${workspaceId}/context`, token)).statusCode).toBe(200);
  });

  it('paper consent needs enrollment.manage and a student of this workspace', async () => {
    const owner = await insertUser();
    const workspaceId = await insertWorkspace(owner);
    const other = await insertWorkspace(await insertUser());
    const outsider = await insertMembership(other, await insertUser(), 'student');
    const ownerToken = await signIn(app, owner, { twoFactor: true });
    expect(
      (await call('POST', `/api/v1/w/${workspaceId}/students/${outsider}/consent`, ownerToken, {}))
        .statusCode,
    ).toBe(404);
    const helper = await insertUser();
    await insertMembership(workspaceId, helper, 'assistant');
    const student = await insertMembership(workspaceId, await insertUser(), 'student');
    expect(
      (
        await call(
          'POST',
          `/api/v1/w/${workspaceId}/students/${student}/consent`,
          await signIn(app, helper),
          {},
        )
      ).statusCode,
    ).toBe(403);
  });
});
