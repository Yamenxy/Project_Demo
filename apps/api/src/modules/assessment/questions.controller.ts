import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZodPipe } from '../../common/http/zod.pipe';
import { CurrentSession, WorkspacePermission, type SessionContext } from '../../common/policy';
import { CurrentWorkspace, type WorkspaceContext } from '../tenancy';
import { QuestionsService, type QuestionView } from './questions.service';

const uuidParam = new ZodPipe(z.uuid());
const common = {
  body: z.string().trim().min(1).max(5000),
  feedback: z.string().trim().max(2000).optional(),
  points: z.number().min(0.01).max(100).multipleOf(0.01).default(1),
};
const questionBody = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('mcq'),
    ...common,
    choices: z.array(z.string().trim().min(1).max(500)).min(2).max(8),
    correctIndex: z.number().int().min(0).max(7),
  }),
  z.object({ kind: z.literal('true_false'), ...common, value: z.boolean() }),
  z.object({
    kind: z.literal('short'),
    ...common,
    accepted: z.array(z.string().trim().min(1).max(200)).min(1).max(10),
    arabicVariants: z.boolean().default(true),
  }),
]);

function actorOf(session: SessionContext, request: FastifyRequest) {
  return { userId: session.userId, requestId: String(request.id) };
}

/** Question bank (REQ-QBANK-001 to -003), for staff with `assessment.edit`. */
@Controller('v1/w/:workspaceId')
export class QuestionsController {
  constructor(private readonly questions: QuestionsService) {}

  @Get('courses/:courseId/questions')
  @WorkspacePermission('assessment.edit')
  async list(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Param('courseId', uuidParam) courseId: string,
  ): Promise<{ questions: QuestionView[] }> {
    return { questions: await this.questions.list(ctx, courseId) };
  }

  @Post('courses/:courseId/questions')
  @HttpCode(201)
  @WorkspacePermission('assessment.edit')
  create(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('courseId', uuidParam) courseId: string,
    @Body(new ZodPipe(questionBody)) body: z.infer<typeof questionBody>,
    @Req() request: FastifyRequest,
  ): Promise<QuestionView> {
    return this.questions.create(ctx, courseId, body, actorOf(session, request));
  }

  @Post('questions/:questionId')
  @HttpCode(200)
  @WorkspacePermission('assessment.edit')
  edit(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('questionId', uuidParam) questionId: string,
    @Body(new ZodPipe(questionBody)) body: z.infer<typeof questionBody>,
    @Req() request: FastifyRequest,
  ): Promise<QuestionView> {
    return this.questions.edit(ctx, questionId, body, actorOf(session, request));
  }

  @Post('questions/:questionId/archive')
  @HttpCode(204)
  @WorkspacePermission('assessment.edit')
  async archive(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('questionId', uuidParam) questionId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.questions.archive(ctx, questionId, actorOf(session, request));
  }

  @Get('questions/:questionId/versions')
  @WorkspacePermission('assessment.edit')
  async versions(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Param('questionId', uuidParam) questionId: string,
  ): Promise<{ versions: QuestionView[] }> {
    return { versions: await this.questions.versions(ctx, questionId) };
  }
}
