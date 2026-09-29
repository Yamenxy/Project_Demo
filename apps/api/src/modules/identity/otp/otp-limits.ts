import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common';
import { RateLimiter, type RateLimitRule } from '../rate-limiter';
import type { OtpCheck } from './otp.service';

export const OTP_RATE_LIMITS = {
  sendPerPhone: { scope: 'otp.send.phone', limit: 5, windowSeconds: 3600 },
  sendPerIp: { scope: 'otp.send.ip', limit: 20, windowSeconds: 3600 },
  // 5 wrong codes, then a 15-minute lockout (REQ-AUTH-001).
  wrongCodes: { scope: 'otp.wrong', limit: 5, windowSeconds: 15 * 60 },
} satisfies Record<string, RateLimitRule>;

/** The send limits and wrong-code lockout shared by every one-time-code flow (REQ-AUTH-001). */
@Injectable()
export class OtpLimits {
  constructor(private readonly rateLimiter: RateLimiter) {}

  async limitSends(phone: string, ip: string): Promise<void> {
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

  async assertNotLocked(lockKey: string): Promise<void> {
    const state = await this.rateLimiter.peek(OTP_RATE_LIMITS.wrongCodes, lockKey);
    if (state.limited) {
      throw new AppError(429, 'rate_limited', 'Too many attempts', {
        retryAfterSeconds: state.retryAfterSeconds,
      });
    }
  }

  /** Counts a wrong code toward the lockout and throws the matching error. */
  async codeFailure(check: OtpCheck | 'phone_in_use', lockKey: string): Promise<never> {
    if (check === 'invalid' || check === 'too_many_attempts') {
      await this.rateLimiter.hit(OTP_RATE_LIMITS.wrongCodes, lockKey);
    }
    if (check === 'too_many_attempts') {
      throw new AppError(429, 'code_attempts_exceeded', 'Request a new code');
    }
    if (check === 'expired') throw new AppError(400, 'code_expired', 'The code has expired');
    throw new AppError(400, 'invalid_code', 'The code is not valid');
  }
}
