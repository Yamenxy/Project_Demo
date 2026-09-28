import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from './permissions';

/**
 * Every route declares one policy (REQ-RBAC-005, deny by default). The global access guard
 * enforces it, and a test fails if any route has none.
 */
export const ROUTE_POLICY = 'routePolicy';

export type WorkspaceRoleName = 'owner' | 'class_teacher' | 'assistant' | 'student';

export type WorkspaceRequirement =
  { permission: PermissionKey } | { roles: readonly WorkspaceRoleName[] };

export type RoutePolicy =
  | { kind: 'public' }
  | { kind: 'session'; allowPendingSecondFactor: boolean }
  | { kind: 'platform_owner' }
  | {
      kind: 'workspace';
      requirement: WorkspaceRequirement;
      /** Roles that may still use this route while the workspace is suspended (REQ-RBAC-004). */
      allowWhenSuspended: readonly WorkspaceRoleName[];
    };

/** No sign-in needed. */
export const Public = () => SetMetadata(ROUTE_POLICY, { kind: 'public' } satisfies RoutePolicy);

/** Any signed-in user; workspace-independent routes such as the user's own account. */
export const Authenticated = (options: { allowPendingSecondFactor?: boolean } = {}) =>
  SetMetadata(ROUTE_POLICY, {
    kind: 'session',
    allowPendingSecondFactor: options.allowPendingSecondFactor ?? false,
  } satisfies RoutePolicy);

/** Platform owners, with 2FA set up and verified. */
export const PlatformOwnerOnly = () =>
  SetMetadata(ROUTE_POLICY, { kind: 'platform_owner' } satisfies RoutePolicy);

interface WorkspaceOptions {
  allowWhenSuspended?: readonly WorkspaceRoleName[];
}

/** A member of the workspace in the URL (`:workspaceId`) holding the permission. */
export const WorkspacePermission = (permission: PermissionKey, options: WorkspaceOptions = {}) =>
  SetMetadata(ROUTE_POLICY, {
    kind: 'workspace',
    requirement: { permission },
    allowWhenSuspended: options.allowWhenSuspended ?? [],
  } satisfies RoutePolicy);

/** A member of the workspace in the URL with one of these roles. */
export const WorkspaceRoles = (
  roles: readonly WorkspaceRoleName[],
  options: WorkspaceOptions = {},
) =>
  SetMetadata(ROUTE_POLICY, {
    kind: 'workspace',
    requirement: { roles },
    allowWhenSuspended: options.allowWhenSuspended ?? [],
  } satisfies RoutePolicy);
