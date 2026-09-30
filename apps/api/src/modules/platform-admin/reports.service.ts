import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Clock, notFound } from '../../common';
import { PlatformDb } from '../../database/platform-db';
import { AuditService } from '../audit';
import type { Actor } from './platform.service';

export interface CommentReportView {
  commentId: string;
  workspaceId: string;
  workspaceName: string;
  body: string;
  authorName: string;
  side: 'student' | 'staff';
  commentedAt: Date;
  hidden: boolean;
  reports: { reason: string; reporterName: string; reportedAt: Date }[];
}

interface ReportRow extends Record<string, unknown> {
  comment_id: string;
  workspace_id: string;
  workspace_name: string;
  body: string;
  author_name: string;
  side: 'student' | 'staff';
  commented_at: Date;
  hidden: boolean;
  reason: string;
  reporter_name: string;
  reported_at: Date;
}

/**
 * The platform owners' queue of reported homework comments (REQ-MSG-001). Reports on the same
 * comment are handled together: dismissed, or the comment is hidden from everyone.
 */
@Injectable()
export class CommentReportsService {
  constructor(
    private readonly platformDb: PlatformDb,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  async open(): Promise<CommentReportView[]> {
    const rows = await this.platformDb.run('platform console: open comment reports', (tx) =>
      tx.execute<ReportRow>(sql`
        select c.id as comment_id, c.workspace_id, w.name as workspace_name, c.body,
               a.name_ar as author_name, c.author_side as side, c.created_at as commented_at,
               c.hidden_at is not null as hidden, r.reason, u.name_ar as reporter_name,
               r.created_at as reported_at
          from comment_reports r
          join homework_comments c on c.id = r.comment_id
          join workspaces w on w.id = c.workspace_id
          join users a on a.id = c.author_user_id
          join users u on u.id = r.reported_by
         where r.resolved_at is null
         order by r.created_at, r.id
         limit 200`),
    );
    const byComment = new Map<string, CommentReportView>();
    for (const row of rows.rows) {
      let item = byComment.get(row.comment_id);
      if (!item) {
        item = {
          commentId: row.comment_id,
          workspaceId: row.workspace_id,
          workspaceName: row.workspace_name,
          body: row.body,
          authorName: row.author_name,
          side: row.side,
          commentedAt: new Date(row.commented_at),
          hidden: row.hidden,
          reports: [],
        };
        byComment.set(row.comment_id, item);
      }
      item.reports.push({
        reason: row.reason,
        reporterName: row.reporter_name,
        reportedAt: new Date(row.reported_at),
      });
    }
    return [...byComment.values()];
  }

  async resolve(
    commentId: string,
    resolution: 'dismissed' | 'hidden',
    actor: Actor,
  ): Promise<void> {
    await this.platformDb.run('platform console: resolve comment report', async (tx) => {
      const now = this.clock.now();
      const resolved = await tx.execute<{ workspace_id: string }>(sql`
        update comment_reports set resolved_at = ${now}, resolved_by = ${actor.userId},
               resolution = ${resolution}
         where comment_id = ${commentId} and resolved_at is null
        returning workspace_id`);
      const workspaceId = resolved.rows[0]?.workspace_id;
      if (!workspaceId) throw notFound('No open report for this comment');
      if (resolution === 'hidden') {
        await tx.execute(sql`update homework_comments set hidden_at = coalesce(hidden_at, ${now})
                              where id = ${commentId}`);
      }
      await this.audit.record(tx, {
        action: 'platform.comment_report_resolved',
        workspaceId,
        actor: { type: 'platform_owner', userId: actor.userId },
        entity: { type: 'homework_comment', id: commentId },
        newValue: { resolution, reports: resolved.rows.length },
        requestId: actor.requestId,
      });
    });
  }
}
