import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { AppError, Clock, IdGenerator, notFound } from '../../common';
import { TenantDb, type DbTx } from '../../database';
import { AuditService } from '../audit';
import { courses, courseScope } from '../content';
import type { WorkspaceContext } from '../tenancy';
import { questions, questionVersions, type Answer, type Choice, type QuestionKind } from './schema';

export interface Actor {
  userId: string;
  requestId?: string;
}

/** What staff send; choices get server ids, and the correct choice is named by position. */
export type QuestionInput =
  | {
      kind: 'mcq';
      body: string;
      choices: string[];
      correctIndex: number;
      feedback?: string;
      points: number;
    }
  | { kind: 'true_false'; body: string; value: boolean; feedback?: string; points: number }
  | {
      kind: 'short';
      body: string;
      accepted: string[];
      arabicVariants: boolean;
      feedback?: string;
      points: number;
    };

export interface QuestionView {
  id: string;
  courseId: string;
  version: number;
  versionId: string;
  kind: QuestionKind;
  body: string;
  choices: Choice[];
  answer: Answer;
  feedback: string | null;
  points: number;
}

/** Question bank (REQ-QBANK-001 to -003). Staff only; answers never leave through here to students. */
@Injectable()
export class QuestionsService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async list(ctx: WorkspaceContext, courseId: string): Promise<QuestionView[]> {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      await this.course(tx, ctx, courseId);
      const rows = await tx
        .select({ q: questions, v: questionVersions })
        .from(questions)
        .innerJoin(
          questionVersions,
          and(
            eq(questionVersions.questionId, questions.id),
            eq(questionVersions.version, questions.currentVersion),
          ),
        )
        .where(and(eq(questions.courseId, courseId), isNull(questions.archivedAt)))
        .orderBy(asc(questions.createdAt));
      return rows.map(({ q, v }) => view(q.courseId, v));
    });
  }

  async create(
    ctx: WorkspaceContext,
    courseId: string,
    input: QuestionInput,
    actor: Actor,
  ): Promise<QuestionView> {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      await this.course(tx, ctx, courseId);
      const id = this.ids.newId();
      const now = this.clock.now();
      await tx.insert(questions).values({
        workspaceId: ctx.workspaceId,
        id,
        courseId,
        currentVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
      const version = await this.addVersion(tx, ctx.workspaceId, id, 1, input, actor.userId);
      await this.audit.record(tx, {
        action: 'question.created',
        workspaceId: ctx.workspaceId,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'question', id },
        newValue: { courseId, kind: input.kind },
        requestId: actor.requestId,
      });
      return view(courseId, version);
    });
  }

  /** An edit is always a new immutable version; earlier versions stay as they were (REQ-QBANK-002). */
  async edit(
    ctx: WorkspaceContext,
    questionId: string,
    input: QuestionInput,
    actor: Actor,
  ): Promise<QuestionView> {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      const q = await this.question(tx, ctx, questionId);
      const next = q.currentVersion + 1;
      const version = await this.addVersion(
        tx,
        ctx.workspaceId,
        questionId,
        next,
        input,
        actor.userId,
      );
      await tx
        .update(questions)
        .set({ currentVersion: next, updatedAt: this.clock.now() })
        .where(eq(questions.id, questionId));
      await this.audit.record(tx, {
        action: 'question.versioned',
        workspaceId: ctx.workspaceId,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'question', id: questionId },
        newValue: { version: next },
        requestId: actor.requestId,
      });
      return view(q.courseId, version);
    });
  }

  async archive(ctx: WorkspaceContext, questionId: string, actor: Actor): Promise<void> {
    await this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      await this.question(tx, ctx, questionId);
      await tx
        .update(questions)
        .set({ archivedAt: this.clock.now(), updatedAt: this.clock.now() })
        .where(eq(questions.id, questionId));
      await this.audit.record(tx, {
        action: 'question.archived',
        workspaceId: ctx.workspaceId,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'question', id: questionId },
        requestId: actor.requestId,
      });
    });
  }

  async versions(ctx: WorkspaceContext, questionId: string): Promise<QuestionView[]> {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      const q = await this.question(tx, ctx, questionId);
      const rows = await tx
        .select()
        .from(questionVersions)
        .where(eq(questionVersions.questionId, questionId))
        .orderBy(desc(questionVersions.version));
      return rows.map((v) => view(q.courseId, v));
    });
  }

  private async addVersion(
    tx: DbTx,
    workspaceId: string,
    questionId: string,
    version: number,
    input: QuestionInput,
    userId: string,
  ) {
    let choices: Choice[] = [];
    let answer: Answer;
    if (input.kind === 'mcq') {
      choices = input.choices.map((text) => ({ id: randomUUID().slice(0, 8), text: text.trim() }));
      const correct = choices[input.correctIndex];
      if (!correct) throw new AppError(400, 'invalid_correct_choice', 'Pick the correct choice');
      answer = { correct: correct.id };
    } else if (input.kind === 'true_false') {
      answer = { value: input.value };
    } else {
      answer = {
        accepted: input.accepted.map((a) => a.trim()).filter(Boolean),
        arabicVariants: input.arabicVariants,
      };
    }
    const [row] = await tx
      .insert(questionVersions)
      .values({
        workspaceId,
        id: this.ids.newId(),
        questionId,
        version,
        kind: input.kind,
        body: input.body.trim(),
        choices,
        answer,
        feedback: input.feedback?.trim() || null,
        pointsCenti: Math.round(input.points * 100),
        createdBy: userId,
        createdAt: this.clock.now(),
      })
      .returning();
    if (!row) throw new Error('question version not written');
    return row;
  }

  /** `assessment.edit` for the course (workspace-wide, or courses of scoped classes). */
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

  private async question(tx: DbTx, ctx: WorkspaceContext, questionId: string) {
    const [q] = await tx
      .select()
      .from(questions)
      .where(and(eq(questions.id, questionId), isNull(questions.archivedAt)))
      .for('update');
    if (!q) throw notFound('Question not found');
    await this.course(tx, ctx, q.courseId);
    return q;
  }
}

function view(courseId: string, v: typeof questionVersions.$inferSelect): QuestionView {
  return {
    id: v.questionId,
    courseId,
    version: v.version,
    versionId: v.id,
    kind: v.kind,
    body: v.body,
    choices: v.choices,
    answer: v.answer,
    feedback: v.feedback,
    points: v.pointsCenti / 100,
  };
}
