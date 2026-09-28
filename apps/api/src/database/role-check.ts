import type { Pool } from 'pg';

export type ApplicationRole = 'app_runtime' | 'app_platform';

interface RoleRow {
  rolsuper: boolean;
  rolbypassrls: boolean;
  is_expected: boolean;
  is_other: boolean;
}

export class UnsafeDatabaseRoleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeDatabaseRoleError';
  }
}

/**
 * Refuses to run the application with a connection that would silently bypass row-level security:
 * a superuser, a BYPASSRLS role, a user outside the expected group, or a user in both groups.
 */
export async function assertApplicationRole(pool: Pool, expected: ApplicationRole): Promise<void> {
  const other: ApplicationRole = expected === 'app_runtime' ? 'app_platform' : 'app_runtime';
  const { rows } = await pool.query<RoleRow>(
    `select r.rolsuper, r.rolbypassrls,
            pg_has_role(current_user, $1, 'MEMBER') as is_expected,
            pg_has_role(current_user, $2, 'MEMBER') as is_other
       from pg_roles r where r.rolname = current_user`,
    [expected, other],
  );
  const row = rows[0];
  const problems: string[] = [];
  if (!row) {
    problems.push('current user not found in pg_roles');
  } else {
    if (row.rolsuper) problems.push('connection user is a superuser');
    if (row.rolbypassrls) problems.push('connection user has BYPASSRLS');
    if (!row.is_expected) problems.push(`connection user is not a member of ${expected}`);
    if (row.is_other) problems.push(`connection user is also a member of ${other}`);
  }
  if (problems.length > 0) {
    throw new UnsafeDatabaseRoleError(
      `Unsafe database role for ${expected}: ${problems.join('; ')}`,
    );
  }
}
