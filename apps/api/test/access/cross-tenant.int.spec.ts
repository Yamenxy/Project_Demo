import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { adminQuery, insertMembership, insertUser, insertWorkspace } from '../support/fixtures';
import { createIntegrationApp } from '../support/integration-app';
import { fillPath, listRoutes, type RouteInfo } from '../support/routes';
import { signIn } from '../support/sessions';

/**
 * REQ-SEC-001: every workspace route, called by a fully privileged actor from another
 * workspace, must answer 404, both when pointed at the victim workspace and when pointed at the
 * attacker's own workspace with the victim's resource IDs.
 *
 * Routes are enumerated from the application itself, so a new route is covered automatically.
 * A new route parameter needs a fixture below (the test fails until one is added), and a route
 * that needs a body needs a sample body.
 */
let app: NestFastifyApplication;
let routes: RouteInfo[];

const victim = { workspaceId: '', membershipId: '', invitationId: '' };
const attacker = { workspaceId: '', token: '' };

/** Plausible request bodies, keyed by "METHOD path". Empty for routes without a body. */
const SAMPLE_BODIES: Record<string, object> = {
  'POST /api/v1/w/:workspaceId/students/:membershipId/remove': { reason: 'cross-tenant test' },
};

/** Victim resource IDs by route parameter name. */
function victimParams(): Record<string, string> {
  return {
    membershipId: victim.membershipId,
    invitationId: victim.invitationId,
    permission: 'attendance.mark',
  };
}

beforeAll(async () => {
  app = await createIntegrationApp();
  routes = listRoutes(app).filter((r) => r.policy?.kind === 'workspace');

  const victimOwner = await insertUser();
  victim.workspaceId = await insertWorkspace(victimOwner);
  victim.membershipId = await insertMembership(victim.workspaceId, await insertUser(), 'assistant');
  victim.invitationId = randomUUID();
  await adminQuery(
    `insert into workspace_invitations (workspace_id, id, phone_e164, role, token_hash, invited_by,
                                        created_at, expires_at)
     values ($1, $2, '+201012340000', 'assistant', $3, $4, now(), now() + interval '7 days')`,
    [victim.workspaceId, victim.invitationId, randomUUID(), victimOwner],
  );

  const attackerOwner = await insertUser();
  attacker.workspaceId = await insertWorkspace(attackerOwner);
  attacker.token = await signIn(app, attackerOwner, { twoFactor: true });
});

afterAll(async () => {
  await app.close();
});

function call(route: RouteInfo, workspaceId: string) {
  const url = fillPath(route.path, { ...victimParams(), workspaceId });
  const body = SAMPLE_BODIES[`${route.method} ${route.path}`];
  return app.inject({
    method: route.method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url,
    cookies: { lms_session: attacker.token },
    ...(body ? { payload: body } : {}),
  });
}

describe('cross-tenant isolation (all workspace routes)', () => {
  it('finds the workspace routes', () => {
    expect(routes.length).toBeGreaterThan(0);
  });

  it('answers 404 when another workspace owner calls into the victim workspace', async () => {
    const failures: string[] = [];
    for (const route of routes) {
      const res = await call(route, victim.workspaceId);
      if (res.statusCode !== 404)
        failures.push(`${route.method} ${route.path} → ${res.statusCode}`);
    }
    expect(failures).toEqual([]);
  });

  it("answers 404 when the victim's resources are addressed through the attacker's workspace", async () => {
    const failures: string[] = [];
    for (const route of routes.filter((r) => r.params.some((p) => p !== 'workspaceId'))) {
      const res = await call(route, attacker.workspaceId);
      if (res.statusCode !== 404)
        failures.push(`${route.method} ${route.path} → ${res.statusCode}`);
    }
    expect(failures).toEqual([]);
  });
});
