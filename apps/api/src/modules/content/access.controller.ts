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
import { AccessService, type GroupView, type StudentLesson } from './access.service';

const uuidParam = new ZodPipe(z.uuid());
const ids = z.array(z.uuid()).max(500);
const nameBody = z.object({ name: z.string().trim().min(2).max(80) });
const groupChange = z
  .object({ name: z.string().trim().min(2).max(80).optional(), archived: z.boolean().optional() })
  .refine((b) => Object.keys(b).length > 0, { message: 'nothing to change' });
const addRemove = z
  .object({ add: ids.default([]), remove: ids.default([]) })
  .refine((b) => b.add.length + b.remove.length > 0, { message: 'nothing to change' });
const classBody = z.object({ classId: z.uuid() });
const rulesBody = z.object({
  membershipIds: ids.min(1),
  lessonIds: ids.min(1),
  rule: z.enum(['grant', 'block', 'none']),
});
const pauseBody = z.object({
  membershipIds: ids.min(1),
  paused: z.boolean(),
  reason: z.string().trim().max(300).optional(),
});
const removeAllBody = z.object({ confirmation: z.string().min(1).max(160) });
const searchQuery = z.object({ q: z.string().trim().max(80).default('') });
const archivedQuery = z.object({ archived: z.enum(['true', 'false']).optional() });

function actorOf(session: SessionContext, request: FastifyRequest) {
  return { userId: session.userId, requestId: String(request.id) };
}

/** Access groups, individual rules, pause, and the student's lessons (OD-02). */
@Controller('v1/w/:workspaceId')
export class AccessController {
  constructor(private readonly access: AccessService) {}

  @Get('my/lessons')
  @WorkspaceRoles(['student'])
  myLessons(
    @CurrentWorkspace() ctx: WorkspaceContext,
  ): Promise<{ lessons: StudentLesson[]; paused: boolean }> {
    return this.access.myLessons(ctx);
  }

  /** Students through `AccessPolicy`; staff preview with `content.edit`. */
  @Get('lessons/:lessonId')
  @WorkspaceRoles(['owner', 'class_teacher', 'assistant', 'student'])
  lesson(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Param('lessonId', uuidParam) lessonId: string,
  ) {
    return this.access.lesson(ctx, lessonId);
  }

  @Get('access-groups/students')
  @WorkspacePermission('access.groups')
  async searchStudents(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Query(new ZodPipe(searchQuery)) query: z.infer<typeof searchQuery>,
  ) {
    return { students: await this.access.searchStudents(ctx.workspaceId, query.q) };
  }

  @Get('access-groups')
  @WorkspacePermission('access.groups')
  async groups(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Query(new ZodPipe(archivedQuery)) query: z.infer<typeof archivedQuery>,
  ): Promise<{ groups: GroupView[] }> {
    return { groups: await this.access.groups(ctx.workspaceId, query.archived === 'true') };
  }

  @Post('access-groups')
  @HttpCode(201)
  @WorkspacePermission('access.groups')
  createGroup(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Body(new ZodPipe(nameBody)) body: z.infer<typeof nameBody>,
    @Req() request: FastifyRequest,
  ): Promise<{ id: string }> {
    return this.access.createGroup(ctx.workspaceId, body.name, actorOf(session, request));
  }

  @Post('access-groups/:groupId')
  @HttpCode(204)
  @WorkspacePermission('access.groups')
  async updateGroup(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('groupId', uuidParam) groupId: string,
    @Body(new ZodPipe(groupChange)) body: z.infer<typeof groupChange>,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.access.updateGroup(ctx.workspaceId, groupId, body, actorOf(session, request));
  }

  @Post('access-groups/:groupId/lessons')
  @HttpCode(204)
  @WorkspacePermission('access.groups')
  async groupLessons(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('groupId', uuidParam) groupId: string,
    @Body(new ZodPipe(addRemove)) body: z.infer<typeof addRemove>,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.access.groupLessons(ctx.workspaceId, groupId, body, actorOf(session, request));
  }

  @Post('access-groups/:groupId/members')
  @HttpCode(204)
  @WorkspacePermission('access.groups')
  async groupMembers(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('groupId', uuidParam) groupId: string,
    @Body(new ZodPipe(addRemove)) body: z.infer<typeof addRemove>,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.access.groupMembers(ctx.workspaceId, groupId, body, actorOf(session, request));
  }

  @Post('access-groups/:groupId/add-class')
  @HttpCode(200)
  @WorkspacePermission('access.groups')
  addClass(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('groupId', uuidParam) groupId: string,
    @Body(new ZodPipe(classBody)) body: z.infer<typeof classBody>,
    @Req() request: FastifyRequest,
  ): Promise<{ added: number }> {
    return this.access.addClass(ctx.workspaceId, groupId, body.classId, actorOf(session, request));
  }

  @Post('access/rules')
  @HttpCode(200)
  @WorkspacePermission('access.grants')
  setRules(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Body(new ZodPipe(rulesBody)) body: z.infer<typeof rulesBody>,
    @Req() request: FastifyRequest,
  ): Promise<{ changed: number }> {
    return this.access.setRules(ctx, body, actorOf(session, request));
  }

  @Post('access/pause')
  @HttpCode(200)
  @WorkspacePermission('access.pause')
  setPaused(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Body(new ZodPipe(pauseBody)) body: z.infer<typeof pauseBody>,
    @Req() request: FastifyRequest,
  ): Promise<{ changed: number }> {
    return this.access.setPaused(ctx, body, actorOf(session, request));
  }

  @Get('access/students/:membershipId')
  @WorkspacePermission('access.grants')
  studentAccess(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Param('membershipId', uuidParam) membershipId: string,
  ) {
    return this.access.studentAccess(ctx, membershipId);
  }

  @Post('access/students/:membershipId/remove-all')
  @HttpCode(200)
  @WorkspaceRoles(['owner'])
  removeAll(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('membershipId', uuidParam) membershipId: string,
    @Body(new ZodPipe(removeAllBody)) body: z.infer<typeof removeAllBody>,
    @Req() request: FastifyRequest,
  ): Promise<{ groups: number; grants: number }> {
    return this.access.removeAll(
      ctx.workspaceId,
      membershipId,
      body.confirmation,
      actorOf(session, request),
    );
  }
}
