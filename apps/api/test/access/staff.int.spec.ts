import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminQuery, insertMembership, insertUser, insertWorkspace } from '../support/fixtures';
import { createIntegrationApp } from '../support/integration-app';
import { signIn } from '../support/sessions';

let app: NestFastifyApplication;

type ErrorJson = { error: { code: string } };
type StaffJson = {
  staff: { membershipId: string; role: string; granted: string[]; defaults: string[] }[];
  invitations: { id: string; status: string }[];
};

function call(method: 'GET' | 'POST' | 'DELETE', url: string, token: string, payload?: object) {
  return app.inject({
    method,
    url,
    cookies: { lms_session: token },
    ...(payload ? { payload } : {}),
  });
}

async function phoneOf(userId: string): Promise<string> {
  const [row] = await adminQuery<{ phone: string }>(
    'select phone_e164 as phone from users where id = $1',
    [userId],
  );
  return row?.phone ?? '';
}

async function workspace() {
  const owner = await insertUser();
  const workspaceId = await insertWorkspace(owner);
  return { owner, workspaceId, ownerToken: await signIn(app, owner, { twoFactor: true }) };
}

async function invite(workspaceId: string, ownerToken: string, phone: string, role = 'assistant') {
  const res = await call('POST', `/api/v1/w/${workspaceId}/staff/invitations`, ownerToken, {
    phone,
    role,
  });
  expect(res.statusCode).toBe(201);
  const link = res.json<{ link: string }>().link;
  const token = new URL(link, 'http://x').searchParams.get('t') ?? '';
  return { token, invitationId: res.json<{ invitation: { id: string } }>().invitation.id };
}

beforeAll(async () => {
  app = await createIntegrationApp();
});

afterAll(async () => {
  await app.close();
});

describe('inviting staff', () => {
  it('lets the invited number accept and join as a helper', async () => {
    const w = await workspace();
    const helper = await insertUser();
    const { token } = await invite(w.workspaceId, w.ownerToken, await phoneOf(helper));
    const helperToken = await signIn(app, helper);

    const preview = await call(
      'GET',
      `/api/v1/invitations/preview?w=${w.workspaceId}&t=${token}`,
      helperToken,
    );
    expect(preview.json()).toMatchObject({ role: 'assistant' });

    const accepted = await call('POST', '/api/v1/invitations/accept', helperToken, {
      workspaceId: w.workspaceId,
      token,
    });
    expect(accepted.statusCode).toBe(200);
    const context = await call('GET', `/api/v1/w/${w.workspaceId}/context`, helperToken);
    expect(context.json()).toMatchObject({ membership: { role: 'assistant' }, permissions: [] });

    const staff = (
      await call('GET', `/api/v1/w/${w.workspaceId}/staff`, w.ownerToken)
    ).json<StaffJson>();
    expect(staff.staff).toHaveLength(1);
    expect(staff.invitations[0]?.status).toBe('accepted');
    const notes = await adminQuery<{ type: string }>(
      'select type from notifications where recipient_user_id = $1',
      [w.owner],
    );
    expect(notes.map((n) => n.type)).toContain('staff.joined');
  });

  it('refuses a different number, a reused link, and a revoked or expired one', async () => {
    const w = await workspaceWithStaffInvite();
    const stranger = await signIn(app, await insertUser());
    const wrong = await call('POST', '/api/v1/invitations/accept', stranger, {
      workspaceId: w.workspaceId,
      token: w.token,
    });
    expect(wrong.json<ErrorJson>().error.code).toBe('invitation_phone_mismatch');

    const ok = await call('POST', '/api/v1/invitations/accept', w.inviteeToken, {
      workspaceId: w.workspaceId,
      token: w.token,
    });
    expect(ok.statusCode).toBe(200);
    const again = await call('POST', '/api/v1/invitations/accept', w.inviteeToken, {
      workspaceId: w.workspaceId,
      token: w.token,
    });
    expect(again.json<ErrorJson>().error.code).toBe('invitation_invalid');

    const other = await insertUser();
    const second = await invite(w.workspaceId, w.ownerToken, await phoneOf(other));
    expect(
      (
        await call(
          'DELETE',
          `/api/v1/w/${w.workspaceId}/staff/invitations/${second.invitationId}`,
          w.ownerToken,
        )
      ).statusCode,
    ).toBe(204);
    const revoked = await call('POST', '/api/v1/invitations/accept', await signIn(app, other), {
      workspaceId: w.workspaceId,
      token: second.token,
    });
    expect(revoked.json<ErrorJson>().error.code).toBe('invitation_invalid');

    const late = await insertUser();
    const third = await invite(w.workspaceId, w.ownerToken, await phoneOf(late));
    await adminQuery(
      `update workspace_invitations set created_at = now() - interval '8 days', expires_at = now() - interval '1 day' where id = $1`,
      [third.invitationId],
    );
    const expired = await call('POST', '/api/v1/invitations/accept', await signIn(app, late), {
      workspaceId: w.workspaceId,
      token: third.token,
    });
    expect(expired.json<ErrorJson>().error.code).toBe('invitation_invalid');
  });

  it("won't turn a student into staff in the same workspace", async () => {
    const w = await workspace();
    const student = await insertUser();
    await insertMembership(w.workspaceId, student, 'student');
    const { token } = await invite(w.workspaceId, w.ownerToken, await phoneOf(student));
    const res = await call('POST', '/api/v1/invitations/accept', await signIn(app, student), {
      workspaceId: w.workspaceId,
      token,
    });
    expect(res.json<ErrorJson>().error.code).toBe('already_member');
  });

  it('is for owners only', async () => {
    const w = await workspace();
    const helper = await insertUser();
    await insertMembership(w.workspaceId, helper, 'assistant');
    const res = await call(
      'POST',
      `/api/v1/w/${w.workspaceId}/staff/invitations`,
      await signIn(app, helper),
      {
        phone: '01012345678',
        role: 'assistant',
      },
    );
    expect(res.statusCode).toBe(403);
  });
});

describe('removing staff', () => {
  it('ends access on the next request, and a new invitation brings them back', async () => {
    const w = await workspaceWithStaffInvite('class_teacher');
    await call('POST', '/api/v1/invitations/accept', w.inviteeToken, {
      workspaceId: w.workspaceId,
      token: w.token,
    });
    await adminQuery(
      `update users set totp_secret_encrypted = 'v1.x', totp_enabled_at = now() where id = $1`,
      [w.invitee],
    );
    const staff = (
      await call('GET', `/api/v1/w/${w.workspaceId}/staff`, w.ownerToken)
    ).json<StaffJson>();
    const member = staff.staff[0];
    expect(member?.defaults).toContain('grading.release');

    expect(
      (
        await call(
          'DELETE',
          `/api/v1/w/${w.workspaceId}/staff/${member?.membershipId ?? ''}`,
          w.ownerToken,
        )
      ).statusCode,
    ).toBe(204);
    expect(
      (await call('GET', `/api/v1/w/${w.workspaceId}/context`, w.inviteeToken)).statusCode,
    ).toBe(404);

    const again = await invite(w.workspaceId, w.ownerToken, await phoneOf(w.invitee), 'assistant');
    const back = await call('POST', '/api/v1/invitations/accept', w.inviteeToken, {
      workspaceId: w.workspaceId,
      token: again.token,
    });
    expect(back.json<{ membershipId: string }>().membershipId).toBe(member?.membershipId);
  });
});

async function workspaceWithStaffInvite(role = 'assistant') {
  const w = await workspace();
  const invitee = await insertUser();
  const { token } = await invite(w.workspaceId, w.ownerToken, await phoneOf(invitee), role);
  return { ...w, invitee, token, inviteeToken: await signIn(app, invitee) };
}
