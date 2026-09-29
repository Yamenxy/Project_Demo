import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { AppError, Clock, IdGenerator, notFound } from '../../common';
import { TenantDb, type DbTx } from '../../database';
import { AuditService } from '../audit';
import { classes, classScope } from '../classes';
import { courses, courseScope } from '../content';
import { GradingService } from '../grading';
import { users } from '../identity';
import { memberships, type WorkspaceContext } from '../tenancy';
import { countedScore } from './exam-rules';
import {
  examAccommodations,
  examAttempts,
  examItems,
  exams,
  examTargets,
  questions,
  questionVersions,
} from './schema';

export interface Actor {
  userId: string;
  requestId?: string;
}

export interface ExamSettings {
  title: string;
  timeLimitMinutes: number;
  opensAt: Date;
  closesAt: Date;
  maxAttempts: number;
  scoreRule: 'highest' | 'latest';
  shuffleQuestions: boolean;
  shuffleChoices: boolean;
  passPercent: number | null;
  classIds: string[];
  questionIds: string[];
}

export interface ExamSummary {
  id: string;
  courseId: string;
  title: string;
  opensAt: Date;
  closesAt: Date;
  timeLimitMinutes: number;
  published: boolean;
  resultsReleased: boolean;
  attempts: number;
}

export interface ResultRow {
  membershipId: string;
  name: string;
  attempts: { number: number; score: number | null; submitted: boolean; reason: string | null }[];
  counted: number | null;
  passed: boolean | null;
}

/** Exams, for staff with `assessment.edit` in the course (REQ-EXAM-001). */
@Injectable()
export class ExamsService {
  constructor(
    private readonly db: TenantDb,
    private readonly grading: GradingService,
    private readonly audit: AuditService,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async list(ctx: WorkspaceContext, courseId: string): Promise<ExamSummary[]> {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      await this.course(tx, ctx, courseId);
      const rows = await tx
        .select({
          exam: exams,
          attempts: sql<number>`(select count(*)::int from exam_attempts a where a.exam_id = ${exams.id})`,
        })
        .from(exams)
        .where(eq(exams.courseId, courseId))
        .orderBy(desc(exams.opensAt));
      return rows.map(({ exam, attempts }) => summary(exam, attempts));
    });
  }

  async create(
    ctx: WorkspaceContext,
    courseId: string,
    input: ExamSettings,
    actor: Actor,
  ): Promise<{ id: string }> {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      await this.course(tx, ctx, courseId);
      const id = this.ids.newId();
      const now = this.clock.now();
      await tx.insert(exams).values({
        workspaceId: ctx.workspaceId,
        id,
        courseId,
        title: input.title.trim(),
        timeLimitMinutes: input.timeLimitMinutes,
        opensAt: input.opensAt,
        closesAt: input.closesAt,
        maxAttempts: input.maxAttempts,
        scoreRule: input.scoreRule,
        shuffleQuestions: input.shuffleQuestions,
        shuffleChoices: input.shuffleChoices,
        passPercent: input.passPercent,
        createdBy: actor.userId,
        createdAt: now,
        updatedAt: now,
      });
      await this.setContent(tx, ctx, id, courseId, input);
      await this.record(tx, ctx, actor, 'exam.created', id, { title: input.title });
      return { id };
    });
  }

  /** Settings and questions change only before anyone has started (REQ-EXAM-003). */
  async update(
    ctx: WorkspaceContext,
    examId: string,
    input: ExamSettings,
    actor: Actor,
  ): Promise<void> {
    await this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      const exam = await this.exam(tx, ctx, examId);
      await this.assertNoAttempts(tx, examId);
      await tx
        .update(exams)
        .set({
          title: input.title.trim(),
          timeLimitMinutes: input.timeLimitMinutes,
          opensAt: input.opensAt,
          closesAt: input.closesAt,
          maxAttempts: input.maxAttempts,
          scoreRule: input.scoreRule,
          shuffleQuestions: input.shuffleQuestions,
          shuffleChoices: input.shuffleChoices,
          passPercent: input.passPercent,
          updatedAt: this.clock.now(),
        })
        .where(eq(exams.id, examId));
      await tx.delete(examItems).where(eq(examItems.examId, examId));
      await tx.delete(examTargets).where(eq(examTargets.examId, examId));
      await this.setContent(tx, ctx, examId, exam.courseId, input);
      await this.record(tx, ctx, actor, 'exam.updated', examId, { title: input.title });
    });
  }

  async setPublished(
    ctx: WorkspaceContext,
    examId: string,
    published: boolean,
    actor: Actor,
  ): Promise<void> {
    await this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      await this.exam(tx, ctx, examId);
      await tx
        .update(exams)
        .set({ publishedAt: published ? this.clock.now() : null, updatedAt: this.clock.now() })
        .where(eq(exams.id, examId));
      await this.record(
        tx,
        ctx,
        actor,
        published ? 'exam.published' : 'exam.unpublished',
        examId,
        {},
      );
    });
  }

  /** Extra minutes for one student (REQ-EXAM-001); null removes it. */
  async setAccommodation(
    ctx: WorkspaceContext,
    examId: string,
    membershipId: string,
    extraMinutes: number | null,
    actor: Actor,
  ): Promise<void> {
    await this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      await this.exam(tx, ctx, examId);
      const [student] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(eq(memberships.id, membershipId), eq(memberships.role, 'student')));
      if (!student) throw notFound('Student not found');
      if (extraMinutes === null) {
        await tx
          .delete(examAccommodations)
          .where(
            and(
              eq(examAccommodations.examId, examId),
              eq(examAccommodations.membershipId, membershipId),
            ),
          );
      } else {
        await tx
          .insert(examAccommodations)
          .values({ workspaceId: ctx.workspaceId, examId, membershipId, extraMinutes })
          .onConflictDoUpdate({
            target: [examAccommodations.examId, examAccommodations.membershipId],
            set: { extraMinutes },
          });
      }
      await this.record(tx, ctx, actor, 'exam.accommodation_set', examId, {
        membershipId,
        extraMinutes,
      });
    });
  }

  /** Staff view: settings, questions with answers, targets and accommodations. */
  async get(ctx: WorkspaceContext, examId: string) {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      const exam = await this.exam(tx, ctx, examId);
      const items = await tx
        .select({ position: examItems.position, version: questionVersions })
        .from(examItems)
        .innerJoin(questionVersions, eq(questionVersions.id, examItems.questionVersionId))
        .where(eq(examItems.examId, examId))
        .orderBy(asc(examItems.position));
      const targets = await tx
        .select({ id: classes.id, name: classes.name })
        .from(examTargets)
        .innerJoin(classes, eq(classes.id, examTargets.classId))
        .where(eq(examTargets.examId, examId));
      const accommodations = await tx
        .select({
          membershipId: examAccommodations.membershipId,
          extraMinutes: examAccommodations.extraMinutes,
        })
        .from(examAccommodations)
        .where(eq(examAccommodations.examId, examId));
      const [count] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(examAttempts)
        .where(eq(examAttempts.examId, examId));
      return {
        ...summary(exam, count?.n ?? 0),
        maxAttempts: exam.maxAttempts,
        scoreRule: exam.scoreRule,
        shuffleQuestions: exam.shuffleQuestions,
        shuffleChoices: exam.shuffleChoices,
        passPercent: exam.passPercent,
        items: items.map((i) => ({
          position: i.position,
          questionId: i.version.questionId,
          versionId: i.version.id,
          version: i.version.version,
          kind: i.version.kind,
          body: i.version.body,
          choices: i.version.choices,
          answer: i.version.answer,
          points: i.version.pointsCenti / 100,
        })),
        targets,
        accommodations,
      };
    });
  }

  async results(
    ctx: WorkspaceContext,
    examId: string,
  ): Promise<{ max: number; rows: ResultRow[] }> {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      const exam = await this.exam(tx, ctx, examId);
      return this.resultRows(tx, exam);
    });
  }

  /**
   * Releases results (`grading.release`): each student's counted score goes into a grade item in
   * the target class they're enrolled in, and the item is released (REQ-GRADE-001).
   */
  async releaseResults(ctx: WorkspaceContext, examId: string, actor: Actor): Promise<void> {
    await this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      const exam = await this.exam(tx, ctx, examId);
      const targets = await tx
        .select({ classId: examTargets.classId })
        .from(examTargets)
        .where(eq(examTargets.examId, examId));
      for (const t of targets) {
        if (!ctx.permissions.coversClass('grading.release', t.classId)) {
          throw new AppError(403, 'forbidden', 'Not allowed');
        }
      }
      const { max, rows } = await this.resultRows(tx, exam);
      for (const t of targets) {
        const enrolled = await tx.execute<{ membership_id: string }>(sql`
          select membership_id from class_enrollments
           where class_id = ${t.classId} and ended_at is null`);
        const inClass = new Set(enrolled.rows.map((r) => r.membership_id));
        const scores = rows
          .filter((r) => inClass.has(r.membershipId) && r.counted !== null)
          .map((r) => ({ membershipId: r.membershipId, score: r.counted }));
        const existing = await tx.execute<{ id: string }>(sql`
          select id from grade_items where class_id = ${t.classId} and kind = 'exam'
             and source_id = ${examId} and archived_at is null`);
        const itemId =
          existing.rows[0]?.id ??
          (
            await this.grading.createItem(
              ctx,
              t.classId,
              { title: exam.title, maxScore: max, kind: 'exam', sourceId: examId },
              actor,
              tx,
            )
          ).id;
        if (scores.length > 0) {
          await this.grading.setScores(ctx, itemId, { scores, reason: 'exam results' }, actor, tx);
        }
        await tx.execute(sql`update grade_items set released_at = coalesce(released_at, ${this.clock.now()}),
          updated_at = ${this.clock.now()} where id = ${itemId}`);
      }
      await tx
        .update(exams)
        .set({ resultsReleasedAt: this.clock.now(), updatedAt: this.clock.now() })
        .where(eq(exams.id, examId));
      await this.record(tx, ctx, actor, 'exam.results_released', examId, {});
    });
  }

  async resultRows(
    tx: DbTx,
    exam: typeof exams.$inferSelect,
  ): Promise<{ max: number; rows: ResultRow[] }> {
    const attempts = await tx
      .select({
        membershipId: examAttempts.membershipId,
        name: sql<string>`coalesce(${users.nameAr}, ${memberships.provisionalName})`,
        number: examAttempts.number,
        scoreCenti: examAttempts.scoreCenti,
        submittedAt: examAttempts.submittedAt,
        reason: examAttempts.submitReason,
        maxCenti: examAttempts.maxCenti,
      })
      .from(examAttempts)
      .innerJoin(memberships, eq(memberships.id, examAttempts.membershipId))
      .leftJoin(users, eq(users.id, memberships.userId))
      .where(eq(examAttempts.examId, exam.id))
      .orderBy(asc(examAttempts.number));
    const [items] = await tx
      .select({ max: sql<number>`coalesce(sum(${questionVersions.pointsCenti}), 0)::int` })
      .from(examItems)
      .innerJoin(questionVersions, eq(questionVersions.id, examItems.questionVersionId))
      .where(eq(examItems.examId, exam.id));
    const maxCenti = items?.max ?? 0;
    const byStudent = new Map<string, ResultRow>();
    for (const a of attempts) {
      const row = byStudent.get(a.membershipId) ?? {
        membershipId: a.membershipId,
        name: a.name,
        attempts: [],
        counted: null,
        passed: null,
      };
      row.attempts.push({
        number: a.number,
        score: a.scoreCenti === null ? null : a.scoreCenti / 100,
        submitted: a.submittedAt !== null,
        reason: a.reason,
      });
      byStudent.set(a.membershipId, row);
    }
    const rows = [...byStudent.values()].map((row) => {
      const counted = countedScore(
        row.attempts.map((a) => ({
          number: a.number,
          scoreCenti: a.score === null ? null : Math.round(a.score * 100),
          submitted: a.submitted,
        })),
        exam.scoreRule,
      );
      return {
        ...row,
        counted: counted === null ? null : counted / 100,
        passed:
          counted === null || exam.passPercent === null || maxCenti === 0
            ? null
            : (counted / maxCenti) * 100 >= exam.passPercent,
      };
    });
    return { max: maxCenti / 100, rows };
  }

  private async setContent(
    tx: DbTx,
    ctx: WorkspaceContext,
    examId: string,
    courseId: string,
    input: ExamSettings,
  ): Promise<void> {
    if (input.closesAt <= input.opensAt)
      throw new AppError(400, 'invalid_window', 'The exam closes before it opens');
    const classIds = [...new Set(input.classIds)];
    const visible = await tx
      .select({ id: classes.id })
      .from(classes)
      .where(and(inArray(classes.id, classIds), classScope(ctx), isNull(classes.archivedAt)));
    if (visible.length !== classIds.length) throw notFound('Class not found');
    await tx
      .insert(examTargets)
      .values(classIds.map((classId) => ({ workspaceId: ctx.workspaceId, examId, classId })));
    const questionIds = input.questionIds;
    const current = await tx
      .select({ id: questions.id, versionId: questionVersions.id })
      .from(questions)
      .innerJoin(
        questionVersions,
        and(
          eq(questionVersions.questionId, questions.id),
          eq(questionVersions.version, questions.currentVersion),
        ),
      )
      .where(
        and(
          inArray(questions.id, questionIds),
          eq(questions.courseId, courseId),
          isNull(questions.archivedAt),
        ),
      );
    if (current.length !== new Set(questionIds).size) throw notFound('Question not found');
    const versionOf = new Map(current.map((c) => [c.id, c.versionId]));
    await tx.insert(examItems).values(
      questionIds.map((qid, position) => ({
        workspaceId: ctx.workspaceId,
        examId,
        position,
        questionVersionId: versionOf.get(qid) ?? '',
      })),
    );
  }

  private async assertNoAttempts(tx: DbTx, examId: string): Promise<void> {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(examAttempts)
      .where(eq(examAttempts.examId, examId));
    if ((row?.n ?? 0) > 0) {
      throw new AppError(
        409,
        'exam_has_attempts',
        'Only answer keys can change once students started',
      );
    }
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

  async exam(tx: DbTx, ctx: WorkspaceContext, examId: string) {
    const [exam] = await tx.select().from(exams).where(eq(exams.id, examId)).for('update');
    if (!exam) throw notFound('Exam not found');
    await this.course(tx, ctx, exam.courseId);
    return exam;
  }

  private record(
    tx: DbTx,
    ctx: WorkspaceContext,
    actor: Actor,
    action: string,
    examId: string,
    newValue: Record<string, unknown>,
  ) {
    return this.audit.record(tx, {
      action,
      workspaceId: ctx.workspaceId,
      actor: { type: 'user', userId: actor.userId },
      entity: { type: 'exam', id: examId },
      newValue,
      requestId: actor.requestId,
    });
  }
}

function summary(exam: typeof exams.$inferSelect, attempts: number): ExamSummary {
  return {
    id: exam.id,
    courseId: exam.courseId,
    title: exam.title,
    opensAt: exam.opensAt,
    closesAt: exam.closesAt,
    timeLimitMinutes: exam.timeLimitMinutes,
    published: exam.publishedAt !== null,
    resultsReleased: exam.resultsReleasedAt !== null,
    attempts,
  };
}
