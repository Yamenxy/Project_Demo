import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { AppError, Clock, IdGenerator, notFound } from '../../common';
import { UPLOAD_LIMIT_BYTES } from '../../common/http/request-id';
import { TenantDb, type DbTx } from '../../database';
import { JobsRuntime } from '../../jobs';
import { AuditService } from '../audit';
import { AccessService, courseScope, courses, lessons } from '../content';
import { memberships, studentScope, type WorkspaceContext } from '../tenancy';
import { isImage, sniff, type KnownType } from './magic';
import { files } from './schema';
import { FileStorage } from './storage';

export interface Actor {
  userId: string;
  requestId?: string;
}

export type OwnerType = 'lesson' | 'payment_request';

export interface FileView {
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  status: 'quarantine' | 'available' | 'rejected';
}

/** Types each owner accepts: lessons take PDFs and images; payment proofs only images. */
const ALLOWED: Record<OwnerType, ReadonlySet<KnownType>> = {
  lesson: new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']),
  payment_request: new Set(['image/png', 'image/jpeg', 'image/webp']),
};

const keyOf = (area: 'quarantine' | 'available', workspaceId: string, fileId: string) =>
  `${area}/${workspaceId}/${fileId}`;

/**
 * Uploads in quarantine, checked by a job, and served only after the owner's access check
 * (REQ-FILE-001, REQ-PAY-010).
 */
@Injectable()
export class FilesService {
  constructor(
    private readonly db: TenantDb,
    private readonly storage: FileStorage,
    private readonly jobs: JobsRuntime,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async upload(
    ctx: WorkspaceContext,
    owner: { type: OwnerType; id: string },
    input: { name: string; data: unknown },
    actor: Actor,
  ): Promise<FileView> {
    // The owner check comes first, so another workspace's ids always answer 404.
    await this.db.inWorkspace(ctx.workspaceId, (tx) => this.assertCanUpload(tx, ctx, owner));
    if (!Buffer.isBuffer(input.data)) {
      throw new AppError(
        415,
        'unsupported_media_type',
        'Send the file as application/octet-stream',
      );
    }
    const data: Buffer = input.data;
    if (data.length === 0 || data.length > UPLOAD_LIMIT_BYTES) {
      throw new AppError(400, 'file_too_large', 'The file is empty or larger than 20 MB');
    }
    const id = this.ids.newId();
    await this.storage.put(keyOf('quarantine', ctx.workspaceId, id), data);
    try {
      await this.db.inWorkspace(ctx.workspaceId, async (tx) => {
        await this.assertCanUpload(tx, ctx, owner);
        await tx.insert(files).values({
          workspaceId: ctx.workspaceId,
          id,
          ownerType: owner.type,
          ownerId: owner.id,
          name: input.name.slice(0, 200),
          contentType: 'application/octet-stream',
          sizeBytes: data.length,
          sha256: createHash('sha256').update(data).digest('hex'),
          status: 'quarantine',
          uploadedBy: actor.userId,
          createdAt: this.clock.now(),
        });
        await this.jobs.enqueue(tx, 'files.scan', { workspaceId: ctx.workspaceId, fileId: id });
        await this.audit.record(tx, {
          action: 'file.uploaded',
          workspaceId: ctx.workspaceId,
          actor: { type: 'user', userId: actor.userId },
          entity: { type: 'file', id },
          newValue: { ownerType: owner.type, ownerId: owner.id, sizeBytes: data.length },
          requestId: actor.requestId,
        });
      });
    } catch (err) {
      await this.storage.remove(keyOf('quarantine', ctx.workspaceId, id));
      throw err;
    }
    return {
      id,
      name: input.name,
      contentType: 'application/octet-stream',
      sizeBytes: data.length,
      status: 'quarantine',
    };
  }

  /** The scan job: size and magic bytes decide; an accepted file leaves quarantine. */
  async scan(workspaceId: string, fileId: string): Promise<void> {
    await this.db.inWorkspace(workspaceId, async (tx) => {
      const [file] = await tx.select().from(files).where(eq(files.id, fileId)).for('update');
      if (!file || file.status !== 'quarantine') return; // already handled: safe to repeat
      const data = await this.storage.get(keyOf('quarantine', workspaceId, fileId));
      const type = sniff(data);
      const reason =
        data.length > UPLOAD_LIMIT_BYTES
          ? 'too_large'
          : !type || !ALLOWED[file.ownerType].has(type)
            ? 'type_not_allowed'
            : null;
      if (reason || !type) {
        await tx
          .update(files)
          .set({ status: 'rejected', rejectReason: reason ?? 'type_not_allowed' })
          .where(eq(files.id, fileId));
        await this.storage.remove(keyOf('quarantine', workspaceId, fileId));
        return;
      }
      await this.storage.move(
        keyOf('quarantine', workspaceId, fileId),
        keyOf('available', workspaceId, fileId),
      );
      await tx
        .update(files)
        .set({ status: 'available', contentType: type })
        .where(eq(files.id, fileId));
    });
  }

  async list(ctx: WorkspaceContext, owner: { type: OwnerType; id: string }): Promise<FileView[]> {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      await this.assertCanRead(tx, ctx, owner);
      const rows = await tx
        .select()
        .from(files)
        .where(
          and(
            eq(files.ownerType, owner.type),
            eq(files.ownerId, owner.id),
            isNull(files.deletedAt),
            // Students only ever see files that passed the checks.
            ctx.role === 'student' ? eq(files.status, 'available') : undefined,
          ),
        )
        .orderBy(asc(files.createdAt));
      return rows.map((f) => ({
        id: f.id,
        name: f.name,
        contentType: f.contentType,
        sizeBytes: f.sizeBytes,
        status: f.status,
      }));
    });
  }

  /** The bytes, after the owner's access check, every time (nothing is cached). */
  async download(
    ctx: WorkspaceContext,
    fileId: string,
  ): Promise<{ data: Buffer; name: string; contentType: string; inline: boolean }> {
    const file = await this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      const [row] = await tx
        .select()
        .from(files)
        .where(and(eq(files.id, fileId), isNull(files.deletedAt)));
      if (!row || row.status !== 'available') throw notFound('File not found');
      await this.assertCanRead(tx, ctx, { type: row.ownerType, id: row.ownerId });
      return row;
    });
    return {
      data: await this.storage.get(keyOf('available', ctx.workspaceId, fileId)),
      name: file.name,
      contentType: file.contentType,
      inline: isImage(file.contentType),
    };
  }

  private async assertCanUpload(
    tx: DbTx,
    ctx: WorkspaceContext,
    owner: { type: OwnerType; id: string },
  ): Promise<void> {
    if (owner.type === 'lesson') {
      if (ctx.role === 'student') throw new AppError(403, 'forbidden', 'Not allowed');
      await this.staffLesson(tx, ctx, owner.id);
      return;
    }
    // A proof goes on the student's own pending request.
    const found = await tx.execute<{ id: string }>(sql`
      select id from payment_requests
       where id = ${owner.id} and membership_id = ${ctx.membershipId} and status = 'pending'`);
    if (ctx.role !== 'student' || found.rows.length === 0) throw notFound('Request not found');
  }

  private async assertCanRead(
    tx: DbTx,
    ctx: WorkspaceContext,
    owner: { type: OwnerType; id: string },
  ): Promise<void> {
    if (owner.type === 'lesson') {
      if (ctx.role === 'student') {
        await this.access.lesson(ctx, owner.id); // throws unless AccessPolicy allows
        return;
      }
      await this.staffLesson(tx, ctx, owner.id);
      return;
    }
    if (ctx.role === 'student') {
      const own = await tx.execute<{ id: string }>(sql`
        select id from payment_requests where id = ${owner.id} and membership_id = ${ctx.membershipId}`);
      if (own.rows.length === 0) throw notFound('File not found');
      return;
    }
    // Proofs are visible only to staff with payments.confirm for that student (REQ-PAY-010).
    if (!ctx.permissions.has('payments.confirm')) throw notFound('File not found');
    const [row] = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          sql`${memberships.id} = (select membership_id from payment_requests where id = ${owner.id})`,
          studentScope(ctx, 'payments.confirm'),
        ),
      );
    if (!row) throw notFound('File not found');
  }

  /** Staff act on lesson files with `content.edit` for the lesson's course. */
  private async staffLesson(tx: DbTx, ctx: WorkspaceContext, lessonId: string): Promise<void> {
    const [row] = await tx
      .select({ id: lessons.id })
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
  }
}
