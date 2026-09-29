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
import { ContentService, type CourseSummary, type LessonView } from './content.service';

const uuidParam = new ZodPipe(z.uuid());
const courseBody = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).optional(),
});
const courseChange = z
  .object({
    title: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'nothing to change' });
const lessonBody = z.object({
  title: z.string().trim().min(2).max(160),
  body: z.string().max(20000).optional(),
});
const lessonChange = z
  .object({
    title: z.string().trim().min(2).max(160).optional(),
    body: z.string().max(20000).nullable().optional(),
    position: z.number().int().min(0).max(10000).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'nothing to change' });
const listQuery = z.object({ deleted: z.enum(['true', 'false']).optional() });

function actorOf(session: SessionContext, request: FastifyRequest) {
  return { userId: session.userId, requestId: String(request.id) };
}

/** Courses and lessons (REQ-CONTENT-001, REQ-CONTENT-002). */
@Controller('v1/w/:workspaceId')
export class ContentController {
  constructor(private readonly content: ContentService) {}

  @Get('courses')
  @WorkspacePermission('content.edit')
  async list(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Query(new ZodPipe(listQuery)) query: z.infer<typeof listQuery>,
  ): Promise<{ courses: CourseSummary[] }> {
    return { courses: await this.content.listCourses(ctx, { deleted: query.deleted === 'true' }) };
  }

  @Post('courses')
  @HttpCode(201)
  @WorkspacePermission('content.edit')
  create(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Body(new ZodPipe(courseBody)) body: z.infer<typeof courseBody>,
    @Req() request: FastifyRequest,
  ): Promise<{ id: string }> {
    return this.content.createCourse(ctx, body, actorOf(session, request));
  }

  @Get('courses/:courseId')
  @WorkspacePermission('content.edit')
  course(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Param('courseId', uuidParam) courseId: string,
  ): Promise<CourseSummary & { lessons: LessonView[] }> {
    return this.content.course(ctx, courseId);
  }

  @Post('courses/:courseId')
  @HttpCode(204)
  @WorkspacePermission('content.edit')
  async update(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('courseId', uuidParam) courseId: string,
    @Body(new ZodPipe(courseChange)) body: z.infer<typeof courseChange>,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.content.updateCourse(ctx, courseId, body, actorOf(session, request));
  }

  /** Deleting content is owner-only (REQ-RBAC-002). */
  @Post('courses/:courseId/delete')
  @HttpCode(204)
  @WorkspaceRoles(['owner'])
  async deleteCourse(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('courseId', uuidParam) courseId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.content.setCourseDeleted(ctx, courseId, true, actorOf(session, request));
  }

  @Post('courses/:courseId/restore')
  @HttpCode(204)
  @WorkspaceRoles(['owner'])
  async restoreCourse(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('courseId', uuidParam) courseId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.content.setCourseDeleted(ctx, courseId, false, actorOf(session, request));
  }

  @Get('courses/:courseId/deleted-lessons')
  @WorkspaceRoles(['owner'])
  async deletedLessons(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Param('courseId', uuidParam) courseId: string,
  ): Promise<{ lessons: LessonView[] }> {
    return { lessons: await this.content.deletedLessons(ctx, courseId) };
  }

  @Post('courses/:courseId/lessons')
  @HttpCode(201)
  @WorkspacePermission('content.edit')
  createLesson(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('courseId', uuidParam) courseId: string,
    @Body(new ZodPipe(lessonBody)) body: z.infer<typeof lessonBody>,
    @Req() request: FastifyRequest,
  ): Promise<{ id: string }> {
    return this.content.createLesson(ctx, courseId, body, actorOf(session, request));
  }

  @Post('lessons/:lessonId')
  @HttpCode(204)
  @WorkspacePermission('content.edit')
  async updateLesson(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('lessonId', uuidParam) lessonId: string,
    @Body(new ZodPipe(lessonChange)) body: z.infer<typeof lessonChange>,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.content.updateLesson(ctx, lessonId, body, actorOf(session, request));
  }

  @Post('lessons/:lessonId/publish')
  @HttpCode(204)
  @WorkspacePermission('content.publish')
  async publish(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('lessonId', uuidParam) lessonId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.content.setPublished(ctx, lessonId, true, actorOf(session, request));
  }

  @Post('lessons/:lessonId/unpublish')
  @HttpCode(204)
  @WorkspacePermission('content.publish')
  async unpublish(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('lessonId', uuidParam) lessonId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.content.setPublished(ctx, lessonId, false, actorOf(session, request));
  }

  @Post('lessons/:lessonId/delete')
  @HttpCode(204)
  @WorkspaceRoles(['owner'])
  async deleteLesson(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('lessonId', uuidParam) lessonId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.content.setLessonDeleted(ctx, lessonId, true, actorOf(session, request));
  }

  @Post('lessons/:lessonId/restore')
  @HttpCode(204)
  @WorkspaceRoles(['owner'])
  async restoreLesson(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('lessonId', uuidParam) lessonId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.content.setLessonDeleted(ctx, lessonId, false, actorOf(session, request));
  }
}
