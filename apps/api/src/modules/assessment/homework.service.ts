import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { AppError, Clock, IdGenerator, notFound } from '../../common';
import { TenantDb, type DbTx } from '../../database';
import { AuditService } from '../audit';
import { classes, classScope } from '../classes';
import { courses, courseScope } from '../content';
import { GradingService } from '../grading';
import { users } from '../identity';
import { memberships, studentScope, type WorkspaceContext } from '../tenancy';
import { homework, homeworkSubmissions, homeworkTargets } from './schema';

export interface Actor {
  userId: string;
  requestId?: string;
}

export interface HomeworkInput {
  title: string;
  instructions?: string;
  dueAt: Date;
  latePolicy: 'reject' | 'accept_flagged';
  allowResubmission: boolean;
  maxScore: number;
  classIds: string[];
}

export interface SubmissionView {
  id: string;
  membershipId: string;
  name: string;
  number: number;
  text: string | null;
  submittedAt: Date;
  late: boolean;
  score: number | null;
  feedback: string | null;
}

/** Homework (REQ-HW-001, REQ-HW-002). */
@Injectable()
export class HomeworkService {
  constructor(
    private readonly db: TenantDb,
    private readonly grading: GradingService,
    private readonly audit: AuditService,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  // --- staff -------------------------------------------------------------------------------------

  async list(ctx: WorkspaceContext, courseId: string) {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      await this.course(tx, ctx, courseId);
      return tx
        .select({
          id: homework.id,
          title: homework.title,
          dueAt: homework.dueAt,
          published: sql<boolean>`${homework.publishedAt} is not null`,
          released: sql<boolean>`${homework.resultsReleasedAt} is not null`,
          submissions: sql<number>`(select count(distinct s.membership_id)::int from homework_submissions s
            where s.homework_id = ${homework.id})`,
        })
        .from(homework)
        .where(eq(homework.courseId, courseId))
        .orderBy(desc(homework.dueAt));
    });
  }

  async create(
    ctx: WorkspaceContext,
    courseId: string,
    input: HomeworkInput,
    actor: Actor,
  ): Promise<{ id: string }> {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      await this.course(tx, ctx, courseId);
      const id = this.ids.newId();
      const now = this.clock.now();
      await tx.insert(homework).values({
        workspaceId: ctx.workspaceId,
        id,
        courseId,
        title: input.title.trim(),
        instructions: input.instructions?.trim() || null,
        dueAt: input.dueAt,
        latePolicy: input.latePolicy,
        allowResubmission: input.allowResubmission,
        maxScoreCenti: Math.round(input.maxScore * 100),
        createdBy: actor.userId,
        createdAt: now,
        updatedAt: now,
      });
      const classIds = [...new Set(input.classIds)];
      const visible = await tx
        .select({ id: classes.id })
        .from(classes)
        .where(and(inArray(classes.id, classIds), classScope(ctx), isNull(classes.archivedAt)));
      if (visible.length !== classIds.length) throw notFound('Class not found');
      await tx
        .insert(homeworkTargets)
        .values(
          classIds.map((classId) => ({ workspaceId: ctx.workspaceId, homeworkId: id, classId })),
        );
      await this.record(tx, ctx, actor, 'homework.created', id, { title: input.title });
      return { id };
    });
  }

  async setPublished(
    ctx: WorkspaceContext,
    homeworkId: string,
    published: boolean,
    actor: Actor,
  ): Promise<void> {
    await this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      await this.staffHomework(tx, ctx, homeworkId);
      await tx
        .update(homework)
        .set({ publishedAt: published ? this.clock.now() : null, updatedAt: this.clock.now() })
        .where(eq(homework.id, homeworkId));
      await this.record(
        tx,
        ctx,
        actor,
        published ? 'homework.published' : 'homework.unpublished',
        homeworkId,
        {},
      );
    });
  }

  /** Every submission of the students the caller grades (`grading.grade` in scope). */
  async submissions(ctx: WorkspaceContext, homeworkId: string): Promise<SubmissionView[]> {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      await this.staffHomework(tx, ctx, homeworkId);
      const rows = await tx
        .select({
          s: homeworkSubmissions,
          name: sql<string>`coalesce(${users.nameAr}, ${memberships.provisionalName})`,
        })
        .from(homeworkSubmissions)
        .innerJoin(memberships, eq(memberships.id, homeworkSubmissions.membershipId))
        .leftJoin(users, eq(users.id, memberships.userId))
        .where(
          and(eq(homeworkSubmissions.homeworkId, homeworkId), studentScope(ctx, 'grading.grade')),
        )
        .orderBy(asc(sql`2`), asc(homeworkSubmissions.number));
      return rows.map(({ s, name }) => view(s, name));
    });
  }

  async grade(
    ctx: WorkspaceContext,
    submissionId: string,
    input: { score: number; feedback?: string },
    actor: Actor,
  ): Promise<void> {
    await this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      const [row] = await tx
        .select({ s: homeworkSubmissions, max: homework.maxScoreCenti })
        .from(homeworkSubmissions)
        .innerJoin(homework, eq(homework.id, homeworkSubmissions.homeworkId))
        .innerJoin(memberships, eq(memberships.id, homeworkSubmissions.membershipId))
        .where(and(eq(homeworkSubmissions.id, submissionId), studentScope(ctx, 'grading.grade')))
        .for('update', { of: homeworkSubmissions });
      if (!row) throw notFound('Submission not found');
      const score = Math.round(input.score * 100);
      if (score < 0 || score > row.max) {
        throw new AppError(400, 'score_out_of_range', 'The score is outside 0 to the maximum');
      }
      await tx
        .update(homeworkSubmissions)
        .set({
          scoreCenti: score,
          feedback: input.feedback?.trim() || null,
          gradedBy: actor.userId,
          gradedAt: this.clock.now(),
        })
        .where(eq(homeworkSubmissions.id, submissionId));
      await this.record(tx, ctx, actor, 'homework.graded', row.s.homeworkId, {
        submissionId,
        score: input.score,
      });
    });
  }

  /** Releases results: each student's latest graded submission goes to the class gradebook. */
  async release(ctx: WorkspaceContext, homeworkId: string, actor: Actor): Promise<void> {
    await this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      const hw = await this.staffHomework(tx, ctx, homeworkId);
      const targets = await tx
        .select({ classId: homeworkTargets.classId })
        .from(homeworkTargets)
        .where(eq(homeworkTargets.homeworkId, homeworkId));
      for (const t of targets) {
        if (!ctx.permissions.coversClass('grading.release', t.classId)) {
          throw new AppError(403, 'forbidden', 'Not allowed');
        }
      }
      const latest = await tx.execute<{ membership_id: string; score_centi: number }>(sql`
        select distinct on (membership_id) membership_id, score_centi
          from homework_submissions
         where homework_id = ${homeworkId} and score_centi is not null
         order by membership_id, number desc`);
      for (const t of targets) {
        const enrolled = await tx.execute<{ membership_id: string }>(sql`
          select membership_id from class_enrollments where class_id = ${t.classId} and ended_at is null`);
        const inClass = new Set(enrolled.rows.map((r) => r.membership_id));
        const scores = latest.rows
          .filter((r) => inClass.has(r.membership_id))
          .map((r) => ({ membershipId: r.membership_id, score: r.score_centi / 100 }));
        const existing = await tx.execute<{ id: string }>(sql`
          select id from grade_items where class_id = ${t.classId} and kind = 'homework'
             and source_id = ${homeworkId} and archived_at is null`);
        const itemId =
          existing.rows[0]?.id ??
          (
            await this.grading.createItem(
              ctx,
              t.classId,
              {
                title: hw.title,
                maxScore: hw.maxScoreCenti / 100,
                kind: 'homework',
                sourceId: homeworkId,
              },
              actor,
              tx,
            )
          ).id;
        if (scores.length > 0) {
          await this.grading.setScores(
            ctx,
            itemId,
            { scores, reason: 'homework results' },
            actor,
            tx,
          );
        }
        await this.grading.releaseItem(tx, ctx, itemId, actor);
      }
      await tx
        .update(homework)
        .set({ resultsReleasedAt: this.clock.now(), updatedAt: this.clock.now() })
        .where(eq(homework.id, homeworkId));
      await this.record(tx, ctx, actor, 'homework.results_released', homeworkId, {});
    });
  }

  // --- students ----------------------------------------------------------------------------------

  /** Published homework for the student's classes, with their submissions. */
  async mine(ctx: WorkspaceContext) {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      const rows = await tx
        .select()
        .from(homework)
        .where(
          and(
            sql`${homework.publishedAt} is not null`,
            sql`exists (select 1 from homework_targets t join class_enrollments e on e.class_id = t.class_id
                 where t.homework_id = ${homework.id} and e.membership_id = ${ctx.membershipId}
                   and e.ended_at is null)`,
          ),
        )
        .orderBy(asc(homework.dueAt));
      const out = [];
      for (const hw of rows) {
        const subs = await tx
          .select()
          .from(homeworkSubmissions)
          .where(
            and(
              eq(homeworkSubmissions.homeworkId, hw.id),
              eq(homeworkSubmissions.membershipId, ctx.membershipId),
            ),
          )
          .orderBy(asc(homeworkSubmissions.number));
        const released = hw.resultsReleasedAt !== null;
        out.push({
          id: hw.id,
          title: hw.title,
          instructions: hw.instructions,
          dueAt: hw.dueAt,
          latePolicy: hw.latePolicy,
          maxScore: hw.maxScoreCenti / 100,
          canSubmit: this.canSubmit(hw, subs.length, ctx.paused),
          submissions: subs.map((s) => ({
            id: s.id,
            number: s.number,
            text: s.text,
            submittedAt: s.submittedAt,
            late: s.late,
            // Scores and feedback only once released.
            score: released && s.scoreCenti !== null ? s.scoreCenti / 100 : null,
            feedback: released ? s.feedback : null,
          })),
        });
      }
      return out;
    });
  }

  /**
   * Only students actively enrolled in a target class and not paused (REQ-HW-002); access groups
   * don't matter. Late submissions follow the policy; one resubmission if allowed (REQ-HW-001).
   */
  async submit(
    ctx: WorkspaceContext,
    homeworkId: string,
    text: string | undefined,
    actor: Actor,
  ): Promise<{ id: string; late: boolean }> {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      const [hw] = await tx
        .select()
        .from(homework)
        .where(eq(homework.id, homeworkId))
        .for('update');
      if (!hw || !hw.publishedAt) throw notFound('Homework not found');
      const eligible = await tx.execute<{ ok: boolean }>(sql`
        select exists (select 1 from homework_targets t join class_enrollments e on e.class_id = t.class_id
                        where t.homework_id = ${homeworkId} and e.membership_id = ${ctx.membershipId}
                          and e.ended_at is null) as ok`);
      if (!eligible.rows[0]?.ok) throw notFound('Homework not found');
      if (ctx.paused)
        throw new AppError(403, 'homework_unavailable', 'This homework is not available');
      const previous = await tx
        .select({ id: homeworkSubmissions.id })
        .from(homeworkSubmissions)
        .where(
          and(
            eq(homeworkSubmissions.homeworkId, homeworkId),
            eq(homeworkSubmissions.membershipId, ctx.membershipId),
          ),
        );
      if (previous.length >= (hw.allowResubmission ? 2 : 1)) {
        throw new AppError(409, 'no_resubmission', 'No more submissions allowed');
      }
      const now = this.clock.now();
      const late = now > hw.dueAt;
      if (late && hw.latePolicy === 'reject')
        throw new AppError(409, 'homework_closed', 'The due date has passed');
      const id = this.ids.newId();
      await tx.insert(homeworkSubmissions).values({
        workspaceId: ctx.workspaceId,
        id,
        homeworkId,
        membershipId: ctx.membershipId,
        number: previous.length + 1,
        text: text?.trim() || null,
        submittedAt: now,
        late,
      });
      await this.audit.record(tx, {
        action: 'homework.submitted',
        workspaceId: ctx.workspaceId,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'homework_submission', id },
        newValue: { homeworkId, number: previous.length + 1, late },
        requestId: actor.requestId,
      });
      return { id, late };
    });
  }

  private canSubmit(hw: typeof homework.$inferSelect, count: number, paused: boolean): boolean {
    if (paused || count >= (hw.allowResubmission ? 2 : 1)) return false;
    return !(this.clock.now() > hw.dueAt && hw.latePolicy === 'reject');
  }

  private async course(tx: DbTx, ctx: WorkspaceContext, courseId: string): Promise<void> {
    const [row] = await tx
      .select({ id: courses.id })
      .from(courses)
      .where(
        and(
          eq(courses.id, courseId),
          isNull(courses.deletedAt),
          courseScope(ctx, 'assessment.edit'),
        ),
      );
    if (!row) throw notFound('Course not found');
  }

  /** Staff act on homework in courses they can edit, or whose classes they grade. */
  private async staffHomework(tx: DbTx, ctx: WorkspaceContext, homeworkId: string) {
    const [hw] = await tx.select().from(homework).where(eq(homework.id, homeworkId)).for('update');
    if (!hw) throw notFound('Homework not found');
    const targets = await tx
      .select({ classId: homeworkTargets.classId })
      .from(homeworkTargets)
      .where(eq(homeworkTargets.homeworkId, homeworkId));
    const grades = targets.some((t) => ctx.permissions.coversClass('grading.grade', t.classId));
    if (!grades) await this.course(tx, ctx, hw.courseId);
    return hw;
  }

  private record(
    tx: DbTx,
    ctx: WorkspaceContext,
    actor: Actor,
    action: string,
    id: string,
    newValue: Record<string, unknown>,
  ) {
    return this.audit.record(tx, {
      action,
      workspaceId: ctx.workspaceId,
      actor: { type: 'user', userId: actor.userId },
      entity: { type: 'homework', id },
      newValue,
      requestId: actor.requestId,
    });
  }
}

function view(s: typeof homeworkSubmissions.$inferSelect, name: string): SubmissionView {
  return {
    id: s.id,
    membershipId: s.membershipId,
    name,
    number: s.number,
    text: s.text,
    submittedAt: s.submittedAt,
    late: s.late,
    score: s.scoreCenti === null ? null : s.scoreCenti / 100,
    feedback: s.feedback,
  };
}
