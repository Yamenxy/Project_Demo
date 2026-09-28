import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { and, eq, lt, sql } from 'drizzle-orm';
import { Clock } from '../../common';
import { TenantDb } from '../../database';
import { rateLimitCounters } from './schema';

export interface RateLimitRule {
  /** Namespace, for example `login.identifier`. */
  scope: string;
  limit: number;
  windowSeconds: number;
}

export interface RateLimitState {
  count: number;
  limited: boolean;
  retryAfterSeconds: number;
}

/**
 * Fixed-window counters in PostgreSQL (no Redis at launch, architecture PRIN-06). Keys are
 * SHA-256 hashed so phone numbers and IPs never sit in the table in clear text.
 */
@Injectable()
export class RateLimiter {
  constructor(
    private readonly db: TenantDb,
    private readonly clock: Clock,
  ) {}

  /** Counts one event and reports whether the limit is now exceeded. */
  async hit(rule: RateLimitRule, subject: string): Promise<RateLimitState> {
    const { key, windowStart, retryAfterSeconds } = this.bucket(rule, subject);
    const [row] = await this.db.transaction((tx) =>
      tx
        .insert(rateLimitCounters)
        .values({ key, windowStart, count: 1 })
        .onConflictDoUpdate({
          target: [rateLimitCounters.key, rateLimitCounters.windowStart],
          set: { count: sql`${rateLimitCounters.count} + 1` },
        })
        .returning({ count: rateLimitCounters.count }),
    );
    const count = row?.count ?? 1;
    return { count, limited: count > rule.limit, retryAfterSeconds };
  }

  /** Reports the current state without counting. */
  async peek(rule: RateLimitRule, subject: string): Promise<RateLimitState> {
    const { key, windowStart, retryAfterSeconds } = this.bucket(rule, subject);
    const [row] = await this.db.transaction((tx) =>
      tx
        .select({ count: rateLimitCounters.count })
        .from(rateLimitCounters)
        .where(and(eq(rateLimitCounters.key, key), eq(rateLimitCounters.windowStart, windowStart))),
    );
    const count = row?.count ?? 0;
    return { count, limited: count >= rule.limit, retryAfterSeconds };
  }

  /** Deletes windows that ended more than a day ago. */
  async purgeExpired(): Promise<number> {
    const cutoff = new Date(this.clock.now().getTime() - 24 * 3600 * 1000);
    const deleted = await this.db.transaction((tx) =>
      tx.delete(rateLimitCounters).where(lt(rateLimitCounters.windowStart, cutoff)).returning(),
    );
    return deleted.length;
  }

  private bucket(rule: RateLimitRule, subject: string) {
    const now = this.clock.now().getTime();
    const windowMs = rule.windowSeconds * 1000;
    const start = Math.floor(now / windowMs) * windowMs;
    return {
      key: createHash('sha256').update(`${rule.scope}:${subject}`).digest('hex'),
      windowStart: new Date(start),
      retryAfterSeconds: Math.ceil((start + windowMs - now) / 1000),
    };
  }
}
