import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZodPipe } from '../../common/http/zod.pipe';
import { Authenticated, CurrentSession, type SessionContext } from '../../common/policy';
import { AccountService } from './account.service';
import { MembershipsService, type MyWorkspace } from './memberships.service';

const profileBody = z.object({
  nameAr: z.string().trim().min(2).max(120),
  nameLatin: z.string().trim().min(2).max(120).nullish(),
});

function actorOf(session: SessionContext, request: FastifyRequest) {
  return { userId: session.userId, requestId: String(request.id) };
}

/** The signed-in user's workspaces and platform role, and their own account (REQ-PRIV-003). */
@Controller('v1/me')
@Authenticated()
export class MeController {
  constructor(
    private readonly memberships: MembershipsService,
    private readonly account: AccountService,
  ) {}

  @Get('workspaces')
  async workspaces(
    @CurrentSession() session: SessionContext,
  ): Promise<{ platformOwner: boolean; workspaces: MyWorkspace[] }> {
    const [platformOwner, workspaces] = await Promise.all([
      this.memberships.isPlatformOwner(session.userId),
      this.memberships.listForUser(session.userId),
    ]);
    return { platformOwner, workspaces };
  }

  /** Correcting one's own name (global fields, REQ-PRIV-003). */
  @Post('profile')
  @HttpCode(204)
  async profile(
    @CurrentSession() session: SessionContext,
    @Body(new ZodPipe(profileBody)) body: z.infer<typeof profileBody>,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.account.updateProfile(body, actorOf(session, request));
  }

  @Post('deletion')
  requestDeletion(
    @CurrentSession() session: SessionContext,
    @Req() request: FastifyRequest,
  ): Promise<{ anonymizeAfter: Date }> {
    return this.account.requestDeletion(actorOf(session, request));
  }

  @Post('deletion/cancel')
  @HttpCode(204)
  async cancelDeletion(
    @CurrentSession() session: SessionContext,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.account.cancelDeletion(actorOf(session, request));
  }
}
