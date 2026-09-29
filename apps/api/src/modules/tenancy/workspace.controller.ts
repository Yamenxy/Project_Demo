import {
  Body,
  createParamDecorator,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Put,
  Req,
  type ExecutionContext,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { AppError, notFound } from '../../common';
import { ZodPipe } from '../../common/http/zod.pipe';
import {
  CurrentSession,
  WorkspaceRoles,
  type PermissionKey,
  type SessionContext,
} from '../../common/policy';
import { TenantDb } from '../../database';
import type { WorkspaceContext } from './access.guard';
import { PermissionsService } from './permissions.service';
import { workspaces, type MembershipRole } from './schema';

/** The workspace context the access guard attached to the request. */
export const CurrentWorkspace = createParamDecorator(
  (_: unknown, context: ExecutionContext): WorkspaceContext => {
    const workspace = context.switchToHttp().getRequest<FastifyRequest>().workspace;
    if (!workspace) throw new AppError(403, 'forbidden', 'Not allowed');
    return workspace;
  },
);

/** Without classes, the grant covers the whole workspace. */
const grantBody = z.object({ classIds: z.array(z.uuid()).max(100).optional() }).optional();

const ALL_ROLES: readonly MembershipRole[] = ['owner', 'class_teacher', 'assistant', 'student'];

export interface WorkspaceContextResponse {
  workspace: { id: string; slug: string; name: string; suspended: boolean };
  membership: { id: string; role: MembershipRole; paused: boolean };
  permissions: PermissionKey[];
}

@Controller('v1/w/:workspaceId')
export class WorkspaceController {
  constructor(
    private readonly db: TenantDb,
    private readonly permissions: PermissionsService,
  ) {}

  /**
   * Who am I in this workspace. Also answers while the workspace is suspended, so the web app
   * can show the neutral "temporarily unavailable" message (D12a).
   */
  @Get('context')
  @WorkspaceRoles(ALL_ROLES, { allowWhenSuspended: ALL_ROLES })
  async context(@CurrentWorkspace() ctx: WorkspaceContext): Promise<WorkspaceContextResponse> {
    const [workspace] = await this.db.transaction((tx) =>
      tx
        .select({ id: workspaces.id, slug: workspaces.slug, name: workspaces.name })
        .from(workspaces)
        .where(eq(workspaces.id, ctx.workspaceId)),
    );
    if (!workspace) throw notFound();
    return {
      workspace: { ...workspace, suspended: ctx.workspaceSuspended },
      membership: { id: ctx.membershipId, role: ctx.role, paused: ctx.paused },
      permissions: ctx.permissions.list(),
    };
  }

  /** Owner-only and not delegable: managing staff permissions (REQ-RBAC-002, -003 in §9). */
  @Put('memberships/:membershipId/permissions/:permission')
  @HttpCode(204)
  @WorkspaceRoles(['owner'])
  async grant(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('membershipId', new ZodPipe(z.uuid())) membershipId: string,
    @Param('permission') permission: string,
    @Body(new ZodPipe(grantBody)) body: z.infer<typeof grantBody>,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.db.inWorkspace(ctx.workspaceId, (tx) =>
      this.permissions.grant(
        tx,
        ctx.workspaceId,
        membershipId,
        permission,
        { userId: session.userId, requestId: String(request.id) },
        body?.classIds ?? [],
      ),
    );
  }

  @Delete('memberships/:membershipId/permissions/:permission')
  @HttpCode(204)
  @WorkspaceRoles(['owner'])
  async revoke(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('membershipId', new ZodPipe(z.uuid())) membershipId: string,
    @Param('permission') permission: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.db.inWorkspace(ctx.workspaceId, (tx) =>
      this.permissions.revoke(tx, ctx.workspaceId, membershipId, permission, {
        userId: session.userId,
        requestId: String(request.id),
      }),
    );
  }
}
