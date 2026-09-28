import { Inject, Injectable, Logger } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import { PLATFORM_POOL, type DbTx } from './types';

/**
 * Unscoped access across all workspaces (platform role). Importing this file is restricted by lint
 * to the tenancy and platform-admin modules (docs/architecture.md §4), and every use is logged
 * with a reason.
 */
@Injectable()
export class PlatformDb {
  private readonly logger = new Logger(PlatformDb.name);
  private readonly db: NodePgDatabase;

  constructor(@Inject(PLATFORM_POOL) pool: Pool) {
    this.db = drizzle(pool);
  }

  run<T>(reason: string, fn: (tx: DbTx) => Promise<T>): Promise<T> {
    if (reason.trim().length === 0) {
      return Promise.reject(new TypeError('A reason is required for platform database access'));
    }
    this.logger.log({ event: 'platform_db_access', reason });
    return this.db.transaction(fn);
  }
}
