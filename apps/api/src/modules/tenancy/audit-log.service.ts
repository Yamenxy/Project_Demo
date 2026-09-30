import { Injectable } from '@nestjs/common';
import { and, desc, eq, like, lt, or, sql } from 'drizzle-orm';
import { TenantDb } from '../../database';
import { auditLog } from '../audit';
import { users } from '../identity';

export interface AuditEntry {
  id: string;
  occurredAt: Date;
  action: string;
  actorType: 'user' | 'platform_owner' | 'support' | 'system';
  actorName: string | null;
  entityType: string | null;
  entityId: string | null;
  oldValue: unknown;
  newValue: unknown;
  reason: string | null;
}

const PAGE = 50;

/**
 * The workspace audit log for its owner (REQ-AUDIT-002): every event, support sessions and what
 * they viewed included. The personal context column (IP, user agent) is never returned.
 */
@Injectable()
export class AuditLogService {
  constructor(private readonly db: TenantDb) {}

  async list(
    workspaceId: string,
    filter: { before?: { at: Date; id: string }; area?: string },
  ): Promise<{ entries: AuditEntry[]; more: boolean }> {
    return this.db.inWorkspace(workspaceId, async (tx) => {
      const rows = await tx
        .select({ a: auditLog, actorName: users.nameAr })
        .from(auditLog)
        .leftJoin(users, eq(users.id, auditLog.actorUserId))
        .where(
          and(
            // Row-level security already limits reads to this workspace; this states it.
            eq(auditLog.workspaceId, workspaceId),
            filter.area ? like(auditLog.action, `${filter.area}.%`) : undefined,
            filter.before
              ? or(
                  lt(auditLog.occurredAt, filter.before.at),
                  and(
                    eq(auditLog.occurredAt, filter.before.at),
                    sql`${auditLog.id} < ${filter.before.id}`,
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(desc(auditLog.occurredAt), desc(auditLog.id))
        .limit(PAGE + 1);
      return {
        entries: rows.slice(0, PAGE).map(({ a, actorName }) => ({
          id: a.id,
          occurredAt: a.occurredAt,
          action: a.action,
          actorType: a.actorType,
          actorName: a.actorType === 'system' ? null : actorName,
          entityType: a.entityType,
          entityId: a.entityId,
          oldValue: a.oldValue,
          newValue: a.newValue,
          reason: a.reason,
        })),
        more: rows.length > PAGE,
      };
    });
  }
}
