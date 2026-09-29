import { Injectable } from '@nestjs/common';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { AppError, Clock, IdGenerator, notFound } from '../../common';
import { TenantDb, type DbTx } from '../../database';
import { AuditService } from '../audit';
import { GradingService } from '../grading';
import type { WorkspaceContext } from '../tenancy';
import { AttemptsService } from './attempts.service';
import { countedScore, isCorrect } from './exam-rules';
import { ExamsService, type Actor } from './exams.service';
import {
  examAnswers,
  examAttempts,
  examItems,
  exams,
  questionVersions,
  type Answer,
} from './schema';

export type KeyInput =
  | { correctChoiceId: string }
  | { value: boolean }
  | { accepted: string[]; arabicVariants: boolean };

export interface RegradePreview {
  attemptsChanged: number;
  studentsChanged: number;
  passFailChanged: number;
  changes: { membershipId: string; before: number | null; after: number | null }[];
}

/**
 * Answer-key corrections once attempts exist (REQ-EXAM-003): the only change allowed then. The
 * teacher previews how many scores and pass/fail outcomes change, then confirms; the question
 * gets a new version, every submitted attempt is regraded, and released grades are updated.
 */
@Injectable()
export class RegradeService {
  constructor(
    private readonly db: TenantDb,
    private readonly examsService: ExamsService,
    private readonly attempts: AttemptsService,
    private readonly grading: GradingService,
    private readonly audit: AuditService,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async preview(
    ctx: WorkspaceContext,
    examId: string,
    position: number,
    key: KeyInput,
  ): Promise<RegradePreview> {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      const { exam, version } = await this.target(tx, ctx, examId, position);
      return this.compute(tx, exam, position, version.kind, this.answerFor(version, key));
    });
  }

  async apply(
    ctx: WorkspaceContext,
    examId: string,
    position: number,
    key: KeyInput,
    actor: Actor,
  ): Promise<RegradePreview> {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      const { exam, version } = await this.target(tx, ctx, examId, position);
      const answer = this.answerFor(version, key);
      const outcome = await this.compute(tx, exam, position, version.kind, answer);
      const [latest] = await tx
        .select({ max: sql<number>`max(${questionVersions.version})::int` })
        .from(questionVersions)
        .where(eq(questionVersions.questionId, version.questionId));
      const newVersionId = this.ids.newId();
      const nextVersion = (latest?.max ?? version.version) + 1;
      await tx.insert(questionVersions).values({
        workspaceId: ctx.workspaceId,
        id: newVersionId,
        questionId: version.questionId,
        version: nextVersion,
        kind: version.kind,
        body: version.body,
        choices: version.choices,
        answer,
        feedback: version.feedback,
        pointsCenti: version.pointsCenti,
        createdBy: actor.userId,
        createdAt: this.clock.now(),
      });
      await tx.execute(
        sql`update questions set current_version = ${nextVersion}, updated_at = ${this.clock.now()}
             where id = ${version.questionId}`,
      );
      await tx
        .update(examItems)
        .set({ questionVersionId: newVersionId })
        .where(and(eq(examItems.examId, examId), eq(examItems.position, position)));
      const submitted = await tx
        .select()
        .from(examAttempts)
        .where(and(eq(examAttempts.examId, examId), isNotNull(examAttempts.submittedAt)))
        .for('update');
      for (const attempt of submitted) {
        const score = await this.attempts.grade(tx, attempt);
        await tx
          .update(examAttempts)
          .set({ scoreCenti: score })
          .where(eq(examAttempts.id, attempt.id));
      }
      if (exam.resultsReleasedAt) await this.updateGradebook(tx, ctx, exam, actor);
      await this.audit.record(tx, {
        action: 'exam.key_corrected',
        workspaceId: ctx.workspaceId,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'exam', id: examId },
        newValue: { position, questionVersionId: newVersionId, ...outcome, changes: undefined },
        requestId: actor.requestId,
      });
      return outcome;
    });
  }

  private async compute(
    tx: DbTx,
    exam: typeof exams.$inferSelect,
    position: number,
    kind: 'mcq' | 'true_false' | 'short',
    newAnswer: Answer,
  ): Promise<RegradePreview> {
    const attempts = await tx
      .select()
      .from(examAttempts)
      .where(and(eq(examAttempts.examId, exam.id), isNotNull(examAttempts.submittedAt)));
    const answers = await tx
      .select({
        attemptId: examAnswers.attemptId,
        response: examAnswers.response,
        correct: examAnswers.correct,
      })
      .from(examAnswers)
      .innerJoin(examAttempts, eq(examAttempts.id, examAnswers.attemptId))
      .where(and(eq(examAttempts.examId, exam.id), eq(examAnswers.position, position)));
    const [item] = await tx
      .select({ points: questionVersions.pointsCenti })
      .from(examItems)
      .innerJoin(questionVersions, eq(questionVersions.id, examItems.questionVersionId))
      .where(and(eq(examItems.examId, exam.id), eq(examItems.position, position)));
    const points = item?.points ?? 0;
    const newScore = new Map<string, number | null>();
    let attemptsChanged = 0;
    for (const a of attempts) {
      const answer = answers.find((x) => x.attemptId === a.id);
      const was = answer?.correct === true;
      const now = answer ? isCorrect(kind, newAnswer, answer.response) : false;
      const delta = (now ? points : 0) - (was ? points : 0);
      if (delta !== 0) attemptsChanged++;
      newScore.set(a.id, a.scoreCenti === null ? null : a.scoreCenti + delta);
    }
    const students = [...new Set(attempts.map((a) => a.membershipId))];
    const max = attempts[0]?.maxCenti ?? 0;
    const pass = (score: number | null) =>
      score === null || exam.passPercent === null || max === 0
        ? null
        : (score / max) * 100 >= exam.passPercent;
    const changes: RegradePreview['changes'] = [];
    let passFailChanged = 0;
    for (const membershipId of students) {
      const mine = attempts.filter((a) => a.membershipId === membershipId);
      const before = countedScore(
        mine.map((a) => ({ number: a.number, scoreCenti: a.scoreCenti, submitted: true })),
        exam.scoreRule,
      );
      const after = countedScore(
        mine.map((a) => ({
          number: a.number,
          scoreCenti: newScore.get(a.id) ?? null,
          submitted: true,
        })),
        exam.scoreRule,
      );
      if (before !== after) {
        changes.push({
          membershipId,
          before: before === null ? null : before / 100,
          after: after === null ? null : after / 100,
        });
      }
      if (pass(before) !== pass(after)) passFailChanged++;
    }
    return { attemptsChanged, studentsChanged: changes.length, passFailChanged, changes };
  }

  /** Released grade items follow the corrected scores, with the reason recorded. */
  private async updateGradebook(
    tx: DbTx,
    ctx: WorkspaceContext,
    exam: typeof exams.$inferSelect,
    actor: Actor,
  ): Promise<void> {
    const { rows } = await this.examsService.resultRows(tx, exam);
    const items = await tx.execute<{ id: string; class_id: string }>(sql`
      select id, class_id from grade_items where kind = 'exam' and source_id = ${exam.id}
         and archived_at is null`);
    for (const item of items.rows) {
      const entries = await tx.execute<{ membership_id: string }>(
        sql`select membership_id from grade_entries where item_id = ${item.id}`,
      );
      const inItem = new Set(entries.rows.map((e) => e.membership_id));
      const scores = rows
        .filter((r) => inItem.has(r.membershipId))
        .map((r) => ({ membershipId: r.membershipId, score: r.counted }));
      if (scores.length > 0) {
        await this.grading.setScores(
          ctx,
          item.id,
          { scores, reason: 'answer key corrected' },
          actor,
          tx,
        );
      }
    }
  }

  private answerFor(version: typeof questionVersions.$inferSelect, key: KeyInput): Answer {
    if (version.kind === 'mcq' && 'correctChoiceId' in key) {
      if (!version.choices.some((c) => c.id === key.correctChoiceId)) {
        throw new AppError(400, 'invalid_correct_choice', 'Pick one of the choices');
      }
      return { correct: key.correctChoiceId };
    }
    if (version.kind === 'true_false' && 'value' in key) return { value: key.value };
    if (version.kind === 'short' && 'accepted' in key) {
      return { accepted: key.accepted, arabicVariants: key.arabicVariants };
    }
    throw new AppError(400, 'invalid_key', 'The key does not fit the question');
  }

  private async target(tx: DbTx, ctx: WorkspaceContext, examId: string, position: number) {
    const exam = await this.examsService.exam(tx, ctx, examId);
    const [row] = await tx
      .select({ version: questionVersions })
      .from(examItems)
      .innerJoin(questionVersions, eq(questionVersions.id, examItems.questionVersionId))
      .where(and(eq(examItems.examId, examId), eq(examItems.position, position)));
    if (!row) throw notFound('Question not found');
    return { exam, version: row.version };
  }
}
