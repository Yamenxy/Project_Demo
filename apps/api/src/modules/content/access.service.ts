import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { AppError, Clock, IdGenerator, notFound } from '../../common';
import { TenantDb, type DbTx } from '../../database';
import { AuditService } from '../audit';
import { users } from '../identity';
import { memberships, studentScope, type WorkspaceContext } from '../tenancy';
import { decideAccess, type AccessDecision } from './access-policy';
import { courseScope, type Actor } from './content.service';
import {
  accessGroupLessons,
  accessGroupMembers,
  accessGroups,
  courses,
  lessonRules,
  lessons,
} from './schema';

export interface StudentLesson {
  lessonId: string;
  courseId: string;
  courseTitle: string;
  title: string;
  position: number;
  decision: AccessDecision;
}

export interface GroupView {
  id: string;
  name: string;
  archived: boolean;
  lessonIds: string[];
  members: { membershipId: string; name: string }[];
}

/**
 * Access to lessons (OD-02, REQ-CONTENT-001, REQ-CONTENT-005 to -010). Every lesson read goes
 * through `decideAccess`, with facts read fresh in the same request; nothing is cached.
 */
@Injectable()
export class AccessService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  /** Every published lesson of the workspace, with the decision for one student. */
  async lessonsFor(tx: DbTx, workspaceId: string, membershipId: string): Promise<StudentLesson[]> {
    const rows = await tx.execute<{
      lesson_id: string;
      course_id: string;
      course_title: string;
      title: string;
      position: number;
      published: boolean;
      active_student: boolean;
      suspended: boolean;
      paused: boolean;
      rule: 'grant' | 'block' | null;
      groups: string[] | null;
    }>(sql`
      select l.id as lesson_id, c.id as course_id, c.title as course_title, l.title, l.position,
             (l.published_at is not null) as published,
             (m.role = 'student' and m.status = 'active') as active_student,
             (w.suspended_at is not null) as suspended,
             (m.paused_at is not null) as paused,
             r.kind as rule,
             (select array_agg(g.name order by g.name)
                from access_groups g
                join access_group_lessons gl on gl.group_id = g.id and gl.lesson_id = l.id
                join access_group_members gm on gm.group_id = g.id and gm.membership_id = m.id
               where g.archived_at is null) as groups
        from lessons l
        join courses c on c.id = l.course_id and c.deleted_at is null
        join memberships m on m.id = ${membershipId}
        join workspaces w on w.id = ${workspaceId}
        left join lesson_rules r on r.lesson_id = l.id and r.membership_id = m.id
       where l.deleted_at is null
       order by c.title, l.position`);
    return rows.rows.map((r) => ({
      lessonId: r.lesson_id,
      courseId: r.course_id,
      courseTitle: r.course_title,
      title: r.title,
      position: r.position,
      decision: decideAccess({
        activeStudent: r.active_student,
        published: r.published,
        workspaceSuspended: r.suspended,
        paused: r.paused,
        rule: r.rule,
        groups: r.groups ?? [],
      }),
    }));
  }

  /** The student's own lessons: what they can open (published lessons only are listed). */
  async myLessons(ctx: WorkspaceContext): Promise<{ lessons: StudentLesson[]; paused: boolean }> {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      const all = await this.lessonsFor(tx, ctx.workspaceId, ctx.membershipId);
      return {
        lessons: all.filter((l) => l.decision.allowed),
        paused: ctx.paused,
      };
    });
  }

  /**
   * One lesson. A student gets it only through the policy; staff with `content.edit` for the
   * course may preview it, drafts included (REQ-CONTENT-001).
   */
  async lesson(
    ctx: WorkspaceContext,
    lessonId: string,
  ): Promise<{
    id: string;
    courseTitle: string;
    title: string;
    body: string | null;
    preview: boolean;
  }> {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      if (ctx.role !== 'student') {
        const [row] = await tx
          .select({ lesson: lessons, courseTitle: courses.title })
          .from(lessons)
          .innerJoin(courses, eq(courses.id, lessons.courseId))
          .where(
            and(
              eq(lessons.id, lessonId),
              isNull(lessons.deletedAt),
              isNull(courses.deletedAt),
              courseScope(ctx, 'content.edit'),
            ),
          );
        if (!row) throw notFound('Lesson not found');
        return { ...pick(row.lesson), courseTitle: row.courseTitle, preview: true };
      }
      const decision = (await this.lessonsFor(tx, ctx.workspaceId, ctx.membershipId)).find(
        (l) => l.lessonId === lessonId,
      )?.decision;
      if (!decision) throw notFound('Lesson not found');
      if (!decision.allowed) {
        throw new AppError(403, 'no_access', 'You cannot open this lesson', {
          reason: decision.reason,
        });
      }
      const [row] = await tx
        .select({ lesson: lessons, courseTitle: courses.title })
        .from(lessons)
        .innerJoin(courses, eq(courses.id, lessons.courseId))
        .where(eq(lessons.id, lessonId));
      if (!row) throw notFound('Lesson not found');
      return { ...pick(row.lesson), courseTitle: row.courseTitle, preview: false };
    });
  }

  /** Students to add to a group: names and codes only (access.groups is workspace-wide). */
  async searchStudents(
    workspaceId: string,
    query: string,
  ): Promise<{ membershipId: string; name: string; platformCode: string | null }[]> {
    const like = `%${query.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    return this.db.inWorkspace(workspaceId, (tx) =>
      tx
        .select({
          membershipId: memberships.id,
          name: sql<string>`coalesce(${users.nameAr}, ${memberships.provisionalName})`,
          platformCode: users.platformCode,
        })
        .from(memberships)
        .leftJoin(users, eq(users.id, memberships.userId))
        .where(
          and(
            eq(memberships.role, 'student'),
            sql`${memberships.status} in ('active', 'suspended')`,
            sql`(${users.nameAr} ilike ${like} or ${memberships.provisionalName} ilike ${like}
                 or ${users.platformCode} ilike ${like} or ${memberships.internalCode} ilike ${like})`,
          ),
        )
        .orderBy(sql`2`)
        .limit(20),
    );
  }

  // --- groups (access.groups: workspace-wide) --------------------------------------------------

  async groups(workspaceId: string, archived: boolean): Promise<GroupView[]> {
    return this.db.inWorkspace(workspaceId, async (tx) => {
      const groups = await tx
        .select()
        .from(accessGroups)
        .where(
          archived ? sql`${accessGroups.archivedAt} is not null` : isNull(accessGroups.archivedAt),
        )
        .orderBy(asc(accessGroups.name));
      if (groups.length === 0) return [];
      const ids = groups.map((g) => g.id);
      const lessonRows = await tx
        .select()
        .from(accessGroupLessons)
        .where(inArray(accessGroupLessons.groupId, ids));
      const memberRows = await tx
        .select({
          groupId: accessGroupMembers.groupId,
          membershipId: accessGroupMembers.membershipId,
          name: sql<string>`coalesce(${users.nameAr}, ${memberships.provisionalName})`,
        })
        .from(accessGroupMembers)
        .innerJoin(memberships, eq(memberships.id, accessGroupMembers.membershipId))
        .leftJoin(users, eq(users.id, memberships.userId))
        .where(inArray(accessGroupMembers.groupId, ids));
      return groups.map((g) => ({
        id: g.id,
        name: g.name,
        archived: g.archivedAt !== null,
        lessonIds: lessonRows.filter((l) => l.groupId === g.id).map((l) => l.lessonId),
        members: memberRows
          .filter((m) => m.groupId === g.id)
          .map(({ membershipId, name }) => ({ membershipId, name })),
      }));
    });
  }

  async createGroup(workspaceId: string, name: string, actor: Actor): Promise<{ id: string }> {
    const id = this.ids.newId();
    const now = this.clock.now();
    await this.db.inWorkspace(workspaceId, async (tx) => {
      await tx
        .insert(accessGroups)
        .values({ workspaceId, id, name: name.trim(), createdAt: now, updatedAt: now });
      await this.record(tx, workspaceId, actor, 'access.group_created', 'access_group', id, {
        name,
      });
    });
    return { id };
  }

  /** Rename, or archive (its effect on access ends; its history stays) and restore. */
  async updateGroup(
    workspaceId: string,
    groupId: string,
    change: { name?: string; archived?: boolean },
    actor: Actor,
  ): Promise<void> {
    await this.db.inWorkspace(workspaceId, async (tx) => {
      const now = this.clock.now();
      const updated = await tx
        .update(accessGroups)
        .set({
          ...(change.name === undefined ? {} : { name: change.name.trim() }),
          ...(change.archived === undefined ? {} : { archivedAt: change.archived ? now : null }),
          updatedAt: now,
        })
        .where(eq(accessGroups.id, groupId))
        .returning({ id: accessGroups.id });
      if (updated.length === 0) throw notFound('Group not found');
      await this.record(
        tx,
        workspaceId,
        actor,
        'access.group_updated',
        'access_group',
        groupId,
        change,
      );
    });
  }

  /** Adds and removes lessons in one transaction (REQ-CONTENT-010). Idempotent. */
  async groupLessons(
    workspaceId: string,
    groupId: string,
    change: { add: string[]; remove: string[] },
    actor: Actor,
  ): Promise<void> {
    await this.db.inWorkspace(workspaceId, async (tx) => {
      await this.findGroup(tx, groupId);
      await this.existing(tx, 'lessons', change.add);
      if (change.add.length > 0) {
        await tx
          .insert(accessGroupLessons)
          .values(change.add.map((lessonId) => ({ workspaceId, groupId, lessonId })))
          .onConflictDoNothing();
      }
      if (change.remove.length > 0) {
        await tx
          .delete(accessGroupLessons)
          .where(
            and(
              eq(accessGroupLessons.groupId, groupId),
              inArray(accessGroupLessons.lessonId, change.remove),
            ),
          );
      }
      await this.record(
        tx,
        workspaceId,
        actor,
        'access.group_lessons_changed',
        'access_group',
        groupId,
        change,
      );
    });
  }

  /** Adds and removes students in one transaction (REQ-CONTENT-010). Idempotent. */
  async groupMembers(
    workspaceId: string,
    groupId: string,
    change: { add: string[]; remove: string[] },
    actor: Actor,
  ): Promise<void> {
    await this.db.inWorkspace(workspaceId, async (tx) => {
      await this.findGroup(tx, groupId);
      await this.students(tx, change.add);
      await this.addMembers(tx, workspaceId, groupId, change.add, actor);
      if (change.remove.length > 0) {
        await tx
          .delete(accessGroupMembers)
          .where(
            and(
              eq(accessGroupMembers.groupId, groupId),
              inArray(accessGroupMembers.membershipId, change.remove),
            ),
          );
      }
      await this.record(
        tx,
        workspaceId,
        actor,
        'access.group_members_changed',
        'access_group',
        groupId,
        change,
      );
    });
  }

  /** "Add all students from class X": the class's current students, once; not a live link. */
  async addClass(
    workspaceId: string,
    groupId: string,
    classId: string,
    actor: Actor,
  ): Promise<{ added: number }> {
    return this.db.inWorkspace(workspaceId, async (tx) => {
      await this.findGroup(tx, groupId);
      const rows = await tx.execute<{ membership_id: string }>(sql`
        select e.membership_id from class_enrollments e
          join classes c on c.id = e.class_id
          join memberships m on m.id = e.membership_id
         where e.class_id = ${classId} and e.ended_at is null
           and m.status in ('active', 'suspended')`);
      const [cls] = (
        await tx.execute<{ id: string }>(sql`select id from classes where id = ${classId}`)
      ).rows;
      if (!cls) throw notFound('Class not found');
      const ids = rows.rows.map((r) => r.membership_id);
      const added = await this.addMembers(tx, workspaceId, groupId, ids, actor);
      await this.record(
        tx,
        workspaceId,
        actor,
        'access.group_class_added',
        'access_group',
        groupId,
        {
          classId,
          added,
        },
      );
      return { added };
    });
  }

  // --- individual rules and pause (scoped) ---------------------------------------------------

  /**
   * Grant, block or clear for many students and lessons in one transaction (REQ-CONTENT-005,
   * -010). One rule per (student, lesson): setting one replaces the other.
   */
  async setRules(
    ctx: WorkspaceContext,
    input: { membershipIds: string[]; lessonIds: string[]; rule: 'grant' | 'block' | 'none' },
    actor: Actor,
  ): Promise<{ changed: number }> {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      await this.scopedStudents(tx, ctx, input.membershipIds, 'access.grants');
      await this.scopedLessons(tx, ctx, input.lessonIds);
      const now = this.clock.now();
      let changed = 0;
      for (const membershipId of new Set(input.membershipIds)) {
        for (const lessonId of new Set(input.lessonIds)) {
          if (input.rule === 'none') {
            const removed = await tx
              .delete(lessonRules)
              .where(
                and(eq(lessonRules.membershipId, membershipId), eq(lessonRules.lessonId, lessonId)),
              )
              .returning({ id: lessonRules.lessonId });
            changed += removed.length;
          } else {
            const written = await tx
              .insert(lessonRules)
              .values({
                workspaceId: ctx.workspaceId,
                membershipId,
                lessonId,
                kind: input.rule,
                setBy: actor.userId,
                setAt: now,
              })
              .onConflictDoUpdate({
                target: [lessonRules.membershipId, lessonRules.lessonId],
                set: { kind: input.rule, setBy: actor.userId, setAt: now },
                setWhere: sql`${lessonRules.kind} <> ${input.rule}`,
              })
              .returning({ id: lessonRules.lessonId });
            changed += written.length;
          }
        }
      }
      await this.audit.record(tx, {
        action: `access.rules_${input.rule === 'none' ? 'cleared' : input.rule === 'grant' ? 'granted' : 'blocked'}`,
        workspaceId: ctx.workspaceId,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'workspace', id: ctx.workspaceId },
        newValue: { membershipIds: input.membershipIds, lessonIds: input.lessonIds, changed },
        requestId: actor.requestId,
      });
      return { changed };
    });
  }

  /** Pause or resume all access for many students (REQ-CONTENT-008). Groups stay as they are. */
  async setPaused(
    ctx: WorkspaceContext,
    input: { membershipIds: string[]; paused: boolean; reason?: string },
    actor: Actor,
  ): Promise<{ changed: number }> {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      await this.scopedStudents(tx, ctx, input.membershipIds, 'access.pause');
      const now = this.clock.now();
      const updated = await tx
        .update(memberships)
        .set(
          input.paused
            ? {
                pausedAt: now,
                pausedBy: actor.userId,
                pauseReason: input.reason?.trim() || null,
                updatedAt: now,
              }
            : { pausedAt: null, pausedBy: null, pauseReason: null, updatedAt: now },
        )
        .where(
          and(
            inArray(memberships.id, input.membershipIds),
            input.paused ? isNull(memberships.pausedAt) : sql`${memberships.pausedAt} is not null`,
          ),
        )
        .returning({ id: memberships.id });
      await this.audit.record(tx, {
        action: input.paused ? 'access.paused' : 'access.resumed',
        workspaceId: ctx.workspaceId,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'workspace', id: ctx.workspaceId },
        newValue: { membershipIds: updated.map((u) => u.id) },
        ...(input.reason ? { reason: input.reason } : {}),
        requestId: actor.requestId,
      });
      return { changed: updated.length };
    });
  }

  /**
   * Owner only (REQ-CONTENT-009): removes every group membership and grant of a student; blocks,
   * enrolments and the pause stay. The owner types the student's name to confirm.
   */
  async removeAll(
    workspaceId: string,
    membershipId: string,
    confirmation: string,
    actor: Actor,
  ): Promise<{ groups: number; grants: number }> {
    return this.db.inWorkspace(workspaceId, async (tx) => {
      const [student] = await tx
        .select({ name: sql<string>`coalesce(${users.nameAr}, ${memberships.provisionalName})` })
        .from(memberships)
        .leftJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.id, membershipId), eq(memberships.role, 'student')));
      if (!student) throw notFound('Student not found');
      if (confirmation.trim() !== student.name.trim()) {
        throw new AppError(400, 'confirmation_mismatch', 'Type the student name to confirm');
      }
      const groups = await tx
        .delete(accessGroupMembers)
        .where(eq(accessGroupMembers.membershipId, membershipId))
        .returning({ id: accessGroupMembers.groupId });
      const grants = await tx
        .delete(lessonRules)
        .where(and(eq(lessonRules.membershipId, membershipId), eq(lessonRules.kind, 'grant')))
        .returning({ id: lessonRules.lessonId });
      await this.record(tx, workspaceId, actor, 'access.removed_all', 'membership', membershipId, {
        groupIds: groups.map((g) => g.id),
        lessonIds: grants.map((g) => g.id),
      });
      return { groups: groups.length, grants: grants.length };
    });
  }

  /** The Students tab (OD-03): groups, rules, pause, and every lesson with why it's open. */
  async studentAccess(ctx: WorkspaceContext, membershipId: string) {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      await this.scopedStudents(tx, ctx, [membershipId], 'access.grants', true);
      const [member] = await tx
        .select({ pausedAt: memberships.pausedAt, pauseReason: memberships.pauseReason })
        .from(memberships)
        .where(eq(memberships.id, membershipId));
      const groups = await tx
        .select({ id: accessGroups.id, name: accessGroups.name })
        .from(accessGroupMembers)
        .innerJoin(accessGroups, eq(accessGroups.id, accessGroupMembers.groupId))
        .where(
          and(eq(accessGroupMembers.membershipId, membershipId), isNull(accessGroups.archivedAt)),
        );
      const rules = await tx
        .select({ lessonId: lessonRules.lessonId, kind: lessonRules.kind })
        .from(lessonRules)
        .where(eq(lessonRules.membershipId, membershipId));
      return {
        paused: member?.pausedAt !== null && member?.pausedAt !== undefined,
        pauseReason: member?.pauseReason ?? null,
        groups,
        rules,
        lessons: await this.lessonsFor(tx, ctx.workspaceId, membershipId),
      };
    });
  }

  private async addMembers(
    tx: DbTx,
    workspaceId: string,
    groupId: string,
    membershipIds: string[],
    actor: Actor,
  ): Promise<number> {
    if (membershipIds.length === 0) return 0;
    const now = this.clock.now();
    const inserted = await tx
      .insert(accessGroupMembers)
      .values(
        [...new Set(membershipIds)].map((membershipId) => ({
          workspaceId,
          groupId,
          membershipId,
          addedBy: actor.userId,
          addedAt: now,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: accessGroupMembers.membershipId });
    return inserted.length;
  }

  private async findGroup(tx: DbTx, groupId: string): Promise<void> {
    const [group] = await tx
      .select({ id: accessGroups.id })
      .from(accessGroups)
      .where(eq(accessGroups.id, groupId));
    if (!group) throw notFound('Group not found');
  }

  private async existing(tx: DbTx, table: 'lessons', ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const unique = [...new Set(ids)];
    const rows = await tx
      .select({ id: lessons.id })
      .from(lessons)
      .where(and(inArray(lessons.id, unique), isNull(lessons.deletedAt)));
    if (rows.length !== unique.length) throw notFound(`Unknown ${table}`);
  }

  private async students(tx: DbTx, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const unique = [...new Set(ids)];
    const rows = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(inArray(memberships.id, unique), eq(memberships.role, 'student')));
    if (rows.length !== unique.length) throw notFound('Student not found');
  }

  /** All the students must be in the caller's scope for the key; otherwise 404. */
  private async scopedStudents(
    tx: DbTx,
    ctx: WorkspaceContext,
    ids: string[],
    key: 'access.grants' | 'access.pause',
    viewOnly = false,
  ): Promise<void> {
    const unique = [...new Set(ids)];
    const view = viewOnly && ctx.role === 'owner' ? undefined : studentScope(ctx, key);
    const rows = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(inArray(memberships.id, unique), eq(memberships.role, 'student'), view));
    if (rows.length !== unique.length) throw notFound('Student not found');
  }

  /** The lessons must be in courses the caller's `access.grants` covers. */
  private async scopedLessons(tx: DbTx, ctx: WorkspaceContext, ids: string[]): Promise<void> {
    const unique = [...new Set(ids)];
    const rows = await tx
      .select({ id: lessons.id })
      .from(lessons)
      .innerJoin(courses, eq(courses.id, lessons.courseId))
      .where(
        and(
          inArray(lessons.id, unique),
          isNull(lessons.deletedAt),
          courseScope(ctx, 'access.grants'),
        ),
      );
    if (rows.length !== unique.length) throw notFound('Lesson not found');
  }

  private record(
    tx: DbTx,
    workspaceId: string,
    actor: Actor,
    action: string,
    type: string,
    id: string,
    newValue: Record<string, unknown>,
  ) {
    return this.audit.record(tx, {
      action,
      workspaceId,
      actor: { type: 'user', userId: actor.userId },
      entity: { type, id },
      newValue,
      requestId: actor.requestId,
    });
  }
}

function pick(row: typeof lessons.$inferSelect) {
  return { id: row.id, title: row.title, body: row.body };
}
