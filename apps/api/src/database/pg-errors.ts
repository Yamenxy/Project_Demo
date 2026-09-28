interface PgErrorFields {
  code?: string;
  constraint?: string;
}

/** Unwraps Drizzle's query error to the underlying PostgreSQL error. */
function pgError(err: unknown): PgErrorFields {
  const inner: unknown =
    typeof err === 'object' && err !== null && 'cause' in err && err.cause ? err.cause : err;
  return typeof inner === 'object' && inner !== null ? inner : {};
}

/** True when the error is a unique violation of the named constraint or index. */
export function isUniqueViolation(err: unknown, constraint: string): boolean {
  const pg = pgError(err);
  return pg.code === '23505' && pg.constraint === constraint;
}
