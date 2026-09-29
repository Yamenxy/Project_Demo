import { sql, type SQL } from 'drizzle-orm';
import type { PermissionKey } from '../../common/policy';
import type { WorkspaceContext } from './access.guard';
import { memberships } from './schema';

/**
 * Students the caller may act on for a key: everyone for a workspace-wide grant, otherwise
 * students enrolled in a covered class (REQ-RBAC-001). A condition on `memberships.id`.
 */
export function studentScope(ctx: WorkspaceContext, key: PermissionKey): SQL | undefined {
  const scope = ctx.permissions.scopeOf(key);
  if (scope === 'all') return undefined;
  const ids = [...scope];
  if (ids.length === 0) return sql`false`;
  return sql`exists (select 1 from class_enrollments ce
    where ce.membership_id = ${memberships.id} and ce.ended_at is null and ce.class_id in ${ids})`;
}
