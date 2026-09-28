import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import { isUuid, RUNTIME_POOL, type DbTx } from './types';

/**
 * The database handle for application code (runtime role, subject to row-level security).
 *
 * - `inWorkspace` scopes a transaction to one workspace. Tenant tables show and accept only that
 *   workspace's rows.
 * - `transaction` is unscoped: use it for global tables (users, sessions). Tenant tables are
 *   invisible inside it, so forgetting to scope fails closed.
 */
@Injectable()
export class TenantDb {
  private readonly db: NodePgDatabase;

  constructor(@Inject(RUNTIME_POOL) pool: Pool) {
    this.db = drizzle(pool);
  }

  transaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T> {
    return this.db.transaction(fn);
  }

  inWorkspace<T>(workspaceId: string, fn: (tx: DbTx) => Promise<T>): Promise<T> {
    if (!isUuid(workspaceId)) {
      return Promise.reject(new TypeError('workspaceId must be a UUID'));
    }
    return this.db.transaction(async (tx) => {
      // is_local = true: the setting ends with the transaction (SET LOCAL semantics), which keeps
      // it safe on pooled connections (REQ-DATA-001, review SCALE-05).
      await tx.execute(sql`select set_config('app.workspace_id', ${workspaceId}, true)`);
      return fn(tx);
    });
  }
}
