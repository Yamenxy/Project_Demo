import { Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { AppError, Clock, IdGenerator, notFound } from '../../common';
import type { PermissionKey } from '../../common/policy';
import { TenantDb, type DbTx } from '../../database';
import { AuditService } from '../audit';
import type { WorkspaceContext } from '../tenancy';
import { courses, lessons } from './schema';

export interface Actor {
  userId: string;
  requestId?: string;
}

/** Deleted content can be restored for this long (REQ-CONTENT-002). */
export const RESTORE_WINDOW_MS = 30 * 24 * 3600 * 1000;

export interface CourseSummary {
  id: string;
  title: string;
  description: string | null;
  lessonCount: number;
  deleted: boolean;
}

export interface LessonView {
  id: string;
  courseId: string;
  title: string;
  body: string | null;
  position: number;
  published: boolean;
  deleted: boolean;
}

/**
 * Courses a staff member may act on for a key: all of them for a workspace-wide grant, otherwise
 * the courses linked to classes in scope (Appendix A.2: "courses linked to scoped classes").
 */
export function courseScope(ctx: WorkspaceContext, key: PermissionKey): SQL | undefined {
  const scope = ctx.permissions.scopeOf(key);
  if (scope === 'all') return undefined;
  const ids = [...scope];
  if (ids.length === 0) return sql`false`;
  return sql`${courses.id} in (select c.course_id from classes c
    where c.id in ${ids} and c.course_id is not null)`;
}

/** Courses and lessons, edited by staff (REQ-CONTENT-001, REQ-CONTENT-002). */
@Injectable()
export class ContentService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async listCourses(
    ctx: WorkspaceContext,
    options: { deleted: boolean },
  ): Promise<CourseSummary[]> {
    const rows = await this.db.inWorkspace(ctx.workspaceId, (tx) =>
      tx
        .select({
          course: courses,
          lessonCount: sql<number>`(select count(*)::int from ${lessons}
            where ${lessons.courseId} = ${courses.id} and ${lessons.deletedAt} is null)`,
        })
        .from(courses)
        .where(
          and(
            options.deleted ? this.restorable() : isNull(courses.deletedAt),
            courseScope(ctx, 'content.edit'),
          ),
        )
        .orderBy(asc(courses.title)),
    );
    return rows.map(({ course, lessonCount }) => ({
      id: course.id,
      title: course.title,
      description: course.description,
      lessonCount,
      deleted: course.deletedAt !== null,
    }));
  }

  /** A course with all its lessons, drafts included (staff preview, REQ-CONTENT-001). */
  async course(
    ctx: WorkspaceContext,
    courseId: string,
  ): Promise<CourseSummary & { lessons: LessonView[] }> {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      const course = await this.findCourse(tx, ctx, courseId, 'content.edit', true);
      const rows = await tx
        .select()
        .from(lessons)
        .where(and(eq(lessons.courseId, courseId), isNull(lessons.deletedAt)))
        .orderBy(asc(lessons.position), asc(lessons.createdAt));
      return {
        id: course.id,
        title: course.title,
        description: course.description,
        lessonCount: rows.length,
        deleted: course.deletedAt !== null,
        lessons: rows.map(toLessonView),
      };
    });
  }

  async createCourse(
    ctx: WorkspaceContext,
    input: { title: string; description?: string },
    actor: Actor,
  ): Promise<{ id: string }> {
    if (!ctx.permissions.hasEverywhere('content.edit')) {
      throw new AppError(403, 'forbidden', 'Not allowed');
    }
    const id = this.ids.newId();
    const now = this.clock.now();
    await this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      await tx.insert(courses).values({
        workspaceId: ctx.workspaceId,
        id,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        createdAt: now,
        updatedAt: now,
      });
      await this.record(tx, ctx, actor, 'course.created', 'course', id, { title: input.title });
    });
    return { id };
  }

  async updateCourse(
    ctx: WorkspaceContext,
    courseId: string,
    change: { title?: string; description?: string | null },
    actor: Actor,
  ): Promise<void> {
    await this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      await this.findCourse(tx, ctx, courseId, 'content.edit');
      await tx
        .update(courses)
        .set({
          ...(change.title === undefined ? {} : { title: change.title.trim() }),
          ...(change.description === undefined
            ? {}
            : { description: change.description?.trim() || null }),
          updatedAt: this.clock.now(),
        })
        .where(eq(courses.id, courseId));
      await this.record(tx, ctx, actor, 'course.updated', 'course', courseId, change);
    });
  }

  /** Owner only: soft delete, restorable for 30 days (REQ-CONTENT-002). */
  async setCourseDeleted(
    ctx: WorkspaceContext,
    courseId: string,
    deleted: boolean,
    actor: Actor,
  ): Promise<void> {
    await this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      const course = await this.findCourse(tx, ctx, courseId, 'content.edit', true);
      if (!deleted && !this.canRestore(course.deletedAt)) {
        throw new AppError(409, 'restore_window_over', 'More than 30 days have passed');
      }
      await tx
        .update(courses)
        .set({ deletedAt: deleted ? this.clock.now() : null, updatedAt: this.clock.now() })
        .where(eq(courses.id, courseId));
      await this.record(
        tx,
        ctx,
        actor,
        deleted ? 'course.deleted' : 'course.restored',
        'course',
        courseId,
        {},
      );
    });
  }

  async createLesson(
    ctx: WorkspaceContext,
    courseId: string,
    input: { title: string; body?: string },
    actor: Actor,
  ): Promise<{ id: string }> {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      await this.findCourse(tx, ctx, courseId, 'content.edit');
      const [last] = await tx
        .select({ max: sql<number | null>`max(${lessons.position})` })
        .from(lessons)
        .where(eq(lessons.courseId, courseId));
      const id = this.ids.newId();
      const now = this.clock.now();
      await tx.insert(lessons).values({
        workspaceId: ctx.workspaceId,
        id,
        courseId,
        title: input.title.trim(),
        body: input.body?.trim() || null,
        position: (last?.max ?? -1) + 1,
        createdAt: now,
        updatedAt: now,
      });
      await this.record(tx, ctx, actor, 'lesson.created', 'lesson', id, {
        courseId,
        title: input.title,
      });
      return { id };
    });
  }

  async updateLesson(
    ctx: WorkspaceContext,
    lessonId: string,
    change: { title?: string; body?: string | null; position?: number },
    actor: Actor,
  ): Promise<void> {
    await this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      await this.findLesson(tx, ctx, lessonId, 'content.edit');
      await tx
        .update(lessons)
        .set({
          ...(change.title === undefined ? {} : { title: change.title.trim() }),
          ...(change.body === undefined ? {} : { body: change.body?.trim() || null }),
          ...(change.position === undefined ? {} : { position: change.position }),
          updatedAt: this.clock.now(),
        })
        .where(eq(lessons.id, lessonId));
      await this.record(tx, ctx, actor, 'lesson.updated', 'lesson', lessonId, {
        ...(change.title === undefined ? {} : { title: change.title }),
        ...(change.position === undefined ? {} : { position: change.position }),
        bodyChanged: change.body !== undefined,
      });
    });
  }

  async setPublished(
    ctx: WorkspaceContext,
    lessonId: string,
    published: boolean,
    actor: Actor,
  ): Promise<void> {
    await this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      await this.findLesson(tx, ctx, lessonId, 'content.publish');
      await tx
        .update(lessons)
        .set({ publishedAt: published ? this.clock.now() : null, updatedAt: this.clock.now() })
        .where(eq(lessons.id, lessonId));
      await this.record(
        tx,
        ctx,
        actor,
        published ? 'lesson.published' : 'lesson.unpublished',
        'lesson',
        lessonId,
        {},
      );
    });
  }

  /** Owner only: soft delete, restorable for 30 days (REQ-CONTENT-002). */
  async setLessonDeleted(
    ctx: WorkspaceContext,
    lessonId: string,
    deleted: boolean,
    actor: Actor,
  ): Promise<void> {
    await this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      const lesson = await this.findLesson(tx, ctx, lessonId, 'content.edit', true);
      if (!deleted && !this.canRestore(lesson.deletedAt)) {
        throw new AppError(409, 'restore_window_over', 'More than 30 days have passed');
      }
      await tx
        .update(lessons)
        .set({ deletedAt: deleted ? this.clock.now() : null, updatedAt: this.clock.now() })
        .where(eq(lessons.id, lessonId));
      await this.record(
        tx,
        ctx,
        actor,
        deleted ? 'lesson.deleted' : 'lesson.restored',
        'lesson',
        lessonId,
        {},
      );
    });
  }

  /** Deleted lessons of a course that can still be restored. */
  async deletedLessons(ctx: WorkspaceContext, courseId: string): Promise<LessonView[]> {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      await this.findCourse(tx, ctx, courseId, 'content.edit', true);
      const rows = await tx
        .select()
        .from(lessons)
        .where(
          and(
            eq(lessons.courseId, courseId),
            sql`${lessons.deletedAt} > ${new Date(this.clock.now().getTime() - RESTORE_WINDOW_MS)}`,
          ),
        )
        .orderBy(asc(lessons.position));
      return rows.map(toLessonView);
    });
  }

  private canRestore(deletedAt: Date | null): boolean {
    return (
      deletedAt === null || this.clock.now().getTime() - deletedAt.getTime() <= RESTORE_WINDOW_MS
    );
  }

  private restorable(): SQL {
    return sql`${courses.deletedAt} > ${new Date(this.clock.now().getTime() - RESTORE_WINDOW_MS)}`;
  }

  private async findCourse(
    tx: DbTx,
    ctx: WorkspaceContext,
    courseId: string,
    key: PermissionKey,
    includeDeleted = false,
  ) {
    const [course] = await tx
      .select()
      .from(courses)
      .where(
        and(
          eq(courses.id, courseId),
          includeDeleted ? undefined : isNull(courses.deletedAt),
          courseScope(ctx, key),
        ),
      );
    if (!course) throw notFound('Course not found');
    return course;
  }

  private async findLesson(
    tx: DbTx,
    ctx: WorkspaceContext,
    lessonId: string,
    key: PermissionKey,
    includeDeleted = false,
  ) {
    const [row] = await tx
      .select({ lesson: lessons })
      .from(lessons)
      .innerJoin(courses, eq(courses.id, lessons.courseId))
      .where(
        and(
          eq(lessons.id, lessonId),
          includeDeleted ? undefined : isNull(lessons.deletedAt),
          isNull(courses.deletedAt),
          courseScope(ctx, key),
        ),
      );
    if (!row) throw notFound('Lesson not found');
    return row.lesson;
  }

  private record(
    tx: DbTx,
    ctx: WorkspaceContext,
    actor: Actor,
    action: string,
    type: string,
    id: string,
    newValue: Record<string, unknown>,
  ) {
    return this.audit.record(tx, {
      action,
      workspaceId: ctx.workspaceId,
      actor: { type: 'user', userId: actor.userId },
      entity: { type, id },
      newValue,
      requestId: actor.requestId,
    });
  }
}

function toLessonView(row: typeof lessons.$inferSelect): LessonView {
  return {
    id: row.id,
    courseId: row.courseId,
    title: row.title,
    body: row.body,
    position: row.position,
    published: row.publishedAt !== null,
    deleted: row.deletedAt !== null,
  };
}
