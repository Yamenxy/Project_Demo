import { Injectable, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { PlatformDb } from '../database/platform-db';
import { JobsRuntime } from './jobs.runtime';

/**
 * Platform maintenance jobs. They act across all workspaces, so they use the platform handle
 * (allowed for src/jobs by the lint rules).
 */
@Injectable()
export class MaintenanceJobs implements OnModuleInit {
  constructor(
    private readonly jobs: JobsRuntime,
    private readonly platformDb: PlatformDb,
  ) {}

  onModuleInit(): void {
    // Daily: idempotent, and keeps three months of audit partitions ready (REQ-DATA-004).
    this.jobs.register(
      'maintenance.audit_partitions',
      () => this.ensureAuditPartitions(),
      '0 3 * * *',
    );
  }

  async ensureAuditPartitions(): Promise<void> {
    await this.platformDb.run('audit partition maintenance', (tx) =>
      tx.execute(sql`select app.ensure_audit_partitions(3)`),
    );
  }
}
