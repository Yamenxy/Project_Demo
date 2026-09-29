import { Body, Controller, Get, HttpCode, Param, Post, Put, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZodPipe } from '../../common/http/zod.pipe';
import {
  CurrentSession,
  WorkspacePermission,
  WorkspaceRoles,
  type SessionContext,
} from '../../common/policy';
import { CurrentWorkspace, type WorkspaceContext } from '../tenancy';
import { AttemptsService, type AttemptPaper, type StudentExam } from './attempts.service';
import { ExamsService, type ExamSummary } from './exams.service';

const uuidParam = new ZodPipe(z.uuid());
const positionParam = new ZodPipe(z.coerce.number().int().min(0).max(500));
const settingsBody = z
  .object({
    title: z.string().trim().min(2).max(160),
    timeLimitMinutes: z.number().int().min(1).max(600),
    opensAt: z.iso.datetime(),
    closesAt: z.iso.datetime(),
    maxAttempts: z.number().int().min(1).max(10).default(1),
    scoreRule: z.enum(['highest', 'latest']).default('highest'),
    shuffleQuestions: z.boolean().default(false),
    shuffleChoices: z.boolean().default(false),
    passPercent: z.number().int().min(1).max(100).nullable().default(null),
    classIds: z.array(z.uuid()).min(1).max(50),
    questionIds: z.array(z.uuid()).min(1).max(200),
  })
  .refine((b) => new Set(b.questionIds).size === b.questionIds.length, {
    message: 'repeated question',
  });
const publishBody = z.object({ published: z.boolean() });
const accommodationBody = z.object({ extraMinutes: z.number().int().min(1).max(600).nullable() });
const answerBody = z.object({
  response: z.union([
    z.object({ choiceId: z.string().min(1).max(40) }),
    z.object({ value: z.boolean() }),
    z.object({ text: z.string().max(500) }),
  ]),
  seq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});

function actorOf(session: SessionContext, request: FastifyRequest) {
  return { userId: session.userId, requestId: String(request.id) };
}

function settings(body: z.infer<typeof settingsBody>) {
  return { ...body, opensAt: new Date(body.opensAt), closesAt: new Date(body.closesAt) };
}

/** Exams (REQ-EXAM-001 to -006). */
@Controller('v1/w/:workspaceId')
export class ExamsController {
  constructor(
    private readonly exams: ExamsService,
    private readonly attempts: AttemptsService,
  ) {}

  // --- staff ------------------------------------------------------------------------------------

  @Get('courses/:courseId/exams')
  @WorkspacePermission('assessment.edit')
  async list(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Param('courseId', uuidParam) courseId: string,
  ): Promise<{ exams: ExamSummary[] }> {
    return { exams: await this.exams.list(ctx, courseId) };
  }

  @Post('courses/:courseId/exams')
  @HttpCode(201)
  @WorkspacePermission('assessment.edit')
  create(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('courseId', uuidParam) courseId: string,
    @Body(new ZodPipe(settingsBody)) body: z.infer<typeof settingsBody>,
    @Req() request: FastifyRequest,
  ): Promise<{ id: string }> {
    return this.exams.create(ctx, courseId, settings(body), actorOf(session, request));
  }

  @Get('exams/:examId')
  @WorkspacePermission('assessment.edit')
  get(@CurrentWorkspace() ctx: WorkspaceContext, @Param('examId', uuidParam) examId: string) {
    return this.exams.get(ctx, examId);
  }

  @Put('exams/:examId')
  @HttpCode(204)
  @WorkspacePermission('assessment.edit')
  async update(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('examId', uuidParam) examId: string,
    @Body(new ZodPipe(settingsBody)) body: z.infer<typeof settingsBody>,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.exams.update(ctx, examId, settings(body), actorOf(session, request));
  }

  @Post('exams/:examId/publish')
  @HttpCode(204)
  @WorkspacePermission('assessment.edit')
  async publish(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('examId', uuidParam) examId: string,
    @Body(new ZodPipe(publishBody)) body: z.infer<typeof publishBody>,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.exams.setPublished(ctx, examId, body.published, actorOf(session, request));
  }

  @Put('exams/:examId/accommodations/:membershipId')
  @HttpCode(204)
  @WorkspacePermission('assessment.edit')
  async accommodation(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('examId', uuidParam) examId: string,
    @Param('membershipId', uuidParam) membershipId: string,
    @Body(new ZodPipe(accommodationBody)) body: z.infer<typeof accommodationBody>,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.exams.setAccommodation(
      ctx,
      examId,
      membershipId,
      body.extraMinutes,
      actorOf(session, request),
    );
  }

  @Get('exams/:examId/results')
  @WorkspacePermission('assessment.edit')
  results(@CurrentWorkspace() ctx: WorkspaceContext, @Param('examId', uuidParam) examId: string) {
    return this.exams.results(ctx, examId);
  }

  @Post('exams/:examId/release')
  @HttpCode(204)
  @WorkspacePermission('grading.release')
  async release(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('examId', uuidParam) examId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.exams.releaseResults(ctx, examId, actorOf(session, request));
  }

  // --- students --------------------------------------------------------------------------------

  @Get('my/exams')
  @WorkspaceRoles(['student'])
  async mine(@CurrentWorkspace() ctx: WorkspaceContext): Promise<{ exams: StudentExam[] }> {
    return { exams: await this.attempts.myExams(ctx) };
  }

  @Post('my/exams/:examId/attempts')
  @HttpCode(200)
  @WorkspaceRoles(['student'])
  start(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('examId', uuidParam) examId: string,
  ): Promise<{ attemptId: string }> {
    return this.attempts.start(ctx, examId, session.userId);
  }

  @Get('my/attempts/:attemptId')
  @WorkspaceRoles(['student'])
  paper(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Param('attemptId', uuidParam) attemptId: string,
  ): Promise<AttemptPaper> {
    return this.attempts.paper(ctx, attemptId);
  }

  @Put('my/attempts/:attemptId/answers/:position')
  @HttpCode(200)
  @WorkspaceRoles(['student'])
  save(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Param('attemptId', uuidParam) attemptId: string,
    @Param('position', positionParam) position: number,
    @Body(new ZodPipe(answerBody)) body: z.infer<typeof answerBody>,
  ): Promise<{ saved: true; seq: number }> {
    return this.attempts.save(ctx, attemptId, position, body.response, body.seq);
  }

  @Post('my/attempts/:attemptId/submit')
  @HttpCode(204)
  @WorkspaceRoles(['student'])
  async submit(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Param('attemptId', uuidParam) attemptId: string,
  ): Promise<void> {
    await this.attempts.submit(ctx, attemptId);
  }
}
