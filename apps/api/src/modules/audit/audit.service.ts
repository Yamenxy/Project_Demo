import { Injectable } from '@nestjs/common';
import { Clock, IdGenerator } from '../../common';
import type { DbTx } from '../../database';
import { auditLog } from './schema';

export type AuditActor =
  | { type: 'user'; userId: string }
  | { type: 'platform_owner'; userId: string }
  | { type: 'support'; userId: string }
  | { type: 'system' };

export interface AuditEvent {
  /** `<domain>.<verb>`, for example `membership.paused` or `auth.password_reset`. */
  action: string;
  /** NULL for platform-level events. Must match the transaction's workspace otherwise. */
  workspaceId: string | null;
  actor: AuditActor;
  entity?: { type: string; id?: string };
  /** IDs, codes and non-personal values only. */
  oldValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  reason?: string;
  requestId?: string;
  /** Personal data (IP, user agent, names). Cleared when the person is anonymized. */
  personalContext?: Record<string, unknown>;
}

const ACTION_PATTERN = /^[a-z][a-z_]*(\.[a-z][a-z_]*)+$/;

/**
 * Writes audit events inside the caller's transaction, so the event and the change it describes
 * commit or roll back together (review §3.25).
 */
@Injectable()
export class AuditService {
  constructor(
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async record(tx: DbTx, event: AuditEvent): Promise<string> {
    if (!ACTION_PATTERN.test(event.action)) {
      throw new TypeError(`Invalid audit action "${event.action}"`);
    }
    const id = this.ids.newId();
    await tx.insert(auditLog).values({
      id,
      occurredAt: this.clock.now(),
      workspaceId: event.workspaceId,
      actorType: event.actor.type,
      actorUserId: event.actor.type === 'system' ? null : event.actor.userId,
      action: event.action,
      entityType: event.entity?.type ?? null,
      entityId: event.entity?.id ?? null,
      oldValue: event.oldValue ?? null,
      newValue: event.newValue ?? null,
      reason: event.reason ?? null,
      requestId: event.requestId ?? null,
      personalContext: event.personalContext ?? null,
    });
    return id;
  }
}
