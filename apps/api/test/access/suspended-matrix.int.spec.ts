import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminQuery, insertMembership, insertUser, insertWorkspace } from '../support/fixtures';
import { createIntegrationApp } from '../support/integration-app';
import { fillPath, listRoutes, type RouteInfo } from '../support/routes';
import { signIn } from '../support/sessions';

let app: NestFastifyApplication;
let routes: RouteInfo[];
let workspaceId = '';
const tokens: Record<string, string> = {};

const ROLES = ['owner', 'class_teacher', 'assistant', 'student'] as const;

/**
 * What REQ-RBAC-004 allows in a suspended workspace: the owner's read-only views (and what a
 * route allows explicitly, billing), the student's own grades, attendance and payment history,
 * and nothing for class teachers and helpers.
 */
function expectedAllowed(route: RouteInfo, role: (typeof ROLES)[number]): boolean {
  if (route.policy?.kind !== 'workspace') return true;
  if (route.policy.allowWhenSuspended.includes(role)) return true;
  return role === 'owner' && route.method === 'GET';
}

beforeAll(async () => {
  app = await createIntegrationApp();
  routes = listRoutes(app).filter((r) => r.path.startsWith('/api/v1/w/:workspaceId'));
  const owner = await insertUser();
  workspaceId = await insertWorkspace(owner);
  tokens.owner = await signIn(app, owner, { twoFactor: true });
  for (const role of ['class_teacher', 'assistant', 'student'] as const) {
    const user = await insertUser();
    await insertMembership(workspaceId, user, role);
    tokens[role] = await signIn(app, user, { twoFactor: role === 'class_teacher' });
  }
  await adminQuery(
    `update workspaces set suspended_at = now(), suspension_reason = 'billing' where id = $1`,
    [workspaceId],
  );
});

afterAll(async () => {
  await app.close();
});

describe('suspended workspace matrix (REQ-RBAC-004)', () => {
  it('every route and role behaves as the requirement says', async () => {
    // Guard against checking nothing: the app has well over a hundred workspace routes.
    expect(routes.length).toBeGreaterThan(100);
    const mismatches: string[] = [];
    for (const route of routes) {
      const params: Record<string, string> = {
        workspaceId,
        file: 'master.m3u8',
        date: '2026-12-25',
      };
      for (const p of route.params) params[p] ??= randomUUID();
      const url = fillPath(route.path, params);
      for (const role of ROLES) {
        const res = await app.inject({
          method: route.method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
          url,
          cookies: { lms_session: tokens[role] ?? '' },
        });
        const blocked =
          res.statusCode === 403 &&
          (res.json<{ error?: { code?: string } }>().error?.code ?? '') === 'workspace_suspended';
        if (blocked === expectedAllowed(route, role)) {
          mismatches.push(`${role} ${route.method} ${route.path} → ${String(res.statusCode)}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('students keep their own grades, attendance and payment history', async () => {
    for (const path of ['my/grades', 'my/attendance', 'my/payments']) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/w/${workspaceId}/${path}`,
        cookies: { lms_session: tokens.student ?? '' },
      });
      expect(res.statusCode, path).toBe(200);
    }
  });
});
