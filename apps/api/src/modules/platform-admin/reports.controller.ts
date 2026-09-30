import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZodPipe } from '../../common/http/zod.pipe';
import { CurrentSession, PlatformOwnerOnly, type SessionContext } from '../../common/policy';
import { CommentReportsService, type CommentReportView } from './reports.service';

const resolveBody = z.object({ resolution: z.enum(['dismissed', 'hidden']) });

/** Reported homework comments, for the platform owners (REQ-MSG-001). */
@Controller('v1/platform/comment-reports')
@PlatformOwnerOnly()
export class CommentReportsController {
  constructor(private readonly reports: CommentReportsService) {}

  @Get()
  async open(): Promise<{ reports: CommentReportView[] }> {
    return { reports: await this.reports.open() };
  }

  @Post(':commentId/resolve')
  @HttpCode(204)
  async resolve(
    @CurrentSession() session: SessionContext,
    @Param('commentId', new ZodPipe(z.uuid())) commentId: string,
    @Body(new ZodPipe(resolveBody)) body: z.infer<typeof resolveBody>,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.reports.resolve(commentId, body.resolution, {
      userId: session.userId,
      requestId: String(request.id),
    });
  }
}
