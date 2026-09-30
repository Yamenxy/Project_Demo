import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZodPipe } from '../../common/http/zod.pipe';
import { CurrentSession, PlatformOwnerOnly, type SessionContext } from '../../common/policy';
import { SUPPORT_MAX_MINUTES, SupportService, type SupportSessionView } from './support.service';

const uuidParam = new ZodPipe(z.uuid());
const startBody = z.object({
  reason: z.string().trim().min(5).max(300),
  ticket: z.string().trim().min(1).max(60),
  minutes: z.number().int().min(1).max(SUPPORT_MAX_MINUTES).default(30),
});

function actorOf(session: SessionContext, request: FastifyRequest) {
  return { userId: session.userId, requestId: String(request.id) };
}

/** Support sessions, for the platform owners (REQ-RBAC-003). */
@Controller('v1/platform')
@PlatformOwnerOnly()
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Get('workspaces/:workspaceId/support-sessions')
  async list(
    @Param('workspaceId', uuidParam) workspaceId: string,
  ): Promise<{ sessions: SupportSessionView[] }> {
    return { sessions: await this.support.list(workspaceId) };
  }

  @Post('workspaces/:workspaceId/support-sessions')
  @HttpCode(201)
  start(
    @CurrentSession() session: SessionContext,
    @Param('workspaceId', uuidParam) workspaceId: string,
    @Body(new ZodPipe(startBody)) body: z.infer<typeof startBody>,
    @Req() request: FastifyRequest,
  ): Promise<SupportSessionView> {
    return this.support.start(workspaceId, body, actorOf(session, request));
  }

  @Post('support-sessions/:sessionId/end')
  @HttpCode(204)
  async end(
    @CurrentSession() session: SessionContext,
    @Param('sessionId', uuidParam) sessionId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.support.end(sessionId, actorOf(session, request));
  }
}
