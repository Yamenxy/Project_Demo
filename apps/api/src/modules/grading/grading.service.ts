import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { AppError, Clock, IdGenerator, notFound } from '../../common';
import type { PermissionKey } from '../../common/policy';
import { TenantDb, type DbTx } from '../../database';
import { AuditService } from '../audit';
import { classes, classScope } from '../classes';
import { users } from '../identity';
import { memberships, type WorkspaceContext } from '../tenancy';
import { gradeChanges, gradeEntries, gradeItems } from './schema';

export interface Actor {
  userId: string;
  requestId?: string;
}

export interface GradeItemView {
  id: string;
  title: string;
  maxScore: number;
  kind: 'paper' | 'exam' | 'homework';
  released: boolean;
  classAverage: number | null;
}

export interface Gradebook {
  classId: string;
  className: string;
  items: GradeItemView[];
  students: {
    membershipId: string;
    name: string;
    enrolled: boolean;
    /** Scores by item id, in points; null means absent or not graded. */
    scores: Record<string, number | null>;
    /** Percentage over graded items. */
    average: number | null;
  }[];
}

export interface MyGrades {
  classes: {
    classId: string;
    className: string;
    items: { id: string; title: string; maxScore: number; score: number | null }[];
    average: number | null;
  }[];
}

const toPoints = (centi: number | null) => (centi === null ? null : centi / 100);
const toCenti = (points: number) => Math.round(points * 100);

/** Percentage over the (score, max) pairs that have a score. */
export function averagePercent(pairs: { score: number | null; max: number }[]): number | null {
  const graded = pairs.filter((p) => p.score !== null);
  if (graded.length === 0) return null;
  const sum = graded.reduce((acc, p) => acc + (p.score ?? 0) / p.max, 0);
  return Math.round((sum / graded.length) * 1000) / 10;
}

/** The gradebook (REQ-GRADE-001 to -003). */
@Injectable()
export class GradingService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  /** Items, and every student enrolled now or with a score in the class, with averages. */
  async gradebook(ctx: WorkspaceContext, classId: string): Promise<Gradebook> {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      const cls = await this.cls(tx, ctx, classId, 'grading.grade');
      const items = await tx
        .select()
        .from(gradeItems)
        .where(and(eq(gradeItems.classId, classId), isNull(gradeItems.archivedAt)))
        .orderBy(asc(gradeItems.createdAt));
      const itemIds = items.map((i) => i.id);
      const entries = itemIds.length
        ? await tx.select().from(gradeEntries).where(inArray(gradeEntries.itemId, itemIds))
        : [];
      const students = await tx.execute<{
        membership_id: string;
        name: string;
        enrolled: boolean;
      }>(sql`
        select m.id as membership_id, coalesce(u.name_ar, m.provisional_name) as name,
               exists (select 1 from class_enrollments e where e.class_id = ${classId}
                        and e.membership_id = m.id and e.ended_at is null) as enrolled
          from memberships m
          left join users u on u.id = m.user_id
         where m.role = 'student'
           and (exists (select 1 from class_enrollments e where e.class_id = ${classId}
                         and e.membership_id = m.id and e.ended_at is null)
                ${
                  itemIds.length
                    ? sql`or exists (select 1 from grade_entries g
                  where g.membership_id = m.id and g.item_id in ${itemIds})`
                    : sql``
                })
         order by 2`);
      const score = (itemId: string, membershipId: string) =>
        toPoints(
          entries.find((e) => e.itemId === itemId && e.membershipId === membershipId)?.scoreCenti ??
            null,
        );
      return {
        classId,
        className: cls.name,
        items: items.map((i) => ({
          id: i.id,
          title: i.title,
          maxScore: i.maxScoreCenti / 100,
          kind: i.kind,
          released: i.releasedAt !== null,
          classAverage: averagePercent(
            entries
              .filter((e) => e.itemId === i.id)
              .map((e) => ({ score: e.scoreCenti, max: i.maxScoreCenti })),
          ),
        })),
        students: students.rows.map((s) => {
          const scores = Object.fromEntries(items.map((i) => [i.id, score(i.id, s.membership_id)]));
          return {
            membershipId: s.membership_id,
            name: s.name,
            enrolled: s.enrolled,
            scores,
            average: averagePercent(
              items.map((i) => ({ score: scores[i.id] ?? null, max: i.maxScoreCenti / 100 })),
            ),
          };
        }),
      };
    });
  }

  async createItem(
    ctx: WorkspaceContext,
    classId: string,
    input: {
      title: string;
      maxScore: number;
      kind?: 'paper' | 'exam' | 'homework';
      sourceId?: string;
    },
    actor: Actor,
    tx?: DbTx,
  ): Promise<{ id: string }> {
    const work = async (t: DbTx) => {
      await this.cls(t, ctx, classId, 'grading.grade');
      const id = this.ids.newId();
      const now = this.clock.now();
      await t.insert(gradeItems).values({
        workspaceId: ctx.workspaceId,
        id,
        classId,
        title: input.title.trim(),
        maxScoreCenti: toCenti(input.maxScore),
        kind: input.kind ?? 'paper',
        sourceId: input.sourceId ?? null,
        createdBy: actor.userId,
        createdAt: now,
        updatedAt: now,
      });
      await this.audit.record(t, {
        action: 'grade_item.created',
        workspaceId: ctx.workspaceId,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'grade_item', id },
        newValue: { classId, title: input.title, maxScore: input.maxScore },
        requestId: actor.requestId,
      });
      return { id };
    };
    return tx ? work(tx) : this.db.inWorkspace(ctx.workspaceId, work);
  }

  async updateItem(
    ctx: WorkspaceContext,
    itemId: string,
    change: { title?: string; maxScore?: number; archived?: boolean },
    actor: Actor,
  ): Promise<void> {
    await this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      await this.item(tx, ctx, itemId, 'grading.grade');
      const now = this.clock.now();
      await tx
        .update(gradeItems)
        .set({
          ...(change.title === undefined ? {} : { title: change.title.trim() }),
          ...(change.maxScore === undefined ? {} : { maxScoreCenti: toCenti(change.maxScore) }),
          ...(change.archived === undefined ? {} : { archivedAt: change.archived ? now : null }),
          updatedAt: now,
        })
        .where(eq(gradeItems.id, itemId));
      await this.audit.record(tx, {
        action: 'grade_item.updated',
        workspaceId: ctx.workspaceId,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'grade_item', id: itemId },
        newValue: change,
        requestId: actor.requestId,
      });
    });
  }

  /**
   * Scores for many students in one transaction (REQ-GRADE-001). Every change is kept with the
   * old and new value; after release a reason is required (REQ-GRADE-002).
   */
  async setScores(
    ctx: WorkspaceContext,
    itemId: string,
    input: { scores: { membershipId: string; score: number | null }[]; reason?: string },
    actor: Actor,
    tx?: DbTx,
  ): Promise<{ changed: number }> {
    const work = async (t: DbTx) => {
      const item = await this.item(t, ctx, itemId, 'grading.grade');
      if (item.releasedAt && (!input.reason || input.reason.trim().length < 3)) {
        throw new AppError(400, 'reason_required', 'Give a reason to change released grades');
      }
      for (const s of input.scores) {
        if (s.score !== null && (s.score < 0 || toCenti(s.score) > item.maxScoreCenti)) {
          throw new AppError(400, 'score_out_of_range', 'A score is outside 0 to the maximum');
        }
      }
      const ids = [...new Set(input.scores.map((s) => s.membershipId))];
      const students = await t
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(inArray(memberships.id, ids), eq(memberships.role, 'student')));
      if (students.length !== ids.length) throw notFound('Student not found');
      const existing = new Map(
        (
          await t
            .select()
            .from(gradeEntries)
            .where(and(eq(gradeEntries.itemId, itemId), inArray(gradeEntries.membershipId, ids)))
            .for('update')
        ).map((e) => [e.membershipId, e]),
      );
      const now = this.clock.now();
      let changed = 0;
      for (const s of input.scores) {
        const next = s.score === null ? null : toCenti(s.score);
        const before = existing.get(s.membershipId);
        if (before && before.scoreCenti === next) continue;
        let entryId = before?.id;
        if (before) {
          await t
            .update(gradeEntries)
            .set({ scoreCenti: next, updatedBy: actor.userId, updatedAt: now })
            .where(eq(gradeEntries.id, before.id));
        } else {
          entryId = this.ids.newId();
          await t.insert(gradeEntries).values({
            workspaceId: ctx.workspaceId,
            id: entryId,
            itemId,
            membershipId: s.membershipId,
            scoreCenti: next,
            updatedBy: actor.userId,
            updatedAt: now,
          });
        }
        await t.insert(gradeChanges).values({
          workspaceId: ctx.workspaceId,
          id: this.ids.newId(),
          entryId: entryId ?? '',
          oldScoreCenti: before?.scoreCenti ?? null,
          newScoreCenti: next,
          changedBy: actor.userId,
          reason: input.reason?.trim() || null,
          changedAt: now,
        });
        changed++;
      }
      if (changed > 0) {
        await this.audit.record(t, {
          action: item.releasedAt ? 'grade.changed_after_release' : 'grade.recorded',
          workspaceId: ctx.workspaceId,
          actor: { type: 'user', userId: actor.userId },
          entity: { type: 'grade_item', id: itemId },
          newValue: { changed },
          ...(input.reason ? { reason: input.reason.trim() } : {}),
          requestId: actor.requestId,
        });
      }
      return { changed };
    };
    return tx ? work(tx) : this.db.inWorkspace(ctx.workspaceId, work);
  }

  /** Release control (`grading.release`): unreleased grades are invisible to students. */
  async setReleased(
    ctx: WorkspaceContext,
    itemId: string,
    released: boolean,
    actor: Actor,
  ): Promise<void> {
    await this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      await this.item(tx, ctx, itemId, 'grading.release');
      await tx
        .update(gradeItems)
        .set({ releasedAt: released ? this.clock.now() : null, updatedAt: this.clock.now() })
        .where(eq(gradeItems.id, itemId));
      await this.audit.record(tx, {
        action: released ? 'grade_item.released' : 'grade_item.unreleased',
        workspaceId: ctx.workspaceId,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'grade_item', id: itemId },
        requestId: actor.requestId,
      });
    });
  }

  async history(ctx: WorkspaceContext, itemId: string) {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      await this.item(tx, ctx, itemId, 'grading.grade');
      return tx
        .select({
          membershipId: gradeEntries.membershipId,
          oldScore: gradeChanges.oldScoreCenti,
          newScore: gradeChanges.newScoreCenti,
          changedBy: users.nameAr,
          reason: gradeChanges.reason,
          changedAt: gradeChanges.changedAt,
        })
        .from(gradeChanges)
        .innerJoin(gradeEntries, eq(gradeEntries.id, gradeChanges.entryId))
        .innerJoin(users, eq(users.id, gradeChanges.changedBy))
        .where(eq(gradeEntries.itemId, itemId))
        .orderBy(asc(gradeChanges.changedAt))
        .then((rows) =>
          rows.map((r) => ({
            ...r,
            oldScore: toPoints(r.oldScore),
            newScore: toPoints(r.newScore),
          })),
        );
    });
  }

  /** A student's released grades in every class they have grades in (REQ-GRADE-003). */
  async mine(ctx: WorkspaceContext): Promise<MyGrades> {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      const rows = await tx
        .select({
          classId: classes.id,
          className: classes.name,
          itemId: gradeItems.id,
          title: gradeItems.title,
          max: gradeItems.maxScoreCenti,
          score: gradeEntries.scoreCenti,
        })
        .from(gradeEntries)
        .innerJoin(gradeItems, eq(gradeItems.id, gradeEntries.itemId))
        .innerJoin(classes, eq(classes.id, gradeItems.classId))
        .where(
          and(
            eq(gradeEntries.membershipId, ctx.membershipId),
            sql`${gradeItems.releasedAt} is not null`,
            isNull(gradeItems.archivedAt),
          ),
        )
        .orderBy(asc(classes.name), asc(gradeItems.createdAt));
      const byClass = new Map<string, MyGrades['classes'][number]>();
      for (const r of rows) {
        const entry = byClass.get(r.classId) ?? {
          classId: r.classId,
          className: r.className,
          items: [],
          average: null,
        };
        entry.items.push({
          id: r.itemId,
          title: r.title,
          maxScore: r.max / 100,
          score: toPoints(r.score),
        });
        byClass.set(r.classId, entry);
      }
      return {
        classes: [...byClass.values()].map((c) => ({
          ...c,
          average: averagePercent(c.items.map((i) => ({ score: i.score, max: i.maxScore }))),
        })),
      };
    });
  }

  private async cls(tx: DbTx, ctx: WorkspaceContext, classId: string, key: PermissionKey) {
    if (!ctx.permissions.coversClass(key, classId)) throw notFound('Class not found');
    const [row] = await tx
      .select({ id: classes.id, name: classes.name })
      .from(classes)
      .where(and(eq(classes.id, classId), classScope(ctx)));
    if (!row) throw notFound('Class not found');
    return row;
  }

  private async item(tx: DbTx, ctx: WorkspaceContext, itemId: string, key: PermissionKey) {
    const [item] = await tx
      .select()
      .from(gradeItems)
      .where(eq(gradeItems.id, itemId))
      .for('update');
    if (!item) throw notFound('Grade item not found');
    await this.cls(tx, ctx, item.classId, key);
    return item;
  }
}
