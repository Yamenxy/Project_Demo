import { createHash, randomInt } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { AppError, Clock, IdGenerator } from '../../../common';
import { SecretBox } from '../../../common/secret-box';
import { toWesternDigits } from '../../../common/phone';
import { APP_CONFIG, type AppConfig } from '../../../config';
import { TenantDb, type DbTx } from '../../../database';
import { AuditService } from '../../audit';
import { RateLimiter } from '../rate-limiter';
import { OTP_RATE_LIMITS } from '../recovery.service';
import type { RequestMeta } from '../request-meta';
import { recoveryCodes, sessions, users } from '../schema';
import { base32Encode, generateTotpSecret, matchTotp, otpauthUri } from './totp';

const RECOVERY_CODE_COUNT = 10;
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ISSUER = 'LMS';

export interface TwoFactorSetup {
  secret: string;
  otpauthUri: string;
}

/** TOTP enrolment and the second step of sign-in (REQ-AUTH-007). */
@Injectable()
export class TwoFactorService {
  private readonly box: SecretBox;

  constructor(
    private readonly db: TenantDb,
    private readonly rateLimiter: RateLimiter,
    private readonly audit: AuditService,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) config: Pick<AppConfig, 'secretEncryptionKey'>,
  ) {
    this.box = new SecretBox(config.secretEncryptionKey);
  }

  /** Starts enrolment: a new secret, stored encrypted, not yet active. */
  async setup(userId: string): Promise<TwoFactorSetup> {
    return this.db.transaction(async (tx) => {
      const user = await this.lockUser(tx, userId);
      if (user.totpEnabledAt) {
        throw new AppError(409, 'two_factor_already_enabled', 'Two-factor is already enabled');
      }
      const secret = generateTotpSecret();
      await tx
        .update(users)
        .set({ totpSecretEncrypted: this.box.seal(secret), updatedAt: this.clock.now() })
        .where(eq(users.id, userId));
      const encoded = base32Encode(secret);
      return { secret: encoded, otpauthUri: otpauthUri(encoded, user.platformCode, ISSUER) };
    });
  }

  /**
   * Confirms enrolment with a first code. Returns the recovery codes, which are shown once and
   * stored only as hashes. The current session counts as verified.
   */
  async enable(
    userId: string,
    sessionId: string,
    rawCode: string,
    meta: RequestMeta,
  ): Promise<string[]> {
    const lockKey = `two_factor:${userId}`;
    await this.assertNotLocked(lockKey);
    const result = await this.db.transaction(async (tx) => {
      const user = await this.lockUser(tx, userId);
      if (user.totpEnabledAt) return { kind: 'already_enabled' } as const;
      if (!user.totpSecretEncrypted) return { kind: 'not_set_up' } as const;
      const now = this.clock.now();
      const step = matchTotp(
        this.box.open(user.totpSecretEncrypted),
        toWesternDigits(rawCode.trim()),
        now.getTime(),
        user.totpLastStep,
      );
      if (step === null) return { kind: 'invalid' } as const;

      await tx
        .update(users)
        .set({ totpEnabledAt: now, totpLastStep: step, updatedAt: now })
        .where(eq(users.id, userId));
      await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
      const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
      await tx.insert(recoveryCodes).values(
        codes.map((code) => ({
          id: this.ids.newId(),
          userId,
          codeHash: hashRecoveryCode(code),
          createdAt: now,
        })),
      );
      await this.markSessionVerified(tx, sessionId, userId);
      await this.audit.record(tx, {
        action: 'auth.two_factor_enabled',
        workspaceId: null,
        actor: { type: 'user', userId },
        entity: { type: 'user', id: userId },
        requestId: meta.requestId,
        personalContext: { ip: meta.ip },
      });
      return { kind: 'ok', codes } as const;
    });

    if (result.kind === 'already_enabled') {
      throw new AppError(409, 'two_factor_already_enabled', 'Two-factor is already enabled');
    }
    if (result.kind === 'not_set_up') {
      throw new AppError(409, 'two_factor_not_set_up', 'Start two-factor setup first');
    }
    if (result.kind === 'invalid') return this.fail(lockKey);
    return result.codes;
  }

  /** The second sign-in step: an authenticator code or an unused recovery code. */
  async verify(
    userId: string,
    sessionId: string,
    rawCode: string,
    meta: RequestMeta,
  ): Promise<void> {
    const lockKey = `two_factor:${userId}`;
    await this.assertNotLocked(lockKey);
    const outcome = await this.db.transaction(async (tx) => {
      const user = await this.lockUser(tx, userId);
      if (!user.totpEnabledAt || !user.totpSecretEncrypted) return 'not_enabled';
      const now = this.clock.now();
      const code = toWesternDigits(rawCode.trim());

      const step = matchTotp(
        this.box.open(user.totpSecretEncrypted),
        code,
        now.getTime(),
        user.totpLastStep,
      );
      if (step !== null) {
        await tx.update(users).set({ totpLastStep: step }).where(eq(users.id, userId));
        await this.markSessionVerified(tx, sessionId, userId);
        return 'ok';
      }

      const [recovery] = await tx
        .update(recoveryCodes)
        .set({ usedAt: now })
        .where(
          and(
            eq(recoveryCodes.userId, userId),
            eq(recoveryCodes.codeHash, hashRecoveryCode(code)),
            isNull(recoveryCodes.usedAt),
          ),
        )
        .returning({ id: recoveryCodes.id });
      if (!recovery) return 'invalid';
      await this.markSessionVerified(tx, sessionId, userId);
      await this.audit.record(tx, {
        action: 'auth.recovery_code_used',
        workspaceId: null,
        actor: { type: 'user', userId },
        entity: { type: 'user', id: userId },
        requestId: meta.requestId,
        personalContext: { ip: meta.ip },
      });
      return 'ok';
    });
    if (outcome === 'not_enabled') {
      throw new AppError(409, 'two_factor_not_enabled', 'Two-factor is not enabled');
    }
    if (outcome === 'invalid') await this.fail(lockKey);
  }

  private async markSessionVerified(tx: DbTx, sessionId: string, userId: string): Promise<void> {
    await tx
      .update(sessions)
      .set({ secondFactorAt: this.clock.now() })
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
  }

  private async lockUser(tx: DbTx, userId: string) {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
    if (!user) throw new AppError(401, 'unauthenticated', 'Authentication required');
    return user;
  }

  private async assertNotLocked(lockKey: string): Promise<void> {
    const state = await this.rateLimiter.peek(OTP_RATE_LIMITS.wrongCodes, lockKey);
    if (state.limited) {
      throw new AppError(429, 'rate_limited', 'Too many attempts', {
        retryAfterSeconds: state.retryAfterSeconds,
      });
    }
  }

  private async fail(lockKey: string): Promise<never> {
    await this.rateLimiter.hit(OTP_RATE_LIMITS.wrongCodes, lockKey);
    throw new AppError(400, 'invalid_code', 'The code is not valid');
  }
}

/** Format XXXX-XXXX; entered with or without the dash, in any case. */
function generateRecoveryCode(): string {
  const chars = Array.from({ length: 8 }, () => RECOVERY_ALPHABET[randomInt(32)]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

function hashRecoveryCode(code: string): string {
  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return createHash('sha256').update(normalized).digest('hex');
}
