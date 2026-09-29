import { Body, Controller, Get, Header, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZodPipe } from '../../common/http/zod.pipe';
import { CurrentSession, Public, WorkspaceRoles, type SessionContext } from '../../common/policy';
import type { WorkspaceContext } from './access.guard';
import {
  PublicPageService,
  type PublicPageSettings,
  type PublicTeacherPage,
} from './public-page.service';
import { CurrentWorkspace } from './workspace.controller';

const slugParam = new ZodPipe(
  z
    .string()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/),
);

const settingsBody = z.object({
  enabled: z.boolean().optional(),
  bio: z.string().max(1000).nullable().optional(),
  subjects: z.array(z.string().trim().min(1).max(40)).max(8).optional(),
});

/** The public teacher page (REQ-CONTENT-003), readable without signing in. */
@Controller('v1/public/teachers')
export class PublicTeacherController {
  constructor(private readonly pages: PublicPageService) {}

  @Get(':slug')
  @Public()
  @Header('Cache-Control', 'no-cache')
  page(@Param('slug', slugParam) slug: string): Promise<PublicTeacherPage> {
    return this.pages.page(slug);
  }
}

/** The owner edits what the public page shows. */
@Controller('v1/w/:workspaceId/public-page')
export class PublicPageSettingsController {
  constructor(private readonly pages: PublicPageService) {}

  @Get()
  @WorkspaceRoles(['owner'])
  settings(@CurrentWorkspace() ctx: WorkspaceContext): Promise<PublicPageSettings> {
    return this.pages.settings(ctx.workspaceId);
  }

  @Post()
  @HttpCode(200)
  @WorkspaceRoles(['owner'])
  update(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Body(new ZodPipe(settingsBody)) body: z.infer<typeof settingsBody>,
    @Req() request: FastifyRequest,
  ): Promise<PublicPageSettings> {
    return this.pages.update(ctx.workspaceId, body, {
      userId: session.userId,
      requestId: String(request.id),
    });
  }
}
