import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
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
import { HomeworkService, type SubmissionView } from './homework.service';

const uuidParam = new ZodPipe(z.uuid());
const homeworkBody = z.object({
  title: z.string().trim().min(2).max(160),
  instructions: z.string().trim().max(10000).optional(),
  dueAt: z.iso.datetime(),
  latePolicy: z.enum(['reject', 'accept_flagged']).default('accept_flagged'),
  allowResubmission: z.boolean().default(false),
  maxScore: z.number().min(0.01).max(1000).multipleOf(0.01),
  classIds: z.array(z.uuid()).min(1).max(50),
});
const publishBody = z.object({ published: z.boolean() });
const gradeBody = z.object({
  score: z.number().min(0).max(1000).multipleOf(0.01),
  feedback: z.string().trim().max(2000).optional(),
});
const submitBody = z.object({ text: z.string().max(10000).optional() });

function actorOf(session: SessionContext, request: FastifyRequest) {
  return { userId: session.userId, requestId: String(request.id) };
}

/** Homework (REQ-HW-001, REQ-HW-002). */
@Controller('v1/w/:workspaceId')
export class HomeworkController {
  constructor(private readonly homework: HomeworkService) {}

  @Get('courses/:courseId/homework')
  @WorkspacePermission('assessment.edit')
  async list(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Param('courseId', uuidParam) courseId: string,
  ) {
    return { homework: await this.homework.list(ctx, courseId) };
  }

  @Post('courses/:courseId/homework')
  @HttpCode(201)
  @WorkspacePermission('assessment.edit')
  create(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('courseId', uuidParam) courseId: string,
    @Body(new ZodPipe(homeworkBody)) body: z.infer<typeof homeworkBody>,
    @Req() request: FastifyRequest,
  ): Promise<{ id: string }> {
    return this.homework.create(
      ctx,
      courseId,
      { ...body, dueAt: new Date(body.dueAt) },
      actorOf(session, request),
    );
  }

  @Post('homework/:homeworkId/publish')
  @HttpCode(204)
  @WorkspacePermission('assessment.edit')
  async publish(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('homeworkId', uuidParam) homeworkId: string,
    @Body(new ZodPipe(publishBody)) body: z.infer<typeof publishBody>,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.homework.setPublished(ctx, homeworkId, body.published, actorOf(session, request));
  }

  @Get('homework/:homeworkId/submissions')
  @WorkspacePermission('grading.grade')
  async submissions(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Param('homeworkId', uuidParam) homeworkId: string,
  ): Promise<{ submissions: SubmissionView[] }> {
    return { submissions: await this.homework.submissions(ctx, homeworkId) };
  }

  @Post('homework-submissions/:submissionId/grade')
  @HttpCode(204)
  @WorkspacePermission('grading.grade')
  async grade(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('submissionId', uuidParam) submissionId: string,
    @Body(new ZodPipe(gradeBody)) body: z.infer<typeof gradeBody>,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.homework.grade(ctx, submissionId, body, actorOf(session, request));
  }

  @Post('homework/:homeworkId/release')
  @HttpCode(204)
  @WorkspacePermission('grading.release')
  async release(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('homeworkId', uuidParam) homeworkId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.homework.release(ctx, homeworkId, actorOf(session, request));
  }

  @Get('my/homework')
  @WorkspaceRoles(['student'])
  async mine(@CurrentWorkspace() ctx: WorkspaceContext) {
    return { homework: await this.homework.mine(ctx) };
  }

  @Post('my/homework/:homeworkId/submissions')
  @HttpCode(201)
  @WorkspaceRoles(['student'])
  submit(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('homeworkId', uuidParam) homeworkId: string,
    @Body(new ZodPipe(submitBody)) body: z.infer<typeof submitBody>,
    @Req() request: FastifyRequest,
  ): Promise<{ id: string; late: boolean }> {
    return this.homework.submit(ctx, homeworkId, body.text, actorOf(session, request));
  }
}
