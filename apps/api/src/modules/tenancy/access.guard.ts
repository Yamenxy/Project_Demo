import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { AppError, notFound } from '../../common';
import { ROUTE_POLICY, type RoutePolicy } from '../../common/policy';
import { isUuid, TenantDb } from '../../database';
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
      const membership = await this.memberships.resolve(tx, workspaceId, session.userId);
      if (!membership) return null;
      const permissions = await this.permissions.forMembership(
        tx,
        membership.membershipId,
        membership.role,
      );
      return { ...membership, permissions };
    });
    if (!resolved) throw notFound();
    if (resolved.status !== 'active') {
      throw new AppError(403, 'membership_not_active', 'Membership is not active');
    }
    if (TWO_FACTOR_ROLES.has(resolved.role) && !session.twoFactorEnabled) {
      throw twoFactorSetupRequired();
    }
    if (resolved.workspaceSuspended && !policy.allowWhenSuspended.includes(resolved.role)) {
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
}

function twoFactorSetupRequired(): AppError {
  return new AppError(403, 'two_factor_setup_required', 'Set up two-factor authentication first');
}
