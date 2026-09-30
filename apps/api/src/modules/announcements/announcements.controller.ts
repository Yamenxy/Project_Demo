import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
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
import { AnnouncementsService, type AnnouncementView } from './announcements.service';

const postBody = z.object({
  classId: z.uuid().optional(),
  title: z.string().trim().min(2).max(160),
  body: z.string().trim().min(1).max(4000),
});

/** Announcements (REQ-NOTIF-001). */
@Controller('v1/w/:workspaceId')
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Get('announcements')
  @WorkspacePermission('announcements.post')
  async list(
    @CurrentWorkspace() ctx: WorkspaceContext,
  ): Promise<{ announcements: AnnouncementView[] }> {
    return { announcements: await this.announcements.list(ctx) };
  }

  @Post('announcements')
  @HttpCode(201)
  @WorkspacePermission('announcements.post')
  post(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Body(new ZodPipe(postBody)) body: z.infer<typeof postBody>,
    @Req() request: FastifyRequest,
  ): Promise<{ id: string; recipients: number }> {
    return this.announcements.post(ctx, body, {
      userId: session.userId,
      requestId: String(request.id),
    });
  }

  @Get('my/announcements')
  @WorkspaceRoles(['student'])
  async mine(
    @CurrentWorkspace() ctx: WorkspaceContext,
  ): Promise<{ announcements: AnnouncementView[] }> {
    return { announcements: await this.announcements.mine(ctx) };
  }
}
