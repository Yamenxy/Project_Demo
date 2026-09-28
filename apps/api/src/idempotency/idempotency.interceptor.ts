import { createHash } from 'node:crypto';
import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { and, eq, lt } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { from, lastValueFrom, type Observable } from 'rxjs';
import { AppError, Clock } from '../common';
import { TenantDb } from '../database';
import { idempotencyKeys } from './schema';

export const IDEMPOTENCY_HEADER = 'idempotency-key';
export const REPLAYED_HEADER = 'idempotent-replayed';
const KEY_FORMAT = /^[A-Za-z0-9_-]{8,128}$/;
const TTL_MS = 24 * 3600 * 1000;
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Makes signed-in mutating requests safe to retry (REQ-DATA-003): a request carrying an
 * `Idempotency-Key` header runs once; repeating it within 24 hours returns the first response
 * without running it again. Reusing a key with a different body is refused. Only successful
 * responses are stored, so a failed request can be retried with the same key.
 *
 * Anonymous requests ignore the header: without a user, keys couldn't be kept apart safely.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly db: TenantDb,
    private readonly clock: Clock,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const key = request.headers[IDEMPOTENCY_HEADER];
    const userId = request.auth?.userId;
    if (!MUTATING.has(request.method) || key === undefined || !userId) return next.handle();
    return from(this.run(context, next, request, userId, key));
  }

  private async run(
    context: ExecutionContext,
    next: CallHandler,
    request: FastifyRequest,
    userId: string,
    key: string | string[],
  ): Promise<unknown> {
    if (typeof key !== 'string' || !KEY_FORMAT.test(key)) {
      throw new AppError(400, 'invalid_idempotency_key', 'Idempotency key is not valid');
    }
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    const path = request.url.split('?')[0] ?? request.url;
    const keyHash = sha256(`${userId}:${request.method}:${path}:${key}`);
    const requestHash = sha256(JSON.stringify(request.body ?? null));
    const now = this.clock.now();

    const claimed = await this.db.transaction(async (tx) => {
      // An expired key is free to reuse.
      await tx
        .delete(idempotencyKeys)
        .where(and(eq(idempotencyKeys.keyHash, keyHash), lt(idempotencyKeys.expiresAt, now)));
      return tx
        .insert(idempotencyKeys)
        .values({
          keyHash,
          userId,
          requestHash,
          status: 'in_progress',
          createdAt: now,
          expiresAt: new Date(now.getTime() + TTL_MS),
        })
        .onConflictDoNothing()
        .returning({ keyHash: idempotencyKeys.keyHash });
    });

    if (claimed.length === 0) {
      const [existing] = await this.db.transaction((tx) =>
        tx.select().from(idempotencyKeys).where(eq(idempotencyKeys.keyHash, keyHash)),
      );
      if (!existing) throw new AppError(409, 'request_in_progress', 'Retry shortly');
      if (existing.requestHash !== requestHash) {
        throw new AppError(422, 'idempotency_key_reused', 'Key was used for a different request');
      }
      if (existing.status === 'in_progress') {
        throw new AppError(409, 'request_in_progress', 'The first request is still running');
      }
      void reply.status(existing.responseStatus ?? 200).header(REPLAYED_HEADER, 'true');
      return existing.responseBody ?? undefined;
    }

    try {
      const body: unknown = await lastValueFrom(next.handle(), { defaultValue: undefined });
      const status =
        this.reflector.get<number | undefined>(HTTP_CODE_METADATA, context.getHandler()) ??
        (request.method === 'POST' ? 201 : 200);
      await this.db.transaction((tx) =>
        tx
          .update(idempotencyKeys)
          .set({ status: 'completed', responseStatus: status, responseBody: body ?? null })
          .where(eq(idempotencyKeys.keyHash, keyHash)),
      );
      return body;
    } catch (err) {
      await this.db.transaction((tx) =>
        tx.delete(idempotencyKeys).where(eq(idempotencyKeys.keyHash, keyHash)),
      );
      throw err;
    }
  }

  /** Deletes expired keys. Returns how many. */
  async purgeExpired(): Promise<number> {
    const deleted = await this.db.transaction((tx) =>
      tx
        .delete(idempotencyKeys)
        .where(lt(idempotencyKeys.expiresAt, this.clock.now()))
        .returning({ keyHash: idempotencyKeys.keyHash }),
    );
    return deleted.length;
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
