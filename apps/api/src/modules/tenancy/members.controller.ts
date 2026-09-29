import { Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZodPipe } from '../../common/http/zod.pipe';
import { CurrentSession, WorkspacePermission, type SessionContext } from '../../common/policy';
import type { WorkspaceContext } from './access.guard';
import { MembersService } from './members.service';
import { CurrentWorkspace } from './workspace.controller';

@Controller('v1/w/:workspaceId/memberships/:membershipId')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  /** Staff reset of a student's devices (REQ-AUTH-005, UX-09). */
  @Post('devices/reset')
  @HttpCode(200)
  @WorkspacePermission('students.sessions_reset')
  async resetDevices(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('membershipId', new ZodPipe(z.uuid())) membershipId: string,
    @Req() request: FastifyRequest,
  ): Promise<{ revokedDevices: number }> {
    const revokedDevices = await this.members.resetStudentDevices(ctx.workspaceId, membershipId, {
      userId: session.userId,
      requestId: String(request.id),
    });
    return { revokedDevices };
  }
}
