/** SQLSTATE codes used in assertions. https://www.postgresql.org/docs/current/errcodes-appendix.html */
export const PG = {
  insufficientPrivilege: '42501',
  foreignKeyViolation: '23503',
  uniqueViolation: '23505',
} as const;

/** Resolves the SQLSTATE of a failed query, unwrapping Drizzle's error wrapper. */
export async function pgErrorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    const candidate = (err as { cause?: { code?: unknown }; code?: unknown }).cause ?? err;
    const code = (candidate as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    throw err;
  }
  throw new Error('Expected the query to fail, but it succeeded');
}
