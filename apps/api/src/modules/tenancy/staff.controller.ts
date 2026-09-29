import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZodPipe } from '../../common/http/zod.pipe';
import {
  Authenticated,
  CurrentSession,
  WorkspaceRoles,
  type SessionContext,
} from '../../common/policy';
import type { WorkspaceContext } from './access.guard';
import { InvitationsService, type InvitationView } from './invitations.service';
import { StaffService, type StaffMember } from './staff.service';
import { CurrentWorkspace } from './workspace.controller';

const inviteBody = z.object({
  phone: z.string().min(1).max(40),
  role: z.enum(['class_teacher', 'assistant']),
});

const acceptBody = z.object({
  workspaceId: z.uuid(),
  token: z.string().min(16).max(100),
});

const previewQuery = z.object({
  w: z.uuid(),
  t: z.string().min(16).max(100),
});

function actorOf(session: SessionContext, request: FastifyRequest) {
  return { userId: session.userId, requestId: String(request.id) };
}

/** Owner-only staff management (REQ-USER-005). Not delegable (Appendix A.2). */
@Controller('v1/w/:workspaceId/staff')
@WorkspaceRoles(['owner'])
export class StaffController {
  constructor(
    private readonly staff: StaffService,
    private readonly invitations: InvitationsService,
  ) {}

  @Get()
  async list(
    @CurrentWorkspace() ctx: WorkspaceContext,
  ): Promise<{ staff: StaffMember[]; invitations: InvitationView[] }> {
    const [staff, invitations] = await Promise.all([
      this.staff.list(ctx.workspaceId),
      this.invitations.list(ctx.workspaceId),
    ]);
    return { staff, invitations };
  }

  /** Returns the invitation link path once; the owner shares it with the invitee. */
  @Post('invitations')
  @HttpCode(201)
  async invite(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Body(new ZodPipe(inviteBody)) body: z.infer<typeof inviteBody>,
    @Req() request: FastifyRequest,
  ): Promise<{ invitation: InvitationView; link: string }> {
    const { invitation, token } = await this.invitations.inviteStaff(
      ctx.workspaceId,
      body,
      actorOf(session, request),
    );
    const link = `/join/staff?w=${ctx.workspaceId}&t=${encodeURIComponent(token)}`;
    return { invitation, link };
  }

  @Delete('invitations/:invitationId')
  @HttpCode(204)
  async revokeInvitation(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('invitationId', new ZodPipe(z.uuid())) invitationId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.invitations.revoke(ctx.workspaceId, invitationId, actorOf(session, request));
  }

  @Delete(':membershipId')
  @HttpCode(204)
  async remove(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('membershipId', new ZodPipe(z.uuid())) membershipId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.staff.remove(ctx.workspaceId, membershipId, actorOf(session, request));
  }
}

/** The invitee's side: see what they're invited to, and accept. */
@Controller('v1/invitations')
@Authenticated()
export class InvitationAcceptController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get('preview')
  preview(
    @Query(new ZodPipe(previewQuery)) query: z.infer<typeof previewQuery>,
  ): Promise<{ workspaceName: string; role: string }> {
    return this.invitations.preview(query.w, query.t);
  }

  @Post('accept')
  @HttpCode(200)
  async accept(
    @CurrentSession() session: SessionContext,
    @Body(new ZodPipe(acceptBody)) body: z.infer<typeof acceptBody>,
  ): Promise<{ workspaceId: string; membershipId: string }> {
    const membershipId = await this.invitations.accept(
      body.workspaceId,
      body.token,
      session.userId,
    );
    return { workspaceId: body.workspaceId, membershipId };
  }
}
