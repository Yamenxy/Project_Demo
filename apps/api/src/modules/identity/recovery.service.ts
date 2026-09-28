import { Injectable } from '@nestjs/common';
import { and, eq, isNotNull, max, ne } from 'drizzle-orm';
import { AppError, Clock } from '../../common';
import { normalizePhone, toWesternDigits } from '../../common/phone';
import { isUniqueViolation, TenantDb, type DbTx } from '../../database';
import { AuditService } from '../audit';
import type { UserSummary } from './auth.schemas';
import type { RequestMeta } from './request-meta';
import { OtpSender } from './otp/otp-sender';
import { OtpService, type OtpCheck } from './otp/otp.service';
import { checkPassword, hashPassword } from './password';
import { RateLimiter, type RateLimitRule } from './rate-limiter';
import { sessions, users } from './schema';
import { SessionsService } from './sessions.service';

/** Activity inside this window means OTP alone can't take the account over (REQ-AUTH-003). */
const RECENT_ACTIVITY_MS = 365 * 24 * 3600 * 1000;

export const OTP_RATE_LIMITS = {
  sendPerPhone: { scope: 'otp.send.phone', limit: 5, windowSeconds: 3600 },
  sendPerIp: { scope: 'otp.send.ip', limit: 20, windowSeconds: 3600 },
  // 5 wrong codes, then a 15-minute lockout (REQ-AUTH-001).
  wrongCodes: { scope: 'otp.wrong', limit: 5, windowSeconds: 15 * 60 },
} satisfies Record<string, RateLimitRule>;

type UserRow = typeof users.$inferSelect;

/** Phone verification and password reset by one-time code. */
@Injectable()
export class RecoveryService {
  constructor(
    private readonly db: TenantDb,
    private readonly otp: OtpService,
    private readonly sender: OtpSender,
    private readonly sessions: SessionsService,
    private readonly rateLimiter: RateLimiter,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  async sendVerificationCode(userId: string, meta: RequestMeta): Promise<number> {
    const user = await this.getUser(userId);
    if (user.phoneVerifiedAt) {
      throw new AppError(409, 'phone_already_verified', 'Phone number is already verified');
    }
    await this.limitSends(user.phoneE164, meta.ip);
    const { code, expiresInSeconds } = await this.db.transaction((tx) =>
      this.otp.issue(tx, user.id, user.phoneE164, 'verify_phone'),
    );
    // Sent after commit, so a stored challenge always exists for a delivered code.
    await this.sender.send(user.phoneE164, code, 'verify_phone');
    return expiresInSeconds;
  }

  /**
   * Verifies the account's phone and activates a pending account. If another account already
   * holds this number as verified, the number moves only when that account has been inactive
   * for a year (a recycled number); otherwise the claim is refused (REQ-AUTH-001, REQ-AUTH-003).
   */
  async verifyPhone(userId: string, rawCode: string, meta: RequestMeta): Promise<UserSummary> {
    const lockKey = `verify_phone:${userId}`;
    await this.assertNotLocked(lockKey);
    const code = toWesternDigits(rawCode.trim());

    const outcome = await this.db
      .transaction(async (tx) => {
        const check = await this.otp.check(tx, userId, 'verify_phone', code);
        if (check !== 'ok') return { check } as const;
        const user = await this.getUser(userId, tx);

        const [holder] = await tx
          .select()
          .from(users)
          .where(
            and(
              eq(users.phoneE164, user.phoneE164),
              isNotNull(users.phoneVerifiedAt),
              ne(users.id, user.id),
            ),
          )
          .for('update');
        if (holder) {
          if (await this.hasRecentActivity(tx, holder)) return { check: 'phone_in_use' } as const;
          await tx
            .update(users)
            .set({ phoneVerifiedAt: null, updatedAt: this.clock.now() })
            .where(eq(users.id, holder.id));
          await this.audit.record(tx, {
            action: 'auth.phone_reassigned',
            workspaceId: null,
            actor: { type: 'user', userId: user.id },
            entity: { type: 'user', id: holder.id },
            newValue: { toUserId: user.id },
            requestId: meta.requestId,
          });
        }

        const now = this.clock.now();
        const [updated] = await tx
          .update(users)
          .set({
            phoneVerifiedAt: now,
            status: user.status === 'pending' ? 'active' : user.status,
            updatedAt: now,
          })
          .where(eq(users.id, user.id))
          .returning();
        await this.audit.record(tx, {
          action: 'auth.phone_verified',
          workspaceId: null,
          actor: { type: 'user', userId: user.id },
          entity: { type: 'user', id: user.id },
          oldValue: { status: user.status },
          newValue: { status: updated?.status },
          requestId: meta.requestId,
          personalContext: { ip: meta.ip },
        });
        return { check: 'ok', user: updated } as const;
      })
      .catch((err: unknown) => {
        // Two accounts verifying the same number at once: the unique index lets only one win.
        if (isUniqueViolation(err, 'users_verified_phone_uq'))
          return { check: 'phone_in_use' } as const;
        throw err;
      });

    if (outcome.check === 'phone_in_use') {
      throw new AppError(409, 'phone_in_use', 'This number belongs to another active account');
    }
    if (outcome.check !== 'ok' || !outcome.user) await this.codeFailure(outcome.check, lockKey);
    const user = outcome.user as UserRow;
    return {
      id: user.id,
      nameAr: user.nameAr,
      platformCode: user.platformCode,
      status: user.status,
      phoneVerified: true,
      twoFactorEnabled: user.totpEnabledAt !== null,
    };
  }

  /**
   * "Forgot password": always answers the same way, so it can't reveal which numbers have
   * accounts. A code goes only to the verified holder of the number.
   */
  async requestPasswordReset(rawPhone: string, meta: RequestMeta): Promise<void> {
    const phone = normalizePhone(rawPhone);
    if (!phone) return;
    await this.limitSends(phone, meta.ip);
    const holder = await this.findVerifiedHolder(phone);
    if (!holder || holder.status === 'anonymized' || holder.status === 'archived') return;
    const { code } = await this.db.transaction((tx) =>
      this.otp.issue(tx, holder.id, phone, 'password_reset'),
    );
    await this.sender.send(phone, code, 'password_reset');
  }

  /**
   * Sets a new password with a code. An account used in the last 12 months can't be taken over
   * with the code alone, because the number may have been recycled to someone else (REQ-AUTH-003,
   * EDGE-01): that case is sent to support.
   */
  async resetPassword(
    rawPhone: string,
    rawCode: string,
    newPassword: string,
    meta: RequestMeta,
  ): Promise<void> {
    const phone = normalizePhone(rawPhone);
    const holder = phone ? await this.findVerifiedHolder(phone) : undefined;
    if (!phone || !holder) throw new AppError(400, 'invalid_code', 'The code is not valid');
    const lockKey = `password_reset:${holder.id}`;
    await this.assertNotLocked(lockKey);
    const problem = checkPassword(newPassword, phone);
    if (problem) throw new AppError(400, problem, 'Password does not meet the policy');
    const passwordHash = await hashPassword(newPassword);

    const outcome = await this.db.transaction(async (tx) => {
      const check = await this.otp.check(
        tx,
        holder.id,
        'password_reset',
        toWesternDigits(rawCode.trim()),
      );
      if (check !== 'ok') return check;
      if (await this.hasRecentActivity(tx, holder)) {
        await this.audit.record(tx, {
          action: 'auth.recovery_refused',
          workspaceId: null,
          actor: { type: 'user', userId: holder.id },
          entity: { type: 'user', id: holder.id },
          reason: 'recent_activity',
          requestId: meta.requestId,
          personalContext: { ip: meta.ip },
        });
        return 'requires_support';
      }
      const now = this.clock.now();
      await tx
        .update(users)
        .set({ passwordHash, passwordChangedAt: now, updatedAt: now })
        .where(eq(users.id, holder.id));
      const revoked = await this.sessions.revokeAllForUser(tx, holder.id, 'password_reset');
      await this.audit.record(tx, {
        action: 'auth.password_reset',
        workspaceId: null,
        actor: { type: 'user', userId: holder.id },
        entity: { type: 'user', id: holder.id },
        newValue: { revokedSessions: revoked },
        requestId: meta.requestId,
        personalContext: { ip: meta.ip },
      });
      return 'ok';
    });

    if (outcome === 'requires_support') {
      throw new AppError(
        403,
        'recovery_requires_support',
        'Contact support to recover this account',
      );
    }
    if (outcome !== 'ok') await this.codeFailure(outcome, lockKey);
  }

  private async codeFailure(check: OtpCheck | 'phone_in_use', lockKey: string): Promise<never> {
    if (check === 'invalid' || check === 'too_many_attempts') {
      await this.rateLimiter.hit(OTP_RATE_LIMITS.wrongCodes, lockKey);
    }
    if (check === 'too_many_attempts') {
      throw new AppError(429, 'code_attempts_exceeded', 'Request a new code');
    }
    if (check === 'expired') throw new AppError(400, 'code_expired', 'The code has expired');
    throw new AppError(400, 'invalid_code', 'The code is not valid');
  }

  private async assertNotLocked(lockKey: string): Promise<void> {
    const state = await this.rateLimiter.peek(OTP_RATE_LIMITS.wrongCodes, lockKey);
    if (state.limited) {
      throw new AppError(429, 'rate_limited', 'Too many attempts', {
        retryAfterSeconds: state.retryAfterSeconds,
      });
    }
  }

  private async limitSends(phone: string, ip: string): Promise<void> {
    for (const [rule, subject] of [
      [OTP_RATE_LIMITS.sendPerPhone, phone],
      [OTP_RATE_LIMITS.sendPerIp, ip],
    ] as const) {
      const state = await this.rateLimiter.hit(rule, subject);
      if (state.limited) {
        throw new AppError(429, 'rate_limited', 'Too many codes requested', {
          retryAfterSeconds: state.retryAfterSeconds,
        });
      }
    }
  }

  private async hasRecentActivity(tx: DbTx, user: UserRow): Promise<boolean> {
    const [row] = await tx
      .select({ lastSeen: max(sessions.lastSeenAt) })
      .from(sessions)
      .where(eq(sessions.userId, user.id));
    const last = row?.lastSeen ?? user.createdAt;
    return this.clock.now().getTime() - last.getTime() < RECENT_ACTIVITY_MS;
  }

  private async findVerifiedHolder(phone: string): Promise<UserRow | undefined> {
    const [holder] = await this.db.transaction((tx) =>
      tx
        .select()
        .from(users)
        .where(and(eq(users.phoneE164, phone), isNotNull(users.phoneVerifiedAt))),
    );
    return holder;
  }

  private async getUser(userId: string, tx?: DbTx): Promise<UserRow> {
    const run = (t: DbTx) => t.select().from(users).where(eq(users.id, userId)).for('update');
    const [user] = tx ? await run(tx) : await this.db.transaction(run);
    if (!user) throw new AppError(401, 'unauthenticated', 'Authentication required');
    return user;
  }
}
