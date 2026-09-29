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
import { GradingService, type Gradebook, type MyGrades } from './grading.service';

const uuidParam = new ZodPipe(z.uuid());
const points = z.number().min(0).max(1000).multipleOf(0.01);
const itemBody = z.object({ title: z.string().trim().min(2).max(120), maxScore: points.min(0.01) });
const itemChange = z
  .object({
    title: z.string().trim().min(2).max(120).optional(),
    maxScore: points.min(0.01).optional(),
    archived: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'nothing to change' });
const scoresBody = z.object({
  scores: z
    .array(z.object({ membershipId: z.uuid(), score: points.nullable() }))
    .min(1)
    .max(500),
  reason: z.string().trim().max(300).optional(),
});
const releaseBody = z.object({ released: z.boolean() });

function actorOf(session: SessionContext, request: FastifyRequest) {
  return { userId: session.userId, requestId: String(request.id) };
}

/** The gradebook (REQ-GRADE-001 to -003). */
@Controller('v1/w/:workspaceId')
export class GradingController {
  constructor(private readonly grading: GradingService) {}

  @Get('classes/:classId/gradebook')
  @WorkspacePermission('grading.grade')
  gradebook(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Param('classId', uuidParam) classId: string,
  ): Promise<Gradebook> {
    return this.grading.gradebook(ctx, classId);
  }

  @Post('classes/:classId/grade-items')
  @HttpCode(201)
  @WorkspacePermission('grading.grade')
  createItem(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('classId', uuidParam) classId: string,
    @Body(new ZodPipe(itemBody)) body: z.infer<typeof itemBody>,
    @Req() request: FastifyRequest,
  ): Promise<{ id: string }> {
    return this.grading.createItem(ctx, classId, body, actorOf(session, request));
  }

  @Post('grade-items/:itemId')
  @HttpCode(204)
  @WorkspacePermission('grading.grade')
  async updateItem(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('itemId', uuidParam) itemId: string,
    @Body(new ZodPipe(itemChange)) body: z.infer<typeof itemChange>,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.grading.updateItem(ctx, itemId, body, actorOf(session, request));
  }

  @Post('grade-items/:itemId/scores')
  @HttpCode(200)
  @WorkspacePermission('grading.grade')
  setScores(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('itemId', uuidParam) itemId: string,
    @Body(new ZodPipe(scoresBody)) body: z.infer<typeof scoresBody>,
    @Req() request: FastifyRequest,
  ): Promise<{ changed: number }> {
    return this.grading.setScores(
      ctx,
      itemId,
      { scores: body.scores, ...(body.reason ? { reason: body.reason } : {}) },
      actorOf(session, request),
    );
  }

  @Post('grade-items/:itemId/release')
  @HttpCode(204)
  @WorkspacePermission('grading.release')
  async release(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('itemId', uuidParam) itemId: string,
    @Body(new ZodPipe(releaseBody)) body: z.infer<typeof releaseBody>,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.grading.setReleased(ctx, itemId, body.released, actorOf(session, request));
  }

  @Get('grade-items/:itemId/history')
  @WorkspacePermission('grading.grade')
  async history(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Param('itemId', uuidParam) itemId: string,
  ) {
    return { changes: await this.grading.history(ctx, itemId) };
  }

  @Get('my/grades')
  @WorkspaceRoles(['student'])
  mine(@CurrentWorkspace() ctx: WorkspaceContext): Promise<MyGrades> {
    return this.grading.mine(ctx);
  }
}
