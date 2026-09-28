import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZodPipe } from '../../common/http/zod.pipe';
import type { UserSummary } from './auth.schemas';
import { metaOf } from './request-meta';
import { RecoveryService } from './recovery.service';
import { CurrentSession, SessionGuard } from './session.guard';
import type { ResolvedSession } from './sessions.service';

const codeField = z.string().trim().min(4).max(12);
const verifyBody = z.object({ code: codeField });
const forgotBody = z.object({ phone: z.string().min(1).max(40) });
const resetBody = z.object({
  phone: z.string().min(1).max(40),
  code: codeField,
  newPassword: z.string().min(1).max(256),
});

@Controller('v1/auth')
export class RecoveryController {
  constructor(private readonly recovery: RecoveryService) {}

  @Post('phone/send-code')
  @HttpCode(202)
  @UseGuards(SessionGuard)
  async sendCode(
    @CurrentSession() session: ResolvedSession,
    @Req() request: FastifyRequest,
  ): Promise<{ expiresInSeconds: number }> {
    const expiresInSeconds = await this.recovery.sendVerificationCode(
      session.userId,
      metaOf(request),
    );
    return { expiresInSeconds };
  }

  @Post('phone/verify')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  async verify(
    @CurrentSession() session: ResolvedSession,
    @Body(new ZodPipe(verifyBody)) body: z.infer<typeof verifyBody>,
    @Req() request: FastifyRequest,
  ): Promise<{ user: UserSummary }> {
    const user = await this.recovery.verifyPhone(session.userId, body.code, metaOf(request));
    return { user };
  }

  /** Always 202, whether or not the number has an account. */
  @Post('password/forgot')
  @HttpCode(202)
  async forgot(
    @Body(new ZodPipe(forgotBody)) body: z.infer<typeof forgotBody>,
    @Req() request: FastifyRequest,
  ): Promise<Record<string, never>> {
    await this.recovery.requestPasswordReset(body.phone, metaOf(request));
    return {};
  }

  @Post('password/reset')
  @HttpCode(204)
  async reset(
    @Body(new ZodPipe(resetBody)) body: z.infer<typeof resetBody>,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.recovery.resetPassword(body.phone, body.code, body.newPassword, metaOf(request));
  }
}
