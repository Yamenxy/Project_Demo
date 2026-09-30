import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Clock } from '../../common';
import { PlatformDb } from '../../database/platform-db';
import { AuditService } from '../audit';
import { FilesService } from '../files';
import { AnonymizeService } from './anonymize.service';

const MONTH = 30 * 24 * 3600 * 1000;
const YEAR = 365 * 24 * 3600 * 1000;

export interface RetentionCounts {
  homeworkFiles: number;
  proofFiles: number;
  securityRecords: number;
  notifications: number;
  auditLog: number;
  inactiveAccounts: number;
}

/**
 * The nightly retention job (REQ-PRIV-002): applies the rules in docs/retention.md that the
 * free setup has data for, and records each run in the audit log. Every rule removes only what
 * is past its own cutoff; each has a test with rows on both sides of it.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger('Retention');

  constructor(
    private readonly platformDb: PlatformDb,
    private readonly files: FilesService,
    private readonly anonymizer: AnonymizeService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  async run(): Promise<RetentionCounts> {
    const now = this.clock.now().getTime();
    const twelveMonths = new Date(now - 12 * MONTH);
    const counts: RetentionCounts = {
      // Homework files: 12 months after the homework's due date. Scores stay.
      homeworkFiles: await this.purgeFiles(sql`
        select f.workspace_id, f.id from files f
          join homework_submissions s on s.id = f.owner_id
          join homework h on h.id = s.homework_id
         where f.owner_type = 'homework_submission' and f.deleted_at is null
           and h.due_at < ${twelveMonths}`),
      // Payment proofs: 12 months after the decision (or the request, if it was withdrawn).
      proofFiles: await this.purgeFiles(sql`
        select f.workspace_id, f.id from files f
          join payment_requests r on r.id = f.owner_id
         where f.owner_type = 'payment_request' and f.deleted_at is null
           and (r.decided_at < ${twelveMonths}
                or (r.status = 'cancelled' and r.created_at < ${twelveMonths}))`),
      securityRecords: await this.purgeSecurityRecords(twelveMonths),
      notifications: await this.purgeLog('notifications', twelveMonths),
      auditLog: await this.purgeLog('audit_log', new Date(now - 5 * YEAR)),
      inactiveAccounts: await this.anonymizeInactive(new Date(now - 3 * YEAR)),
    };
    await this.platformDb.run('retention: record the run', (tx) =>
      this.audit.record(tx, {
        action: 'retention.run',
        workspaceId: null,
        actor: { type: 'system' },
        newValue: { ...counts },
      }),
    );
    this.logger.log({ event: 'retention_run', ...counts });
    return counts;
  }

  private async purgeFiles(query: ReturnType<typeof sql>): Promise<number> {
    const rows = await this.platformDb.run('retention: expired files', (tx) =>
      tx.execute<{ workspace_id: string; id: string }>(query),
    );
    const byWorkspace = new Map<string, string[]>();
    for (const r of rows.rows) {
      byWorkspace.set(r.workspace_id, [...(byWorkspace.get(r.workspace_id) ?? []), r.id]);
    }
    let purged = 0;
    for (const [workspaceId, ids] of byWorkspace) {
      purged += await this.files.purge(workspaceId, ids);
    }
    return purged;
  }

  /** Security records (sessions, devices, one-time codes, support sessions): 12 months. */
  private purgeSecurityRecords(cutoff: Date): Promise<number> {
    return this.platformDb.run('retention: security records', async (tx) => {
      const sessions = await tx.execute(sql`
        delete from sessions
         where coalesce(revoked_at, absolute_expires_at) < ${cutoff}
            or device_id in (select id from device_registrations where revoked_at < ${cutoff})`);
      const devices = await tx.execute(
        sql`delete from device_registrations where revoked_at < ${cutoff}`,
      );
      const codes = await tx.execute(sql`delete from otp_challenges where created_at < ${cutoff}`);
      const support = await tx.execute(
        sql`delete from support_sessions where coalesce(ended_at, expires_at) < ${cutoff}`,
      );
      return (
        (sessions.rowCount ?? 0) +
        (devices.rowCount ?? 0) +
        (codes.rowCount ?? 0) +
        (support.rowCount ?? 0)
      );
    });
  }

  private async purgeLog(parent: 'audit_log' | 'notifications', cutoff: Date): Promise<number> {
    const result = await this.platformDb.run(`retention: ${parent}`, (tx) =>
      tx.execute<{ n: number }>(sql`select app.purge_expired_log_rows(${parent}, ${cutoff}) as n`),
    );
    return result.rows[0]?.n ?? 0;
  }

  /**
   * Accounts with no activity for 3 years are anonymized, like a deletion. Workspace owners and
   * platform owners are left for the platform team, as with deletion requests.
   */
  private async anonymizeInactive(cutoff: Date): Promise<number> {
    const rows = await this.platformDb.run('retention: inactive accounts', (tx) =>
      tx.execute<{ id: string }>(sql`
        select u.id from users u
         where u.status <> 'anonymized'
           and greatest(u.created_at, u.updated_at,
                        coalesce((select max(s.last_seen_at) from sessions s where s.user_id = u.id),
                                 u.created_at)) < ${cutoff}
           and not exists (select 1 from workspaces w where w.owner_user_id = u.id)
           and not exists (select 1 from platform_owners p where p.user_id = u.id)`),
    );
    for (const r of rows.rows) await this.anonymizer.anonymize(r.id);
    return rows.rows.length;
  }
}
