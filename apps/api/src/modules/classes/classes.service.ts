import { Injectable } from '@nestjs/common';
import { and, asc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { AppError, Clock, IdGenerator, notFound } from '../../common';
import { isUniqueViolation, TenantDb, type DbTx } from '../../database';
import { AuditService } from '../audit';
import { users } from '../identity';
import { WORKSPACE_ONLY, type PermissionKey } from '../../common/policy';
import { memberships, type WorkspaceContext } from '../tenancy';
import { classEnrollments, classes } from './schema';

export interface Actor {
  userId: string;
  requestId?: string;
}

export interface ClassSummary {
  id: string;
  name: string;
  responsible: { membershipId: string; name: string };
  studentCount: number;
  archived: boolean;
}

export interface ClassStudent {
  membershipId: string;
  name: string;
  platformCode: string | null;
  internalCode: string | null;
  enrolledAt: Date;
  paused: boolean;
}

export interface ClassDetail extends ClassSummary {
  students: ClassStudent[];
}

/**
 * Who sees which classes (REQ-RBAC-001, REQ-RBAC-006): the owner sees all; a class teacher sees
 * the classes they're responsible for; a helper sees the classes their grants cover (all of them
 * for a workspace-wide grant). Classes outside the caller's view answer 404, like other
 * workspaces.
 */
function scopeFilter(ctx: WorkspaceContext): SQL | undefined {
  if (ctx.role === 'owner') return undefined;
  if (ctx.role === 'class_teacher') return eq(classes.responsibleMembershipId, ctx.membershipId);
  const covered = new Set<string>();
  for (const key of ctx.permissions.list()) {
    if (WORKSPACE_ONLY.has(key)) continue;
    const scope = ctx.permissions.scopeOf(key);
    if (scope === 'all') return undefined;
    for (const id of scope) covered.add(id);
  }
  return covered.size > 0 ? inArray(classes.id, [...covered]) : sql`false`;
}

const nameOf = sql<string>`coalesce(${users.nameAr}, ${memberships.provisionalName})`;

/** Classes, their responsible teacher, and enrolments with history (REQ-CLASS-001). */
@Injectable()
export class ClassesService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async list(ctx: WorkspaceContext, options: { archived: boolean }): Promise<ClassSummary[]> {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      const rows = await tx
        .select({
          id: classes.id,
          name: classes.name,
          archivedAt: classes.archivedAt,
          responsibleId: classes.responsibleMembershipId,
          responsibleName: nameOf,
          studentCount: sql<number>`(select count(*)::int from ${classEnrollments}
            where ${classEnrollments.classId} = ${classes.id} and ${classEnrollments.endedAt} is null)`,
        })
        .from(classes)
        .innerJoin(memberships, eq(memberships.id, classes.responsibleMembershipId))
        .leftJoin(users, eq(users.id, memberships.userId))
        .where(
          and(
            options.archived ? sql`${classes.archivedAt} is not null` : isNull(classes.archivedAt),
            scopeFilter(ctx),
          ),
        )
        .orderBy(asc(classes.name));
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        responsible: { membershipId: row.responsibleId, name: row.responsibleName },
        studentCount: row.studentCount,
        archived: row.archivedAt !== null,
      }));
    });
  }

  async get(ctx: WorkspaceContext, classId: string): Promise<ClassDetail> {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      const summary = (await this.list(ctx, { archived: false }))
        .concat(await this.list(ctx, { archived: true }))
        .find((c) => c.id === classId);
      if (!summary) throw notFound('Class not found');
      const students = await tx
        .select({
          membershipId: memberships.id,
          name: nameOf,
          platformCode: users.platformCode,
          internalCode: memberships.internalCode,
          enrolledAt: classEnrollments.enrolledAt,
          pausedAt: memberships.pausedAt,
        })
        .from(classEnrollments)
        .innerJoin(memberships, eq(memberships.id, classEnrollments.membershipId))
        .leftJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(classEnrollments.classId, classId), isNull(classEnrollments.endedAt)))
        .orderBy(asc(nameOf));
      return {
        ...summary,
        students: students.map(({ pausedAt, ...s }) => ({ ...s, paused: pausedAt !== null })),
      };
    });
  }

  /** Owner only. Without a responsible teacher, the owner is responsible. */
  async create(
    ctx: WorkspaceContext,
    input: { name: string; responsibleMembershipId?: string },
    actor: Actor,
  ): Promise<{ id: string }> {
    const id = this.ids.newId();
    await this.write(async (tx) => {
      const responsible = await this.responsibleFor(
        tx,
        input.responsibleMembershipId ?? ctx.membershipId,
      );
      const now = this.clock.now();
      await tx.insert(classes).values({
        workspaceId: ctx.workspaceId,
        id,
        name: input.name.trim(),
        responsibleMembershipId: responsible,
        createdAt: now,
        updatedAt: now,
      });
      await this.audit.record(tx, {
        action: 'class.created',
        workspaceId: ctx.workspaceId,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'class', id },
        newValue: { name: input.name.trim(), responsibleMembershipId: responsible },
        requestId: actor.requestId,
      });
    }, ctx.workspaceId);
    return { id };
  }

  /** Owner only: rename, change the responsible teacher, archive or restore. */
  async update(
    ctx: WorkspaceContext,
    classId: string,
    change: { name?: string; responsibleMembershipId?: string; archived?: boolean },
    actor: Actor,
  ): Promise<void> {
    await this.write(async (tx) => {
      const current = await this.lockClass(tx, ctx, classId);
      const responsible =
        change.responsibleMembershipId === undefined
          ? undefined
          : await this.responsibleFor(tx, change.responsibleMembershipId);
      const now = this.clock.now();
      await tx
        .update(classes)
        .set({
          ...(change.name === undefined ? {} : { name: change.name.trim() }),
          ...(responsible === undefined ? {} : { responsibleMembershipId: responsible }),
          ...(change.archived === undefined ? {} : { archivedAt: change.archived ? now : null }),
          updatedAt: now,
          version: current.version + 1,
        })
        .where(eq(classes.id, classId));
      await this.audit.record(tx, {
        action:
          change.archived === true
            ? 'class.archived'
            : change.archived === false
              ? 'class.restored'
              : 'class.updated',
        workspaceId: ctx.workspaceId,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'class', id: classId },
        oldValue: { name: current.name, responsibleMembershipId: current.responsibleMembershipId },
        newValue: {
          ...(change.name === undefined ? {} : { name: change.name.trim() }),
          ...(responsible === undefined ? {} : { responsibleMembershipId: responsible }),
        },
        requestId: actor.requestId,
      });
    }, ctx.workspaceId);
  }

  /** Enrols students (idempotent: already enrolled students are left as they are). */
  async enroll(
    ctx: WorkspaceContext,
    classId: string,
    membershipIds: string[],
    actor: Actor,
  ): Promise<{ added: number }> {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      const current = await this.lockClass(tx, ctx, classId, 'enrollment.manage');
      if (current.archivedAt) throw new AppError(409, 'class_archived', 'The class is archived');
      const students = await this.students(tx, membershipIds);
      const enrolled = new Set(
        (
          await tx
            .select({ membershipId: classEnrollments.membershipId })
            .from(classEnrollments)
            .where(
              and(
                eq(classEnrollments.classId, classId),
                isNull(classEnrollments.endedAt),
                inArray(classEnrollments.membershipId, students),
              ),
            )
        ).map((r) => r.membershipId),
      );
      const now = this.clock.now();
      const toAdd = students.filter((id) => !enrolled.has(id));
      for (const membershipId of toAdd) {
        const id = this.ids.newId();
        await tx.insert(classEnrollments).values({
          workspaceId: ctx.workspaceId,
          id,
          classId,
          membershipId,
          enrolledAt: now,
          enrolledBy: actor.userId,
        });
        await this.audit.record(tx, {
          action: 'class.student_enrolled',
          workspaceId: ctx.workspaceId,
          actor: { type: 'user', userId: actor.userId },
          entity: { type: 'membership', id: membershipId },
          newValue: { classId },
          requestId: actor.requestId,
        });
      }
      return { added: toAdd.length };
    });
  }

  async remove(
    ctx: WorkspaceContext,
    classId: string,
    membershipId: string,
    actor: Actor,
  ): Promise<void> {
    await this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      await this.lockClass(tx, ctx, classId, 'enrollment.manage');
      await this.end(tx, classId, membershipId, 'removed', actor.userId);
      await this.audit.record(tx, {
        action: 'class.student_removed',
        workspaceId: ctx.workspaceId,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'membership', id: membershipId },
        oldValue: { classId },
        requestId: actor.requestId,
      });
    });
  }

  /** Moves a student to another class; the old enrolment is kept as history (REQ-GRADE-003). */
  async transfer(
    ctx: WorkspaceContext,
    fromClassId: string,
    membershipId: string,
    toClassId: string,
    actor: Actor,
  ): Promise<void> {
    if (fromClassId === toClassId) {
      throw new AppError(400, 'same_class', 'The student is already in this class');
    }
    await this.write(async (tx) => {
      await this.lockClass(tx, ctx, fromClassId, 'enrollment.manage');
      const target = await this.lockClass(tx, ctx, toClassId, 'enrollment.manage');
      if (target.archivedAt) throw new AppError(409, 'class_archived', 'The class is archived');
      await this.end(tx, fromClassId, membershipId, 'transferred', actor.userId);
      const now = this.clock.now();
      await tx.insert(classEnrollments).values({
        workspaceId: ctx.workspaceId,
        id: this.ids.newId(),
        classId: toClassId,
        membershipId,
        enrolledAt: now,
        enrolledBy: actor.userId,
      });
      await this.audit.record(tx, {
        action: 'class.student_transferred',
        workspaceId: ctx.workspaceId,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'membership', id: membershipId },
        oldValue: { classId: fromClassId },
        newValue: { classId: toClassId },
        requestId: actor.requestId,
      });
    }, ctx.workspaceId);
  }

  /**
   * Students who could join this class: active students of the workspace not in it. Only names
   * and codes, never phone numbers, so staff scoped to one class can add new students to it.
   */
  async candidates(
    ctx: WorkspaceContext,
    classId: string,
    query: string,
  ): Promise<
    {
      membershipId: string;
      name: string;
      platformCode: string | null;
      internalCode: string | null;
    }[]
  > {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      await this.lockClass(tx, ctx, classId, 'enrollment.manage');
      const like = `%${query.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      return tx
        .select({
          membershipId: memberships.id,
          name: nameOf,
          platformCode: users.platformCode,
          internalCode: memberships.internalCode,
        })
        .from(memberships)
        .leftJoin(users, eq(users.id, memberships.userId))
        .where(
          and(
            eq(memberships.role, 'student'),
            inArray(memberships.status, ['active', 'suspended']),
            or(
              ilike(users.nameAr, like),
              ilike(memberships.provisionalName, like),
              ilike(memberships.internalCode, like),
              ilike(users.platformCode, like),
            ),
            sql`not exists (select 1 from ${classEnrollments}
              where ${classEnrollments.classId} = ${classId}
                and ${classEnrollments.membershipId} = ${memberships.id}
                and ${classEnrollments.endedAt} is null)`,
          ),
        )
        .orderBy(asc(nameOf))
        .limit(20);
    });
  }

  /** The classes a student is in now, and was in before (for the student's page). */
  async historyOf(
    ctx: WorkspaceContext,
    membershipId: string,
  ): Promise<{ classId: string; name: string; enrolledAt: Date; endedAt: Date | null }[]> {
    return this.db.inWorkspace(ctx.workspaceId, (tx) =>
      tx
        .select({
          classId: classes.id,
          name: classes.name,
          enrolledAt: classEnrollments.enrolledAt,
          endedAt: classEnrollments.endedAt,
        })
        .from(classEnrollments)
        .innerJoin(classes, eq(classes.id, classEnrollments.classId))
        .where(and(eq(classEnrollments.membershipId, membershipId), scopeFilter(ctx)))
        .orderBy(asc(classEnrollments.enrolledAt)),
    );
  }

  private async end(
    tx: DbTx,
    classId: string,
    membershipId: string,
    reason: 'removed' | 'transferred',
    userId: string,
  ): Promise<void> {
    const ended = await tx
      .update(classEnrollments)
      .set({ endedAt: this.clock.now(), endReason: reason, endedBy: userId })
      .where(
        and(
          eq(classEnrollments.classId, classId),
          eq(classEnrollments.membershipId, membershipId),
          isNull(classEnrollments.endedAt),
        ),
      )
      .returning({ id: classEnrollments.id });
    if (ended.length === 0) throw notFound('The student is not in this class');
  }

  /** The class, locked, if the caller may act on it (with `key` for that class); otherwise 404. */
  private async lockClass(tx: DbTx, ctx: WorkspaceContext, classId: string, key?: PermissionKey) {
    if (key && !ctx.permissions.coversClass(key, classId)) throw notFound('Class not found');
    const [row] = await tx
      .select()
      .from(classes)
      .where(and(eq(classes.id, classId), scopeFilter(ctx)))
      .for('update');
    if (!row) throw notFound('Class not found');
    return row;
  }

  /** A responsible teacher must be the owner or an active class teacher. */
  private async responsibleFor(tx: DbTx, membershipId: string): Promise<string> {
    const [member] = await tx
      .select({ role: memberships.role, status: memberships.status })
      .from(memberships)
      .where(eq(memberships.id, membershipId));
    if (
      !member ||
      member.status !== 'active' ||
      (member.role !== 'owner' && member.role !== 'class_teacher')
    ) {
      throw new AppError(400, 'invalid_responsible', 'Choose the owner or a class teacher');
    }
    return membershipId;
  }

  /** Student memberships of this workspace that can be enrolled; anything else is refused. */
  private async students(tx: DbTx, membershipIds: string[]): Promise<string[]> {
    const unique = [...new Set(membershipIds)];
    const rows = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          inArray(memberships.id, unique),
          eq(memberships.role, 'student'),
          inArray(memberships.status, ['active', 'suspended']),
        ),
      );
    if (rows.length !== unique.length) throw notFound('Student not found');
    return unique;
  }

  private async write(action: (tx: DbTx) => Promise<void>, workspaceId: string): Promise<void> {
    try {
      await this.db.inWorkspace(workspaceId, action);
    } catch (err) {
      if (isUniqueViolation(err, 'classes_name_uq')) {
        throw new AppError(409, 'class_name_taken', 'Another class has this name');
      }
      if (isUniqueViolation(err, 'class_enrollments_active_uq')) {
        throw new AppError(409, 'already_enrolled', 'The student is already in that class');
      }
      throw err;
    }
  }
}
