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

const victim = {
  workspaceId: '',
  membershipId: '',
  invitationId: '',
  classId: '',
  seriesId: '',
  sessionId: '',
  itemId: '',
  paymentId: '',
  requestId: '',
  handoverId: '',
};
const attacker = { workspaceId: '', token: '', studentToken: '' };

/** Plausible request bodies, keyed by "METHOD path". Empty for routes without a body. */
const SAMPLE_BODIES: Record<string, object> = {
  'POST /api/v1/w/:workspaceId/students/:membershipId/remove': { reason: 'cross-tenant test' },
  'POST /api/v1/w/:workspaceId/students/:membershipId/consent': {},
  'POST /api/v1/w/:workspaceId/classes/:classId': { name: 'تغيير' },
  'POST /api/v1/w/:workspaceId/price-items/:itemId': { name: 'تغيير' },
  'POST /api/v1/w/:workspaceId/payments/:paymentId/reverse': { reason: 'cross-tenant test' },
  'POST /api/v1/w/:workspaceId/payment-requests/:requestId/reject': { reason: 'cross-tenant test' },
  'POST /api/v1/w/:workspaceId/classes/:classId/series': {
    weekday: 6,
    startTime: '17:00',
    durationMinutes: 60,
    startsOn: '2026-12-01',
  },
  'POST /api/v1/w/:workspaceId/classes/:classId/series/:seriesId/end': { endsOn: '2026-12-31' },
  'POST /api/v1/w/:workspaceId/classes/:classId/sessions': {
    date: '2026-12-05',
    startTime: '10:00',
    durationMinutes: 60,
  },
  'POST /api/v1/w/:workspaceId/sessions/:sessionId/cancel': { reason: 'cross-tenant test' },
  'POST /api/v1/w/:workspaceId/sessions/:sessionId/attendance': {
    records: [{ membershipId: randomUUID(), status: 'present' }],
  },
  'POST /api/v1/w/:workspaceId/classes/:classId/students': { membershipIds: [randomUUID()] },
  'POST /api/v1/w/:workspaceId/classes/:classId/students/:membershipId/transfer': {
    toClassId: randomUUID(),
  },
};

/** Victim resource IDs by route parameter name. */
function victimParams(): Record<string, string> {
  return {
    membershipId: victim.membershipId,
    invitationId: victim.invitationId,
    classId: victim.classId,
    seriesId: victim.seriesId,
    sessionId: victim.sessionId,
    date: '2026-12-25',
    itemId: victim.itemId,
    paymentId: victim.paymentId,
    requestId: victim.requestId,
    handoverId: victim.handoverId,
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
  victim.classId = randomUUID();
  await adminQuery(
    `insert into classes (workspace_id, id, name, responsible_membership_id, created_at, updated_at)
     values ($1, $2, 'فصل الضحية', (select id from memberships where workspace_id = $1 and role = 'owner'), now(), now())`,
    [victim.workspaceId, victim.classId],
  );
  victim.itemId = randomUUID();
  await adminQuery(
    `insert into price_items (workspace_id, id, name, amount_piastres, created_at, updated_at)
     values ($1, $2, 'بند الضحية', 1000, now(), now())`,
    [victim.workspaceId, victim.itemId],
  );
  victim.paymentId = randomUUID();
  await adminQuery(
    `insert into payment_entries (workspace_id, id, membership_id, kind, amount_piastres, method,
                                  receipt_number, recorded_by, recorded_at)
     values ($1, $2, $3, 'payment', 1000, 'transfer', 1, $4, now())`,
    [victim.workspaceId, victim.paymentId, victim.membershipId, victimOwner],
  );
  victim.requestId = randomUUID();
  await adminQuery(
    `insert into payment_requests (workspace_id, id, membership_id, submitted_by, amount_piastres,
                                   method, reference, status, created_at, updated_at)
     values ($1, $2, $3, $4, 1000, 'wallet', 'REF-VICTIM', 'pending', now(), now())`,
    [victim.workspaceId, victim.requestId, victim.membershipId, victimOwner],
  );
  victim.handoverId = randomUUID();
  await adminQuery(
    `insert into cash_handovers (workspace_id, id, handed_by, amount_piastres, status, created_at)
     values ($1, $2, $3, 1000, 'pending', now())`,
    [victim.workspaceId, victim.handoverId, victimOwner],
  );
  victim.seriesId = randomUUID();
  await adminQuery(
    `insert into class_series (workspace_id, id, class_id, weekday, start_time, duration_minutes,
                               starts_on, created_at)
     values ($1, $2, $3, 6, '17:00', 60, '2026-12-01', now())`,
    [victim.workspaceId, victim.seriesId, victim.classId],
  );
  victim.sessionId = randomUUID();
  await adminQuery(
    `insert into class_sessions (workspace_id, id, class_id, local_date, starts_at, ends_at,
                                 created_at)
     values ($1, $2, $3, '2026-12-05', '2026-12-05T08:00Z', '2026-12-05T09:00Z', now())`,
    [victim.workspaceId, victim.sessionId, victim.classId],
  );
  await adminQuery(
    `insert into workspace_invitations (workspace_id, id, phone_e164, role, token_hash, invited_by,
                                        created_at, expires_at)
     values ($1, $2, '+201012340000', 'assistant', $3, $4, now(), now() + interval '7 days')`,
    [victim.workspaceId, victim.invitationId, randomUUID(), victimOwner],
  );

  const attackerOwner = await insertUser();
  attacker.workspaceId = await insertWorkspace(attackerOwner);
  attacker.token = await signIn(app, attackerOwner, { twoFactor: true });
  // Student-only routes are called as a student of the attacker's workspace, so they reach the
  // resource lookup instead of stopping at the role check.
  const attackerStudent = await insertUser();
  await insertMembership(attacker.workspaceId, attackerStudent, 'student');
  attacker.studentToken = await signIn(app, attackerStudent);
});

function studentOnly(route: RouteInfo): boolean {
  const policy = route.policy;
  return (
    policy?.kind === 'workspace' &&
    'roles' in policy.requirement &&
    policy.requirement.roles.every((role) => role === 'student')
  );
}

afterAll(async () => {
  await app.close();
});

function call(route: RouteInfo, workspaceId: string) {
  const url = fillPath(route.path, { ...victimParams(), workspaceId });
  const body = SAMPLE_BODIES[`${route.method} ${route.path}`];
  return app.inject({
    method: route.method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url,
    cookies: { lms_session: studentOnly(route) ? attacker.studentToken : attacker.token },
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
