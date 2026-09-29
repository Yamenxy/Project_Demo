import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZodPipe } from '../../common/http/zod.pipe';
import { Authenticated, CurrentSession, type SessionContext } from '../../common/policy';
import { isoDate } from './auth.schemas';
import { ConsentService, type ConsentStatus } from './consent.service';
import { metaOf } from './request-meta';

const detailsBody = z
  .object({
    dateOfBirth: isoDate.optional(),
    guardianPhone: z.string().min(1).max(40).optional(),
  })
  .refine((b) => b.dateOfBirth !== undefined || b.guardianPhone !== undefined, {
    message: 'nothing to change',
  });
const verifyBody = z.object({ code: z.string().trim().min(4).max(12) });

/** The signed-in user's guardian consent (REQ-PRIV-001). */
@Controller('v1/auth/consent')
@Authenticated()
export class ConsentController {
  constructor(private readonly consent: ConsentService) {}

  @Get()
  status(@CurrentSession() session: SessionContext): Promise<ConsentStatus> {
    return this.consent.status(session.userId);
  }

  @Post('details')
  @HttpCode(200)
  details(
    @CurrentSession() session: SessionContext,
    @Body(new ZodPipe(detailsBody)) body: z.infer<typeof detailsBody>,
    @Req() request: FastifyRequest,
  ): Promise<ConsentStatus> {
    return this.consent.updateDetails(session.userId, body, metaOf(request));
  }

  @Post('send-code')
  @HttpCode(202)
  async sendCode(
    @CurrentSession() session: SessionContext,
    @Req() request: FastifyRequest,
  ): Promise<{ expiresInSeconds: number }> {
    return { expiresInSeconds: await this.consent.sendCode(session.userId, metaOf(request)) };
  }

  @Post('verify')
  @HttpCode(200)
  verify(
    @CurrentSession() session: SessionContext,
    @Body(new ZodPipe(verifyBody)) body: z.infer<typeof verifyBody>,
    @Req() request: FastifyRequest,
  ): Promise<ConsentStatus> {
    return this.consent.verifyCode(session.userId, body.code, metaOf(request));
  }
}
