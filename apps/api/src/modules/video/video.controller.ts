import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZodPipe } from '../../common/http/zod.pipe';
import {
  CurrentSession,
  WorkspacePermission,
  WorkspaceRoles,
  type SessionContext,
} from '../../common/policy';
import { CurrentWorkspace, type WorkspaceContext } from '../tenancy';
import { VideoService, type VideoView } from './video.service';

const uuidParam = new ZodPipe(z.uuid());
const ALL_ROLES = ['owner', 'class_teacher', 'assistant', 'student'] as const;
const limitBody = z.object({ limitMinutes: z.number().int().min(1).max(10_000).nullable() });
const progressBody = z.object({ seconds: z.number().int().min(1).max(60) });
const tokenQuery = z.object({ t: z.string().max(400).default('') });

function actorOf(session: SessionContext, request: FastifyRequest) {
  return { userId: session.userId, requestId: String(request.id) };
}

/** Lesson video (REQ-VIDEO-001 to -005). */
@Controller('v1/w/:workspaceId')
export class VideoController {
  constructor(private readonly video: VideoService) {}

  /** Raw bytes (`application/octet-stream`), at most 200 MB on the free setup. */
  @Post('lessons/:lessonId/video')
  @HttpCode(201)
  @WorkspacePermission('content.edit')
  upload(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('lessonId', uuidParam) lessonId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<VideoView> {
    return this.video.upload(ctx, lessonId, body, actorOf(session, request));
  }

  @Get('lessons/:lessonId/video')
  @WorkspaceRoles([...ALL_ROLES])
  async get(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Param('lessonId', uuidParam) lessonId: string,
  ): Promise<{ video: VideoView | null }> {
    return { video: await this.video.forLesson(ctx, lessonId) };
  }

  @Post('lessons/:lessonId/video/limit')
  @HttpCode(204)
  @WorkspacePermission('content.edit')
  async limit(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('lessonId', uuidParam) lessonId: string,
    @Body(new ZodPipe(limitBody)) body: z.infer<typeof limitBody>,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.video.setViewLimit(
      ctx,
      lessonId,
      body.limitMinutes === null ? null : body.limitMinutes * 60,
      actorOf(session, request),
    );
  }

  @Post('lessons/:lessonId/video/reset/:membershipId')
  @HttpCode(204)
  @WorkspacePermission('access.grants')
  async reset(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('lessonId', uuidParam) lessonId: string,
    @Param('membershipId', uuidParam) membershipId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.video.resetWatchTime(ctx, lessonId, membershipId, actorOf(session, request));
  }

  @Post('lessons/:lessonId/playback')
  @HttpCode(200)
  @WorkspaceRoles([...ALL_ROLES])
  playback(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('lessonId', uuidParam) lessonId: string,
  ) {
    return this.video.playback(ctx, lessonId, session.sessionId);
  }

  @Post('video/:videoId/progress')
  @HttpCode(204)
  @WorkspaceRoles([...ALL_ROLES])
  async progress(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Param('videoId', uuidParam) videoId: string,
    @Body(new ZodPipe(progressBody)) body: z.infer<typeof progressBody>,
  ): Promise<void> {
    await this.video.progress(ctx, videoId, body.seconds);
  }

  /** Playlists and segments, with the playback token in `?t=`. */
  @Get('video/:videoId/:file')
  @WorkspaceRoles([...ALL_ROLES])
  async file(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('videoId', uuidParam) videoId: string,
    @Param('file') file: string,
    @Query(new ZodPipe(tokenQuery)) query: z.infer<typeof tokenQuery>,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const result = await this.video.file(ctx, videoId, file, query.t, session.sessionId);
    await reply
      .header('Content-Type', result.contentType)
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .send(result.data);
  }
}
