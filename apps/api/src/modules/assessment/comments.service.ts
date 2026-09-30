import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, lt, sql } from 'drizzle-orm';
import { AppError, Clock, IdGenerator, notFound } from '../../common';
import { TenantDb, type DbTx } from '../../database';
import { AuditService } from '../audit';
import { users } from '../identity';
import { NotificationsService } from '../notify';
import { memberships, studentScope, workspaces, type WorkspaceContext } from '../tenancy';
import type { Actor } from './homework.service';
import { commentReports, homework, homeworkComments, homeworkSubmissions } from './schema';

export interface CommentView {
  id: string;
  authorName: string;
  side: 'student' | 'staff';
  mine: boolean;
  /** Null once the platform owners hid it after a report. */
  body: string | null;
  createdAt: Date;
}

export interface ReviewRow extends CommentView {
  submissionId: string;
  homeworkTitle: string;
  studentName: string;
  reports: number;
}

const REVIEW_PAGE = 50;

/**
 * Homework comments (REQ-MSG-001): the only channel between staff and students. The student
 * talks on their own submissions; staff on the submissions of students they grade. The owner
 * reviews every thread, and anyone in a thread can report a comment to the platform owners.
 */
@Injectable()
export class CommentsService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async list(ctx: WorkspaceContext, submissionId: string): Promise<CommentView[]> {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      await this.submission(tx, ctx, submissionId);
      const rows = await tx
        .select({ c: homeworkComments, name: users.nameAr })
        .from(homeworkComments)
        .innerJoin(users, eq(users.id, homeworkComments.authorUserId))
        .where(eq(homeworkComments.submissionId, submissionId))
        .orderBy(asc(homeworkComments.createdAt), asc(homeworkComments.id));
      return rows.map(({ c, name }) => view(c, name, ctx.userId));
    });
  }

  async post(
    ctx: WorkspaceContext,
    submissionId: string,
    body: string,
    actor: Actor,
  ): Promise<CommentView> {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      const sub = await this.submission(tx, ctx, submissionId);
      const text = body.trim();
      if (text.length === 0) throw new AppError(400, 'empty_comment', 'Write a comment');
      const side = ctx.role === 'student' ? 'student' : 'staff';
      const id = this.ids.newId();
      const now = this.clock.now();
      await tx.insert(homeworkComments).values({
        workspaceId: ctx.workspaceId,
        id,
        submissionId,
        authorUserId: actor.userId,
        authorSide: side,
        body: text,
        createdAt: now,
      });
      await this.audit.record(tx, {
        action: 'homework.comment_posted',
        workspaceId: ctx.workspaceId,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'homework_comment', id },
        newValue: { submissionId, side },
        requestId: actor.requestId,
      });
      // The other side hears about it: the student, or whoever graded (else the owner).
      const recipient =
        side === 'staff' ? sub.studentUserId : (sub.gradedBy ?? (await this.owner(tx, ctx)));
      if (recipient && recipient !== actor.userId) {
        await this.notifications.notify(tx, {
          recipientUserId: recipient,
          workspaceId: ctx.workspaceId,
          type: 'homework.comment',
          params: { title: sub.title },
          link:
            side === 'staff'
              ? `/w/${ctx.workspaceId}/homework`
              : `/w/${ctx.workspaceId}/courses/${sub.courseId}/homework`,
        });
      }
      const [name] = await tx
        .select({ name: users.nameAr })
        .from(users)
        .where(eq(users.id, actor.userId));
      return {
        id,
        authorName: name?.name ?? '',
        side,
        mine: true,
        body: text,
        createdAt: now,
      };
    });
  }

  /** Reports a comment the caller can read. Reporting twice is harmless. */
  async report(
    ctx: WorkspaceContext,
    commentId: string,
    reason: string,
    actor: Actor,
  ): Promise<void> {
    await this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      const [comment] = await tx
        .select()
        .from(homeworkComments)
        .where(eq(homeworkComments.id, commentId));
      if (!comment) throw notFound('Comment not found');
      await this.submission(tx, ctx, comment.submissionId);
      if (comment.authorUserId === actor.userId) {
        throw new AppError(400, 'own_comment', 'You cannot report your own comment');
      }
      const inserted = await tx
        .insert(commentReports)
        .values({
          workspaceId: ctx.workspaceId,
          id: this.ids.newId(),
          commentId,
          reportedBy: actor.userId,
          reason: reason.trim(),
          createdAt: this.clock.now(),
        })
        .onConflictDoNothing()
        .returning({ id: commentReports.id });
      if (inserted.length === 0) return;
      await this.audit.record(tx, {
        action: 'homework.comment_reported',
        workspaceId: ctx.workspaceId,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'homework_comment', id: commentId },
        reason: reason.trim(),
        requestId: actor.requestId,
      });
    });
  }

  /** The owner's review of every thread in the workspace, newest first (REQ-MSG-001). */
  async review(ctx: WorkspaceContext, before?: Date): Promise<ReviewRow[]> {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      const author = sql<string>`(select name_ar from users u where u.id = ${homeworkComments.authorUserId})`;
      const rows = await tx
        .select({
          c: homeworkComments,
          author,
          homeworkTitle: homework.title,
          studentName: sql<string>`coalesce(${users.nameAr}, ${memberships.provisionalName})`,
          reports: sql<number>`(select count(*)::int from comment_reports r where r.comment_id = ${homeworkComments.id})`,
        })
        .from(homeworkComments)
        .innerJoin(homeworkSubmissions, eq(homeworkSubmissions.id, homeworkComments.submissionId))
        .innerJoin(homework, eq(homework.id, homeworkSubmissions.homeworkId))
        .innerJoin(memberships, eq(memberships.id, homeworkSubmissions.membershipId))
        .leftJoin(users, eq(users.id, memberships.userId))
        .where(before ? lt(homeworkComments.createdAt, before) : undefined)
        .orderBy(desc(homeworkComments.createdAt), desc(homeworkComments.id))
        .limit(REVIEW_PAGE);
      return rows.map((r) => ({
        ...view(r.c, r.author, ctx.userId),
        submissionId: r.c.submissionId,
        homeworkTitle: r.homeworkTitle,
        studentName: r.studentName,
        reports: r.reports,
      }));
    });
  }

  /** The student's own submission, or one of a student the caller grades; 404 otherwise. */
  private async submission(tx: DbTx, ctx: WorkspaceContext, submissionId: string) {
    const [row] = await tx
      .select({
        membershipId: homeworkSubmissions.membershipId,
        gradedBy: homeworkSubmissions.gradedBy,
        studentUserId: memberships.userId,
        title: homework.title,
        courseId: homework.courseId,
      })
      .from(homeworkSubmissions)
      .innerJoin(homework, eq(homework.id, homeworkSubmissions.homeworkId))
      .innerJoin(memberships, eq(memberships.id, homeworkSubmissions.membershipId))
      .where(
        and(
          eq(homeworkSubmissions.id, submissionId),
          ctx.role === 'student'
            ? eq(homeworkSubmissions.membershipId, ctx.membershipId)
            : studentScope(ctx, 'grading.grade'),
        ),
      );
    if (!row) throw notFound('Submission not found');
    return row;
  }

  private async owner(tx: DbTx, ctx: WorkspaceContext): Promise<string | null> {
    const [row] = await tx
      .select({ id: workspaces.ownerUserId })
      .from(workspaces)
      .where(eq(workspaces.id, ctx.workspaceId));
    return row?.id ?? null;
  }
}

function view(
  c: typeof homeworkComments.$inferSelect,
  authorName: string,
  viewerId: string,
): CommentView {
  return {
    id: c.id,
    authorName,
    side: c.authorSide,
    mine: c.authorUserId === viewerId,
    body: c.hiddenAt ? null : c.body,
    createdAt: c.createdAt,
  };
}
