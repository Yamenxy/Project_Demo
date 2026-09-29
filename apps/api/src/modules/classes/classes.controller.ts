import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZodPipe } from '../../common/http/zod.pipe';
import {
  CurrentSession,
  WorkspacePermission,
  WorkspaceRoles,
  type SessionContext,
} from '../../common/policy';
import { CurrentWorkspace, type WorkspaceContext } from '../tenancy';
import { ClassesService, type ClassDetail, type ClassSummary } from './classes.service';

const uuidParam = new ZodPipe(z.uuid());
const name = z.string().trim().min(2).max(80);
const createBody = z.object({ name, responsibleMembershipId: z.uuid().optional() });
const updateBody = z
  .object({
    name: name.optional(),
    responsibleMembershipId: z.uuid().optional(),
    archived: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'nothing to change' });
const enrollBody = z.object({ membershipIds: z.array(z.uuid()).min(1).max(500) });
const transferBody = z.object({ toClassId: z.uuid() });
const listQuery = z.object({ archived: z.enum(['true', 'false']).optional() });

const STAFF = ['owner', 'class_teacher', 'assistant'] as const;

function actorOf(session: SessionContext, request: FastifyRequest) {
  return { userId: session.userId, requestId: String(request.id) };
}

/** Classes (REQ-CLASS-001). Class teachers see and act on only the classes they're responsible for. */
@Controller('v1/w/:workspaceId/classes')
export class ClassesController {
  constructor(private readonly classes: ClassesService) {}

  @Get()
  @WorkspaceRoles([...STAFF])
  list(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Query(new ZodPipe(listQuery)) query: z.infer<typeof listQuery>,
  ): Promise<{ classes: ClassSummary[] }> {
    return this.classes
      .list(ctx, { archived: query.archived === 'true' })
      .then((classes) => ({ classes }));
  }

  @Post()
  @HttpCode(201)
  @WorkspaceRoles(['owner'])
  create(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Body(new ZodPipe(createBody)) body: z.infer<typeof createBody>,
    @Req() request: FastifyRequest,
  ): Promise<{ id: string }> {
    return this.classes.create(ctx, body, actorOf(session, request));
  }

  @Get(':classId')
  @WorkspaceRoles([...STAFF])
  get(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Param('classId', uuidParam) classId: string,
  ): Promise<ClassDetail> {
    return this.classes.get(ctx, classId);
  }

  @Post(':classId')
  @HttpCode(204)
  @WorkspaceRoles(['owner'])
  async update(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('classId', uuidParam) classId: string,
    @Body(new ZodPipe(updateBody)) body: z.infer<typeof updateBody>,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.classes.update(ctx, classId, body, actorOf(session, request));
  }

  @Post(':classId/students')
  @HttpCode(200)
  @WorkspacePermission('enrollment.manage')
  enroll(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('classId', uuidParam) classId: string,
    @Body(new ZodPipe(enrollBody)) body: z.infer<typeof enrollBody>,
    @Req() request: FastifyRequest,
  ): Promise<{ added: number }> {
    return this.classes.enroll(ctx, classId, body.membershipIds, actorOf(session, request));
  }

  @Post(':classId/students/:membershipId/remove')
  @HttpCode(204)
  @WorkspacePermission('enrollment.manage')
  async remove(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('classId', uuidParam) classId: string,
    @Param('membershipId', uuidParam) membershipId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.classes.remove(ctx, classId, membershipId, actorOf(session, request));
  }

  @Post(':classId/students/:membershipId/transfer')
  @HttpCode(204)
  @WorkspacePermission('enrollment.manage')
  async transfer(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('classId', uuidParam) classId: string,
    @Param('membershipId', uuidParam) membershipId: string,
    @Body(new ZodPipe(transferBody)) body: z.infer<typeof transferBody>,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.classes.transfer(
      ctx,
      classId,
      membershipId,
      body.toClassId,
      actorOf(session, request),
    );
  }
}
