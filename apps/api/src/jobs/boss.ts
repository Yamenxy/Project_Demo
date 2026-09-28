import { PgBoss, type ConstructorOptions } from 'pg-boss';

export const JOB_SCHEMA = 'pgboss';

/**
 * Options shared by every pg-boss instance. Runtime instances never create or migrate the
 * schema (the runtime role can't), and index rebuilds are off because they need table ownership.
 */
export function bossOptions(connectionString: string): ConstructorOptions {
  return {
    connectionString,
    schema: JOB_SCHEMA,
    createSchema: false,
    migrate: false,
    reindex: false,
    max: 4,
  };
}

export function createBoss(connectionString: string): PgBoss {
  return new PgBoss(bossOptions(connectionString));
}
