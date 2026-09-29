import { Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { AppError, Clock, IdGenerator, notFound } from '../../common';
import { isUniqueViolation, TenantDb, type DbTx } from '../../database';
import { AuditService } from '../audit';
import type { WorkspaceContext } from '../tenancy';
import {
  acceptsAnswers,
  attemptDeadline,
  countedScore,
  GRACE_MS,
  isCorrect,
  shuffled,
} from './exam-rules';
import {
  examAccommodations,
  examAnswers,
  examAttempts,
  examItems,
  exams,
  questionVersions,
  type AttemptLayoutEntry,
  type ExamResponse,
} from './schema';

export interface StudentExam {
  id: string;
  title: string;
  opensAt: Date;
  closesAt: Date;
  timeLimitMinutes: number;
  status: 'upcoming' | 'open' | 'closed';
  attemptsUsed: number;
  maxAttempts: number;
  inProgressAttemptId: string | null;
  canStart: boolean;
  /** Only once results are released. */
  result: { score: number | null; max: number } | null;
}

/** What a student sees of an attempt: never answers or correctness before release (REQ-EXAM-004). */
export interface AttemptPaper {
  attemptId: string;
  examTitle: string;
  deadlineAt: Date;
  serverNow: Date;
  submitted: boolean;
  questions: {
    position: number;
    kind: 'mcq' | 'true_false' | 'short';
    body: string;
    choices: { id: string; text: string }[];
    points: number;
  }[];
  answers: Record<number, { response: ExamResponse; seq: number }>;
  result: { score: number | null; max: number } | null;
}

/** Exam attempts (REQ-EXAM-001, -002, -004, -006). */
@Injectable()
export class AttemptsService {
  private readonly logger = new Logger('Exams');

  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  /** Published exams for the classes the student is actively enrolled in. */
  async myExams(ctx: WorkspaceContext): Promise<StudentExam[]> {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      const rows = await tx
        .select({ exam: exams })
        .from(exams)
        .where(
          and(
            sql`${exams.publishedAt} is not null`,
            sql`exists (select 1 from exam_targets t join class_enrollments e on e.class_id = t.class_id
                 where t.exam_id = ${exams.id} and e.membership_id = ${ctx.membershipId}
                   and e.ended_at is null)`,
          ),
        )
        .orderBy(asc(exams.opensAt));
      const now = this.clock.now();
      const out: StudentExam[] = [];
      for (const { exam } of rows) {
        const attempts = await tx
          .select()
          .from(examAttempts)
          .where(
            and(eq(examAttempts.examId, exam.id), eq(examAttempts.membershipId, ctx.membershipId)),
          );
        const open = attempts.find((a) => a.submittedAt === null) ?? null;
        const status = now < exam.opensAt ? 'upcoming' : now >= exam.closesAt ? 'closed' : 'open';
        const counted = countedScore(
          attempts.map((a) => ({
            number: a.number,
            scoreCenti: a.scoreCenti,
            submitted: a.submittedAt !== null,
          })),
          exam.scoreRule,
        );
        out.push({
          id: exam.id,
          title: exam.title,
          opensAt: exam.opensAt,
          closesAt: exam.closesAt,
          timeLimitMinutes: exam.timeLimitMinutes,
          status,
          attemptsUsed: attempts.length,
          maxAttempts: exam.maxAttempts,
          inProgressAttemptId: open?.id ?? null,
          canStart:
            status === 'open' &&
            !ctx.paused &&
            (open !== null || attempts.length < exam.maxAttempts),
          result:
            exam.resultsReleasedAt && attempts.length > 0
              ? {
                  score: counted === null ? null : counted / 100,
                  max: (attempts[0]?.maxCenti ?? 0) / 100,
                }
              : null,
        });
      }
      return out;
    });
  }

  /**
   * Starts (or resumes) an attempt. Only for students actively enrolled in a target class and not
   * paused (REQ-EXAM-006), inside the window, with attempts left. The deadline is fixed now.
   */
  async start(
    ctx: WorkspaceContext,
    examId: string,
    userId: string,
  ): Promise<{ attemptId: string }> {
    try {
      return await this.db.inWorkspace(ctx.workspaceId, async (tx) => {
        const [exam] = await tx.select().from(exams).where(eq(exams.id, examId));
        if (!exam || !exam.publishedAt) throw notFound('Exam not found');
        const eligible = await tx.execute<{ ok: boolean }>(sql`
          select exists (select 1 from exam_targets t join class_enrollments e on e.class_id = t.class_id
                          where t.exam_id = ${examId} and e.membership_id = ${ctx.membershipId}
                            and e.ended_at is null) as ok`);
        if (!eligible.rows[0]?.ok) throw notFound('Exam not found');
        // A neutral refusal: the student isn't told why (REQ-EXAM-006).
        if (ctx.paused) throw new AppError(403, 'exam_unavailable', 'This exam is not available');
        // One start at a time per student and exam, so parallel starts resume one attempt.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`exam-start:${examId}:${ctx.membershipId}`}, 0))`,
        );
        const attempts = await tx
          .select()
          .from(examAttempts)
          .where(
            and(eq(examAttempts.examId, examId), eq(examAttempts.membershipId, ctx.membershipId)),
          )
          .for('update');
        const open = attempts.find((a) => a.submittedAt === null);
        if (open) return { attemptId: open.id };
        const now = this.clock.now();
        if (now < exam.opensAt || now >= exam.closesAt) {
          throw new AppError(403, 'exam_not_open', 'This exam is not open now');
        }
        if (attempts.length >= exam.maxAttempts) {
          throw new AppError(403, 'no_attempts_left', 'No attempts left');
        }
        const items = await tx
          .select({
            position: examItems.position,
            choices: questionVersions.choices,
            points: questionVersions.pointsCenti,
          })
          .from(examItems)
          .innerJoin(questionVersions, eq(questionVersions.id, examItems.questionVersionId))
          .where(eq(examItems.examId, examId))
          .orderBy(asc(examItems.position));
        const ordered = exam.shuffleQuestions ? shuffled(items) : items;
        const layout: AttemptLayoutEntry[] = ordered.map((i) => ({
          position: i.position,
          choiceOrder: (exam.shuffleChoices ? shuffled(i.choices) : i.choices).map((c) => c.id),
        }));
        const [accommodation] = await tx
          .select({ extra: examAccommodations.extraMinutes })
          .from(examAccommodations)
          .where(
            and(
              eq(examAccommodations.examId, examId),
              eq(examAccommodations.membershipId, ctx.membershipId),
            ),
          );
        const id = this.ids.newId();
        await tx.insert(examAttempts).values({
          workspaceId: ctx.workspaceId,
          id,
          examId,
          membershipId: ctx.membershipId,
          number: attempts.length + 1,
          startedAt: now,
          deadlineAt: attemptDeadline({
            startedAt: now,
            timeLimitMinutes: exam.timeLimitMinutes,
            closesAt: exam.closesAt,
            extraMinutes: accommodation?.extra ?? 0,
          }),
          layout,
          maxCenti: items.reduce((sum, i) => sum + i.points, 0),
        });
        await this.audit.record(tx, {
          action: 'exam.attempt_started',
          workspaceId: ctx.workspaceId,
          actor: { type: 'user', userId },
          entity: { type: 'exam_attempt', id },
          newValue: { examId, number: attempts.length + 1 },
        });
        return { attemptId: id };
      });
    } catch (err) {
      // Two starts at once: the partial unique index lets one win; the other resumes it.
      if (isUniqueViolation(err, 'exam_attempts_open_uq')) return this.start(ctx, examId, userId);
      throw err;
    }
  }

  /** The paper, in this attempt's order, with saved answers. Closes the attempt if time is up. */
  async paper(ctx: WorkspaceContext, attemptId: string): Promise<AttemptPaper> {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      const attempt = await this.own(tx, ctx, attemptId);
      const [exam] = await tx.select().from(exams).where(eq(exams.id, attempt.examId));
      if (!exam) throw notFound('Exam not found');
      if (!attempt.submittedAt && !acceptsAnswers(attempt.deadlineAt, this.clock.now())) {
        await this.finalize(tx, attempt, 'timeout');
      }
      const [current] = await tx.select().from(examAttempts).where(eq(examAttempts.id, attemptId));
      const items = await tx
        .select({ position: examItems.position, version: questionVersions })
        .from(examItems)
        .innerJoin(questionVersions, eq(questionVersions.id, examItems.questionVersionId))
        .where(eq(examItems.examId, attempt.examId));
      const byPosition = new Map(items.map((i) => [i.position, i.version]));
      const answers = await tx
        .select({
          position: examAnswers.position,
          response: examAnswers.response,
          seq: examAnswers.seq,
        })
        .from(examAnswers)
        .where(eq(examAnswers.attemptId, attemptId));
      const released = exam.resultsReleasedAt !== null;
      return {
        attemptId,
        examTitle: exam.title,
        deadlineAt: attempt.deadlineAt,
        serverNow: this.clock.now(),
        submitted: current?.submittedAt !== null && current?.submittedAt !== undefined,
        questions: attempt.layout.map((entry) => {
          const version = byPosition.get(entry.position);
          const choices = version?.choices ?? [];
          return {
            position: entry.position,
            kind: version?.kind ?? 'short',
            body: version?.body ?? '',
            choices: entry.choiceOrder
              .map((id) => choices.find((c) => c.id === id))
              .filter((c): c is { id: string; text: string } => c !== undefined),
            points: (version?.pointsCenti ?? 0) / 100,
          };
        }),
        answers: Object.fromEntries(
          answers.map((a) => [a.position, { response: a.response, seq: a.seq }]),
        ),
        result:
          released && current?.submittedAt
            ? {
                score: current.scoreCenti === null ? null : current.scoreCenti / 100,
                max: current.maxCenti / 100,
              }
            : null,
      };
    });
  }

  /**
   * Saves one answer (REQ-EXAM-004). Idempotent: the client's `seq` only moves forward, so a
   * retried or late-arriving older save never overwrites a newer one. Refused after the deadline
   * plus the grace period, whether or not the sweeper has run (REQ-EXAM-002).
   */
  async save(
    ctx: WorkspaceContext,
    attemptId: string,
    position: number,
    response: ExamResponse,
    seq: number,
  ): Promise<{ saved: true; seq: number }> {
    const outcome = await this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      const attempt = await this.own(tx, ctx, attemptId);
      if (attempt.submittedAt) return 'closed' as const;
      if (!acceptsAnswers(attempt.deadlineAt, this.clock.now())) {
        await this.finalize(tx, attempt, 'timeout');
        return 'closed' as const;
      }
      const entry = attempt.layout.find((l) => l.position === position);
      if (!entry) throw notFound('Question not found');
      const [item] = await tx
        .select({ kind: questionVersions.kind })
        .from(examItems)
        .innerJoin(questionVersions, eq(questionVersions.id, examItems.questionVersionId))
        .where(and(eq(examItems.examId, attempt.examId), eq(examItems.position, position)));
      if (!item || !fits(item.kind, response, entry.choiceOrder)) {
        throw new AppError(400, 'invalid_response', 'This answer does not fit the question');
      }
      const written = await tx
        .insert(examAnswers)
        .values({
          workspaceId: ctx.workspaceId,
          attemptId,
          position,
          response,
          seq,
          savedAt: this.clock.now(),
        })
        .onConflictDoUpdate({
          target: [examAnswers.attemptId, examAnswers.position],
          set: { response, seq, savedAt: this.clock.now() },
          setWhere: sql`excluded.seq > ${examAnswers.seq}`,
        })
        .returning({ seq: examAnswers.seq });
      return { seq: written[0]?.seq ?? seq };
    });
    if (outcome === 'closed') throw new AppError(409, 'attempt_closed', 'This attempt is closed');
    return { saved: true, seq: outcome.seq };
  }

  async submit(ctx: WorkspaceContext, attemptId: string): Promise<void> {
    await this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      const attempt = await this.own(tx, ctx, attemptId);
      if (attempt.submittedAt) return;
      const onTime = acceptsAnswers(attempt.deadlineAt, this.clock.now());
      await this.finalize(tx, attempt, onTime ? 'student' : 'timeout');
    });
  }

  /** The sweeper: closes attempts past their deadline and grace, in every workspace. */
  async sweep(): Promise<number> {
    const due = await this.db.transaction((tx) =>
      tx.execute<{ workspace_id: string; attempt_id: string }>(
        sql`select * from app.overdue_exam_attempts(${this.clock.now()}, ${GRACE_MS / 1000})`,
      ),
    );
    let closed = 0;
    for (const row of due.rows) {
      await this.db.inWorkspace(row.workspace_id, async (tx) => {
        const [attempt] = await tx
          .select()
          .from(examAttempts)
          .where(and(eq(examAttempts.id, row.attempt_id), isNull(examAttempts.submittedAt)))
          .for('update');
        if (attempt) {
          await this.finalize(tx, attempt, 'timeout');
          closed++;
        }
      });
    }
    if (closed > 0) this.logger.log({ event: 'exam_attempts_swept', closed });
    return closed;
  }

  /**
   * Grades and closes an attempt. Also used after an answer-key correction to regrade
   * (Phase 6 task 6.4).
   */
  async grade(tx: DbTx, attempt: typeof examAttempts.$inferSelect): Promise<number> {
    const rows = await tx
      .select({
        position: examAnswers.position,
        response: examAnswers.response,
        kind: questionVersions.kind,
        answer: questionVersions.answer,
        points: questionVersions.pointsCenti,
      })
      .from(examAnswers)
      .innerJoin(
        examItems,
        and(eq(examItems.examId, attempt.examId), eq(examItems.position, examAnswers.position)),
      )
      .innerJoin(questionVersions, eq(questionVersions.id, examItems.questionVersionId))
      .where(eq(examAnswers.attemptId, attempt.id));
    let score = 0;
    for (const r of rows) {
      const correct = isCorrect(r.kind, r.answer, r.response);
      if (correct) score += r.points;
      await tx
        .update(examAnswers)
        .set({ correct })
        .where(and(eq(examAnswers.attemptId, attempt.id), eq(examAnswers.position, r.position)));
    }
    return score;
  }

  private async finalize(
    tx: DbTx,
    attempt: typeof examAttempts.$inferSelect,
    reason: 'student' | 'timeout',
  ): Promise<void> {
    const score = await this.grade(tx, attempt);
    await tx
      .update(examAttempts)
      .set({ submittedAt: this.clock.now(), submitReason: reason, scoreCenti: score })
      .where(and(eq(examAttempts.id, attempt.id), isNull(examAttempts.submittedAt)));
    await this.audit.record(tx, {
      action: 'exam.attempt_submitted',
      workspaceId: attempt.workspaceId,
      actor: { type: 'system' },
      entity: { type: 'exam_attempt', id: attempt.id },
      newValue: { reason, scoreCenti: score },
    });
  }

  private async own(tx: DbTx, ctx: WorkspaceContext, attemptId: string) {
    const [attempt] = await tx
      .select()
      .from(examAttempts)
      .where(and(eq(examAttempts.id, attemptId), eq(examAttempts.membershipId, ctx.membershipId)))
      .for('update');
    if (!attempt) throw notFound('Attempt not found');
    return attempt;
  }
}

function fits(
  kind: 'mcq' | 'true_false' | 'short',
  response: ExamResponse,
  choiceOrder: string[],
): boolean {
  if (kind === 'mcq') return 'choiceId' in response && choiceOrder.includes(response.choiceId);
  if (kind === 'true_false') return 'value' in response && typeof response.value === 'boolean';
  return 'text' in response && typeof response.text === 'string' && response.text.length <= 500;
}
