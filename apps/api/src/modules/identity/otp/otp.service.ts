import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { Clock, IdGenerator } from '../../../common';
import type { DbTx } from '../../../database';
import { otpChallenges } from '../schema';
import type { OtpPurpose } from './otp-sender';

export const OTP_TTL_SECONDS = 5 * 60;
export const OTP_MAX_ATTEMPTS = 5;

export type OtpCheck = 'ok' | 'invalid' | 'expired' | 'too_many_attempts';

/**
 * 6-digit codes, valid for 5 minutes, usable once, at most 5 wrong tries each (REQ-AUTH-001).
 * Only a hash of the code is stored.
 */
@Injectable()
export class OtpService {
  constructor(
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  /** Creates a challenge (superseding older live ones) and returns the code to send. */
  async issue(
    tx: DbTx,
    userId: string,
    phoneE164: string,
    purpose: OtpPurpose,
  ): Promise<{ code: string; expiresInSeconds: number }> {
    const now = this.clock.now();
    await tx
      .update(otpChallenges)
      .set({ consumedAt: now })
      .where(
        and(
          eq(otpChallenges.userId, userId),
          eq(otpChallenges.purpose, purpose),
          isNull(otpChallenges.consumedAt),
        ),
      );
    const id = this.ids.newId();
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await tx.insert(otpChallenges).values({
      id,
      userId,
      phoneE164,
      purpose,
      codeHash: hashCode(id, code),
      createdAt: now,
      expiresAt: new Date(now.getTime() + OTP_TTL_SECONDS * 1000),
      attempts: 0,
    });
    return { code, expiresInSeconds: OTP_TTL_SECONDS };
  }

  /**
   * Checks a code against the user's live challenge and consumes it on success. Wrong attempts
   * are counted, so the caller must commit the transaction even when the result isn't 'ok'.
   */
  async check(tx: DbTx, userId: string, purpose: OtpPurpose, code: string): Promise<OtpCheck> {
    const [challenge] = await tx
      .select()
      .from(otpChallenges)
      .where(
        and(
          eq(otpChallenges.userId, userId),
          eq(otpChallenges.purpose, purpose),
          isNull(otpChallenges.consumedAt),
        ),
      )
      .orderBy(desc(otpChallenges.createdAt))
      .limit(1)
      .for('update');
    const now = this.clock.now();
    if (!challenge || challenge.expiresAt <= now) return 'expired';
    if (challenge.attempts >= OTP_MAX_ATTEMPTS) return 'too_many_attempts';

    const expected = Buffer.from(challenge.codeHash, 'hex');
    const actual = Buffer.from(hashCode(challenge.id, code), 'hex');
    if (!timingSafeEqual(expected, actual)) {
      await tx
        .update(otpChallenges)
        .set({ attempts: challenge.attempts + 1 })
        .where(eq(otpChallenges.id, challenge.id));
      return challenge.attempts + 1 >= OTP_MAX_ATTEMPTS ? 'too_many_attempts' : 'invalid';
    }
    await tx
      .update(otpChallenges)
      .set({ consumedAt: now })
      .where(eq(otpChallenges.id, challenge.id));
    return 'ok';
  }
}

function hashCode(challengeId: string, code: string): string {
  return createHash('sha256').update(`${challengeId}:${code}`).digest('hex');
}
