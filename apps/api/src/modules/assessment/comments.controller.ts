import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZodPipe } from '../../common/http/zod.pipe';
import { CurrentSession, WorkspaceRoles, type SessionContext } from '../../common/policy';
import { CurrentWorkspace, type WorkspaceContext } from '../tenancy';
import { CommentsService, type CommentView, type ReviewRow } from './comments.service';

const ALL_ROLES = ['owner', 'class_teacher', 'assistant', 'student'] as const;
const uuidParam = new ZodPipe(z.uuid());
const commentBody = z.object({ body: z.string().trim().min(1).max(2000) });
const reportBody = z.object({ reason: z.string().trim().min(3).max(500) });
const reviewQuery = z.object({ before: z.iso.datetime().optional() });

function actorOf(session: SessionContext, request: FastifyRequest) {
  return { userId: session.userId, requestId: String(request.id) };
}

/**
 * Homework comments (REQ-MSG-001). Every role may call these routes; the service decides whose
 * submission the caller may see (their own, or students they grade).
 */
@Controller('v1/w/:workspaceId')
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get('homework-submissions/:submissionId/comments')
  @WorkspaceRoles([...ALL_ROLES])
  async list(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Param('submissionId', uuidParam) submissionId: string,
  ): Promise<{ comments: CommentView[] }> {
    return { comments: await this.comments.list(ctx, submissionId) };
  }

  @Post('homework-submissions/:submissionId/comments')
  @HttpCode(201)
  @WorkspaceRoles([...ALL_ROLES])
  post(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('submissionId', uuidParam) submissionId: string,
    @Body(new ZodPipe(commentBody)) body: z.infer<typeof commentBody>,
    @Req() request: FastifyRequest,
  ): Promise<CommentView> {
    return this.comments.post(ctx, submissionId, body.body, actorOf(session, request));
  }

  @Post('homework-comments/:commentId/report')
  @HttpCode(204)
  @WorkspaceRoles([...ALL_ROLES])
  async report(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('commentId', uuidParam) commentId: string,
    @Body(new ZodPipe(reportBody)) body: z.infer<typeof reportBody>,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.comments.report(ctx, commentId, body.reason, actorOf(session, request));
  }

  /** The owner's review of all threads, newest first; `before` pages back. */
  @Get('homework-comments')
  @WorkspaceRoles(['owner'])
  async review(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Query(new ZodPipe(reviewQuery)) query: z.infer<typeof reviewQuery>,
  ): Promise<{ comments: ReviewRow[] }> {
    const before = query.before ? new Date(query.before) : undefined;
    return { comments: await this.comments.review(ctx, before) };
  }
}
