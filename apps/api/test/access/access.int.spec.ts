import { Controller, Get } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PlatformOwnerOnly, WorkspacePermission } from '../../src/common/policy';
import { adminQuery, insertMembership, insertUser, insertWorkspace } from '../support/fixtures';
import { createIntegrationApp } from '../support/integration-app';
import { signIn } from '../support/sessions';

// Probe routes exercising policies that no production route uses yet.
@Controller('v1/probe')
class ProbeController {
  @Get('platform')
  @PlatformOwnerOnly()
  platform(): { ok: true } {
    return { ok: true };
  }

  @Get('no-policy')
  unprotected(): { ok: true } {
    return { ok: true };
  }
}

@Controller('v1/w/:workspaceId/probe')
class WorkspaceProbeController {
  @Get('attendance')
  @WorkspacePermission('attendance.mark')
  attendance(): { ok: true } {
    return { ok: true };
  }
}

let app: NestFastifyApplication;

type ErrorJson = { error: { code: string } };
type ContextJson = {
  workspace: { suspended: boolean };
  membership: { role: string };
  permissions: string[];
};

function get(url: string, token: string | null) {
  return app.inject({ method: 'GET', url, cookies: token ? { lms_session: token } : {} });
}

function put(url: string, token: string) {
  return app.inject({ method: 'PUT', url, cookies: { lms_session: token } });
}

function del(url: string, token: string) {
  return app.inject({ method: 'DELETE', url, cookies: { lms_session: token } });
}

async function workspaceWithOwner() {
  const owner = await insertUser();
  const workspaceId = await insertWorkspace(owner);
  const ownerToken = await signIn(app, owner, { twoFactor: true });
  return { owner, workspaceId, ownerToken };
}

async function member(workspaceId: string, role: string, twoFactor = false) {
  const userId = await insertUser();
  const membershipId = await insertMembership(workspaceId, userId, role);
  return { userId, membershipId, token: await signIn(app, userId, { twoFactor }) };
}

beforeAll(async () => {
  app = await createIntegrationApp(undefined, [ProbeController, WorkspaceProbeController]);
});

afterAll(async () => {
  await app.close();
});

describe('deny by default', () => {
  it('refuses a route that declares no policy', async () => {
    const { ownerToken } = await workspaceWithOwner();
    const res = await get('/api/v1/probe/no-policy', ownerToken);
    expect(res.statusCode).toBe(403);
    expect(res.json<ErrorJson>().error.code).toBe('no_policy');
  });
});

describe('workspace membership', () => {
  it('describes the caller in the workspace, with all permissions for the owner', async () => {
    const { workspaceId, ownerToken } = await workspaceWithOwner();
    const res = await get(`/api/v1/w/${workspaceId}/context`, ownerToken);
    expect(res.statusCode).toBe(200);
    const body = res.json<ContextJson>();
    expect(body.membership.role).toBe('owner');
    expect(body.permissions).toContain('finance.view');
    expect(body.permissions).toHaveLength(22);
  });

  it('hides workspaces from non-members (404), including malformed ids', async () => {
    const { workspaceId } = await workspaceWithOwner();
    const outsider = await signIn(app, await insertUser());
    expect((await get(`/api/v1/w/${workspaceId}/context`, outsider)).statusCode).toBe(404);
    expect((await get('/api/v1/w/not-a-uuid/context', outsider)).statusCode).toBe(404);
    expect((await get(`/api/v1/w/${workspaceId}/context`, null)).statusCode).toBe(401);
  });

  it('requires 2FA for owners and class teachers before any workspace data', async () => {
    const owner = await insertUser();
    const workspaceId = await insertWorkspace(owner);
    const token = await signIn(app, owner); // no 2FA
    const res = await get(`/api/v1/w/${workspaceId}/context`, token);
    expect(res.statusCode).toBe(403);
    expect(res.json<ErrorJson>().error.code).toBe('two_factor_setup_required');
    const teacher = await member(workspaceId, 'class_teacher');
    expect(
      (await get(`/api/v1/w/${workspaceId}/context`, teacher.token)).json<ErrorJson>().error.code,
    ).toBe('two_factor_setup_required');
  });

  it('requires an active account', async () => {
    const { workspaceId } = await workspaceWithOwner();
    const pending = await insertUser('pending');
    await insertMembership(workspaceId, pending, 'student');
    const res = await get(`/api/v1/w/${workspaceId}/context`, await signIn(app, pending));
    expect(res.json<ErrorJson>().error.code).toBe('account_not_active');
  });

  it('refuses suspended and removed memberships', async () => {
    const { workspaceId } = await workspaceWithOwner();
    const suspended = await member(workspaceId, 'student');
    await adminQuery(`update memberships set status = 'suspended' where id = $1`, [
      suspended.membershipId,
    ]);
    const res = await get(`/api/v1/w/${workspaceId}/context`, suspended.token);
    expect(res.json<ErrorJson>().error.code).toBe('membership_not_active');
    const removed = await member(workspaceId, 'student');
    await adminQuery(`update memberships set status = 'removed' where id = $1`, [
      removed.membershipId,
    ]);
    expect((await get(`/api/v1/w/${workspaceId}/context`, removed.token)).statusCode).toBe(404);
  });
});

describe('permissions', () => {
  it('gives class teachers their default bundle and helpers nothing until granted', async () => {
    const { workspaceId } = await workspaceWithOwner();
    const teacher = await member(workspaceId, 'class_teacher', true);
    const helper = await member(workspaceId, 'assistant');
    const teacherPerms = (
      await get(`/api/v1/w/${workspaceId}/context`, teacher.token)
    ).json<ContextJson>().permissions;
    expect(teacherPerms).toContain('grading.release');
    expect(teacherPerms).not.toContain('finance.view');
    const helperPerms = (
      await get(`/api/v1/w/${workspaceId}/context`, helper.token)
    ).json<ContextJson>().permissions;
    expect(helperPerms).toEqual([]);
  });

  it('applies a grant or revocation on the very next request, and audits it', async () => {
    const { workspaceId, ownerToken } = await workspaceWithOwner();
    const helper = await member(workspaceId, 'assistant');
    const probe = `/api/v1/w/${workspaceId}/probe/attendance`;
    const grantUrl = `/api/v1/w/${workspaceId}/memberships/${helper.membershipId}/permissions/attendance.mark`;

    expect((await get(probe, helper.token)).statusCode).toBe(403);
    expect((await put(grantUrl, ownerToken)).statusCode).toBe(204);
    expect((await put(grantUrl, ownerToken)).statusCode).toBe(204); // idempotent
    expect((await get(probe, helper.token)).statusCode).toBe(200);
    expect((await del(grantUrl, ownerToken)).statusCode).toBe(204);
    expect((await get(probe, helper.token)).statusCode).toBe(403);

    const audit = await adminQuery<{ action: string }>(
      `select action from audit_log where entity_id = $1 order by occurred_at`,
      [helper.membershipId],
    );
    expect(audit.map((a) => a.action)).toEqual(['permission.granted', 'permission.revoked']);
  });

  it('never grants owner-only or class-teacher-only powers to helpers', async () => {
    const { workspaceId, ownerToken } = await workspaceWithOwner();
    const helper = await member(workspaceId, 'assistant');
    const student = await member(workspaceId, 'student');
    const base = `/api/v1/w/${workspaceId}/memberships`;
    for (const url of [
      `${base}/${helper.membershipId}/permissions/grading.release`,
      `${base}/${helper.membershipId}/permissions/staff.manage`,
      `${base}/${student.membershipId}/permissions/attendance.mark`,
    ]) {
      const res = await put(url, ownerToken);
      expect(res.statusCode).toBe(400);
      expect(res.json<ErrorJson>().error.code).toBe('permission_not_grantable');
    }
  });

  it('lets only the owner manage permissions, and only in their own workspace', async () => {
    const { workspaceId } = await workspaceWithOwner();
    const other = await workspaceWithOwner();
    const helper = await member(workspaceId, 'assistant');
    const teacher = await member(workspaceId, 'class_teacher', true);
    const url = `/api/v1/w/${workspaceId}/memberships/${helper.membershipId}/permissions/attendance.mark`;
    expect((await put(url, helper.token)).statusCode).toBe(403);
    expect((await put(url, teacher.token)).statusCode).toBe(403);
    // Another workspace's owner: not a member here.
    expect((await put(url, other.ownerToken)).statusCode).toBe(404);
    // The owner of workspace B targeting a membership of workspace A through B's URL.
    const crossUrl = `/api/v1/w/${other.workspaceId}/memberships/${helper.membershipId}/permissions/attendance.mark`;
    expect((await put(crossUrl, other.ownerToken)).statusCode).toBe(404);
  });
});

describe('suspended workspace', () => {
  it('keeps the context readable but blocks everything else', async () => {
    const { workspaceId, ownerToken } = await workspaceWithOwner();
    const helper = await member(workspaceId, 'assistant');
    await adminQuery(
      `update workspaces set suspended_at = now(), suspension_reason = 'billing' where id = $1`,
      [workspaceId],
    );
    const context = await get(`/api/v1/w/${workspaceId}/context`, helper.token);
    expect(context.statusCode).toBe(200);
    expect(context.json<ContextJson>().workspace.suspended).toBe(true);
    const grant = await put(
      `/api/v1/w/${workspaceId}/memberships/${helper.membershipId}/permissions/attendance.mark`,
      ownerToken,
    );
    expect(grant.statusCode).toBe(403);
    expect(grant.json<ErrorJson>().error.code).toBe('workspace_suspended');
  });
});

describe('platform owners', () => {
  it('allows platform owners with 2FA only', async () => {
    const user = await insertUser();
    const plain = await signIn(app, user);
    expect((await get('/api/v1/probe/platform', plain)).statusCode).toBe(403);
    await adminQuery('insert into platform_owners (user_id, created_at) values ($1, now())', [
      user,
    ]);
    const noTwoFactor = await get('/api/v1/probe/platform', plain);
    expect(noTwoFactor.json<ErrorJson>().error.code).toBe('two_factor_setup_required');
    const withTwoFactor = await signIn(app, user, { twoFactor: true });
    expect((await get('/api/v1/probe/platform', withTwoFactor)).statusCode).toBe(200);
  });
});
