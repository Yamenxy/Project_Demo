import { Controller, Get, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Authenticated, CurrentSession, type SessionContext } from '../../common/policy';
import { PrivacyService } from './privacy.service';

/** Download my data (REQ-PRIV-003). */
@Controller('v1/me')
@Authenticated()
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  @Get('data-export')
  async export(
    @CurrentSession() session: SessionContext,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const data = await this.privacy.export({
      userId: session.userId,
      requestId: String(request.id),
    });
    await reply
      .header('Content-Type', 'application/json; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="my-data.json"')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, no-store')
      .send(JSON.stringify(data, null, 2));
  }
}
