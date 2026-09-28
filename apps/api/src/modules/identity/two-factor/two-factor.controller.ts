import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZodPipe } from '../../../common/http/zod.pipe';
import { Authenticated } from '../../../common/policy';
import { metaOf } from '../request-meta';
import { CurrentSession } from '../current-session';
import type { ResolvedSession } from '../sessions.service';
import { TwoFactorService, type TwoFactorSetup } from './two-factor.service';

const codeBody = z.object({ code: z.string().trim().min(6).max(20) });

@Controller('v1/auth/2fa')
@Authenticated()
export class TwoFactorController {
  constructor(private readonly twoFactor: TwoFactorService) {}

  /** Returns the secret and an otpauth URI for the web app to show as a QR code. */
  @Post('setup')
  @HttpCode(200)
  setup(@CurrentSession() session: ResolvedSession): Promise<TwoFactorSetup> {
    return this.twoFactor.setup(session.userId);
  }

  @Post('enable')
  @HttpCode(200)
  async enable(
    @CurrentSession() session: ResolvedSession,
    @Body(new ZodPipe(codeBody)) body: z.infer<typeof codeBody>,
    @Req() request: FastifyRequest,
  ): Promise<{ recoveryCodes: string[] }> {
    const recoveryCodes = await this.twoFactor.enable(
      session.userId,
      session.sessionId,
      body.code,
      metaOf(request),
    );
    return { recoveryCodes };
  }

  @Post('verify')
  @HttpCode(204)
  @Authenticated({ allowPendingSecondFactor: true })
  async verify(
    @CurrentSession() session: ResolvedSession,
    @Body(new ZodPipe(codeBody)) body: z.infer<typeof codeBody>,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.twoFactor.verify(session.userId, session.sessionId, body.code, metaOf(request));
  }
}
