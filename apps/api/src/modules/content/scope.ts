import { sql, type SQL } from 'drizzle-orm';
import type { PermissionKey } from '../../common/policy';
import type { WorkspaceContext } from '../tenancy';
import { courses } from './schema';

export interface Actor {
  userId: string;
  requestId?: string;
}

/**
 * Courses a staff member may act on for a key: all of them for a workspace-wide grant, otherwise
 * the courses linked to classes in scope (Appendix A.2: "courses linked to scoped classes").
 */
export function courseScope(ctx: WorkspaceContext, key: PermissionKey): SQL | undefined {
  const scope = ctx.permissions.scopeOf(key);
  if (scope === 'all') return undefined;
  const ids = [...scope];
  if (ids.length === 0) return sql`false`;
  return sql`${courses.id} in (select c.course_id from classes c
    where c.id in ${ids} and c.course_id is not null)`;
}
