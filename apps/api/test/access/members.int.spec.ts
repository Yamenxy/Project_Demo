import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminQuery, insertMembership, insertUser, insertWorkspace } from '../support/fixtures';
import { createIntegrationApp } from '../support/integration-app';
import { signIn } from '../support/sessions';

let app: NestFastifyApplication;

beforeAll(async () => {
  app = await createIntegrationApp();
});

afterAll(async () => {
  await app.close();
});

async function setup() {
  const owner = await insertUser();
  const workspaceId = await insertWorkspace(owner);
  const ownerToken = await signIn(app, owner, { twoFactor: true });
  const student = await insertUser();
  const studentMembership = await insertMembership(workspaceId, student, 'student');
  const studentToken = await signIn(app, student);
  return { owner, workspaceId, ownerToken, student, studentMembership, studentToken };
}

const reset = (workspaceId: string, membershipId: string, token: string) =>
  app.inject({
    method: 'POST',
    url: `/api/v1/w/${workspaceId}/memberships/${membershipId}/devices/reset`,
    cookies: { lms_session: token },
  });

const me = (token: string) =>
  app.inject({ method: 'GET', url: '/api/v1/auth/me', cookies: { lms_session: token } });

describe('staff reset of a student’s devices', () => {
  it('ends every session of the student, audits it and tells the student', async () => {
    const s = await setup();
    const res = await reset(s.workspaceId, s.studentMembership, s.ownerToken);
    expect(res.statusCode).toBe(200);
    expect((await me(s.studentToken)).statusCode).toBe(401);
    const audit = await adminQuery<{ action: string }>(
      'select action from audit_log where entity_id = $1',
      [s.studentMembership],
    );
    expect(audit).toEqual([{ action: 'student.devices_reset' }]);
    const notes = await adminQuery<{ type: string }>(
      'select type from notifications where recipient_user_id = $1',
      [s.student],
    );
    expect(notes).toEqual([{ type: 'account.devices_reset' }]);
  });

  it('needs the students.sessions_reset permission', async () => {
    const s = await setup();
    const helper = await insertUser();
    const helperMembership = await insertMembership(s.workspaceId, helper, 'assistant');
    const helperToken = await signIn(app, helper);
    expect((await reset(s.workspaceId, s.studentMembership, helperToken)).statusCode).toBe(403);
    await adminQuery(
      `insert into permission_grants (workspace_id, id, membership_id, permission, granted_by, created_at)
       values ($1, gen_random_uuid(), $2, 'students.sessions_reset', $3, now())`,
      [s.workspaceId, helperMembership, s.owner],
    );
    expect((await reset(s.workspaceId, s.studentMembership, helperToken)).statusCode).toBe(200);
  });

  it('only resets student accounts', async () => {
    const s = await setup();
    const helper = await insertUser();
    const helperMembership = await insertMembership(s.workspaceId, helper, 'assistant');
    const res = await reset(s.workspaceId, helperMembership, s.ownerToken);
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('not_a_student_account');
  });
});
