import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { AppError, Clock, notFound } from '../../common';
import { ROUTE_POLICY, type RoutePolicy } from '../../common/policy';
import { isUuid, TenantDb } from '../../database';
import { AuditService } from '../audit';
import { SESSION_COOKIE, SessionsService } from '../identity';
import { MembershipsService, type MembershipContext } from './memberships.service';
import { PermissionsService, type PermissionSet } from './permissions.service';

export interface WorkspaceContext extends MembershipContext {
  permissions: PermissionSet;
}

declare module 'fastify' {
  interface FastifyRequest {
    workspace?: WorkspaceContext;
  }
}

/** Roles that must have 2FA before touching workspace data (REQ-AUTH-007). */
const TWO_FACTOR_ROLES = new Set(['owner', 'class_teacher']);

/**
 * The one access check for every route (architecture §3, REQ-RBAC-005):
 * 1. a route without a declared policy is refused (deny by default);
 * 2. the session cookie is resolved, and a pending second factor blocks everything except the
 *    routes that finish signing in;
 * 3. workspace routes resolve the caller's membership in the workspace named in the URL, fresh
 *    on every request, and check suspension, 2FA for owners and class teachers, and the
 *    required role or permission.
 *
 * Non-members get 404 (the workspace's existence isn't revealed); members lacking a permission
 * get 403 (REQ-SEC-001).
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionsService,
    private readonly memberships: MembershipsService,
    private readonly permissions: PermissionsService,
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policy = this.reflector.getAllAndOverride<RoutePolicy | undefined>(ROUTE_POLICY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!policy) throw new AppError(403, 'no_policy', 'Route has no access policy');
    if (policy.kind === 'public') return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const token = request.cookies[SESSION_COOKIE];
    const session = token ? await this.sessions.resolve(token) : null;
    if (!session) throw new AppError(401, 'unauthenticated', 'Authentication required');
    const allowPending = policy.kind === 'session' && policy.allowPendingSecondFactor;
    if (session.secondFactorPending && !allowPending) {
      throw new AppError(401, 'second_factor_required', 'Enter your authenticator code');
    }
    request.auth = session;
    if (policy.kind === 'session') return true;

    // Workspace and platform routes need a fully active account (phone verified).
    if (session.userStatus !== 'active') {
      throw new AppError(403, 'account_not_active', 'Verify your phone number first');
    }

    if (policy.kind === 'platform_owner') {
      if (!(await this.memberships.isPlatformOwner(session.userId))) {
        throw new AppError(403, 'forbidden', 'Not allowed');
      }
      if (!session.twoFactorEnabled) throw twoFactorSetupRequired();
      return true;
    }

    const params = request.params as Record<string, string | undefined>;
    const workspaceId = params.workspaceId;
    if (!workspaceId || !isUuid(workspaceId)) throw notFound();
    const resolved = await this.db.inWorkspace(workspaceId, async (tx) => {
      // A member, or else a platform owner with an open support session (REQ-RBAC-003).
      const membership =
        (await this.memberships.resolve(tx, workspaceId, session.userId)) ??
        (await this.memberships.resolveSupport(tx, workspaceId, session.userId, this.clock.now()));
      if (!membership) return null;
      const permissions = await this.permissions.forMembership(
        tx,
        membership.membershipId,
        membership.role,
      );
      return { ...membership, permissions };
    });
    if (!resolved) throw notFound();
    if (resolved.supportSessionId) {
      await this.admitSupport(request, resolved, policy, session.twoFactorEnabled);
      return true;
    }
    if (resolved.status !== 'active') {
      throw new AppError(403, 'membership_not_active', 'Membership is not active');
    }
    if (TWO_FACTOR_ROLES.has(resolved.role) && !session.twoFactorEnabled) {
      throw twoFactorSetupRequired();
    }
    // A student under 18 without guardian consent after the grace period (REQ-PRIV-001).
    if (resolved.role === 'student' && session.consent === 'overdue') {
      throw new AppError(403, 'guardian_consent_required', 'A guardian needs to give consent');
    }
    // Suspended (REQ-RBAC-004): the owner keeps read-only views, exports included, plus what a
    // route allows explicitly (billing and renewal); students keep what routes allow them (their
    // grades, attendance and payment history); class teachers and helpers get nothing.
    const ownerReading =
      resolved.role === 'owner' && (request.method === 'GET' || request.method === 'HEAD');
    if (
      resolved.workspaceSuspended &&
      !ownerReading &&
      !policy.allowWhenSuspended.includes(resolved.role)
    ) {
      throw new AppError(403, 'workspace_suspended', 'This workspace is temporarily unavailable');
    }
    const { requirement } = policy;
    const allowed =
      'permission' in requirement
        ? resolved.permissions.has(requirement.permission)
        : requirement.roles.includes(resolved.role);
    if (!allowed) throw new AppError(403, 'forbidden', 'Not allowed');

    request.workspace = resolved;
    return true;
  }

  /**
   * A support session: an owner's view, read-only and audited. Only safe methods pass; each
   * request is recorded in the workspace's audit log with the route and its ids (never the query
   * string, which can hold a searched name or phone), so the owner sees what was viewed.
   */
  private async admitSupport(
    request: FastifyRequest,
    context: WorkspaceContext,
    policy: Extract<RoutePolicy, { kind: 'workspace' }>,
    twoFactorEnabled: boolean,
  ): Promise<void> {
    if (!twoFactorEnabled) throw twoFactorSetupRequired();
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      throw new AppError(403, 'support_read_only', 'Support access is read-only');
    }
    // Looking is support; bulk downloads are not.
    if ((request.routeOptions.url ?? '').includes('/exports/')) {
      throw new AppError(403, 'support_no_export', 'Exports are not available to support');
    }
    const { requirement } = policy;
    const allowed =
      'permission' in requirement
        ? context.permissions.has(requirement.permission)
        : requirement.roles.includes(context.role);
    if (!allowed) throw new AppError(403, 'forbidden', 'Not allowed');
    await this.db.inWorkspace(context.workspaceId, (tx) =>
      this.audit.record(tx, {
        action: 'support.viewed',
        workspaceId: context.workspaceId,
        actor: { type: 'support', userId: context.userId },
        entity: { type: 'support_session', id: context.supportSessionId },
        newValue: {
          route: request.routeOptions.url ?? null,
          params: request.params as Record<string, string>,
        },
        requestId: String(request.id),
      }),
    );
    request.workspace = context;
  }
}

function twoFactorSetupRequired(): AppError {
  return new AppError(403, 'two_factor_setup_required', 'Set up two-factor authentication first');
}
