import { Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { AppError, Clock, IdGenerator } from '../../common';
import { normalizePhone } from '../../common/phone';
import { isUniqueViolation, TenantDb, type DbTx } from '../../database';
import { AuditService } from '../audit';
import type { LoginBody, RegisterBody, UserSummary } from './auth.schemas';
import { deviceLabelFrom } from './device-label';
import { DevicesService, type AdmittedDevice } from './devices/devices.service';
import { checkPassword, hashPassword, verifyAgainstDummy, verifyPassword } from './password';
import { RateLimiter, type RateLimitRule } from './rate-limiter';
import type { RequestMeta } from './request-meta';
import { users } from './schema';
import { SessionsService, type CreatedSession } from './sessions.service';
import { generatePlatformCode } from './tokens';

export type { RequestMeta } from './request-meta';

// Limits for login, registration and (later) OTP endpoints (review §3.3).
export const RATE_LIMITS = {
  loginIdentifier: { scope: 'login.identifier', limit: 10, windowSeconds: 15 * 60 },
  loginIp: { scope: 'login.ip', limit: 50, windowSeconds: 15 * 60 },
  registerIp: { scope: 'register.ip', limit: 10, windowSeconds: 3600 },
  registerPhone: { scope: 'register.phone', limit: 5, windowSeconds: 3600 },
} satisfies Record<string, RateLimitRule>;

type UserRow = typeof users.$inferSelect;

export interface SignedIn {
  user: UserSummary;
  session: CreatedSession;
  device: AdmittedDevice;
}

const UNAVAILABLE_STATUSES = new Set(['suspended', 'archived', 'anonymized']);

@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');

  constructor(
    private readonly db: TenantDb,
    private readonly sessions: SessionsService,
    private readonly devices: DevicesService,
    private readonly rateLimiter: RateLimiter,
    private readonly audit: AuditService,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  /**
   * Creates a pending account and signs it in. The account becomes active once its phone is
   * verified (REQ-AUTH-001). A number already verified by someone else doesn't block this; the
   * conflict is resolved at verification, so registration never reveals which numbers exist.
   */
  async register(body: RegisterBody, meta: RequestMeta, deviceToken?: string): Promise<SignedIn> {
    const phone = normalizePhone(body.phone);
    if (!phone) throw new AppError(400, 'invalid_phone', 'Phone number is not valid');
    await this.enforce(RATE_LIMITS.registerIp, meta.ip);
    await this.enforce(RATE_LIMITS.registerPhone, phone);
    const problem = checkPassword(body.password, phone);
    if (problem) throw new AppError(400, problem, 'Password does not meet the policy');

    const passwordHash = await hashPassword(body.password);
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      const user = await this.insertUser(tx, {
        id: this.ids.newId(),
        nameAr: body.nameAr,
        phoneE164: phone,
        email: body.email?.toLowerCase() ?? null,
        dateOfBirth: body.dateOfBirth ?? null,
        status: 'pending',
        passwordHash,
        passwordChangedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      const { session, device } = await this.startSession(
        tx,
        user,
        body.rememberMe,
        meta,
        deviceToken,
      );
      await this.audit.record(tx, {
        action: 'auth.registered',
        workspaceId: null,
        actor: { type: 'user', userId: user.id },
        entity: { type: 'user', id: user.id },
        newValue: { status: user.status },
        requestId: meta.requestId,
        personalContext: { ip: meta.ip, userAgent: meta.userAgent },
      });
      return { user: summarize(user), session, device };
    });
  }

  async login(body: LoginBody, meta: RequestMeta, deviceToken?: string): Promise<SignedIn> {
    const identifier = body.identifier.includes('@')
      ? `email:${body.identifier.toLowerCase()}`
      : `phone:${normalizePhone(body.identifier) ?? body.identifier}`;
    for (const [rule, subject] of [
      [RATE_LIMITS.loginIdentifier, identifier],
      [RATE_LIMITS.loginIp, meta.ip],
    ] as const) {
      const state = await this.rateLimiter.peek(rule, subject);
      if (state.limited) throw rateLimited(state.retryAfterSeconds);
    }

    const candidates = await this.findCandidates(body.identifier);
    let matched: UserRow | undefined;
    for (const candidate of candidates) {
      if (await verifyPassword(candidate.passwordHash, body.password)) {
        matched = candidate;
        break;
      }
    }
    if (candidates.length === 0) await verifyAgainstDummy(body.password);

    if (!matched) {
      await this.rateLimiter.hit(RATE_LIMITS.loginIdentifier, identifier);
      await this.rateLimiter.hit(RATE_LIMITS.loginIp, meta.ip);
      this.logger.log({ event: 'login_failed', requestId: meta.requestId });
      throw new AppError(401, 'invalid_credentials', 'Invalid credentials');
    }
    // Revealed only after the correct password, so it can't be used to probe accounts.
    if (UNAVAILABLE_STATUSES.has(matched.status)) {
      throw new AppError(403, 'account_unavailable', 'Account is not available');
    }

    const user = matched;
    return this.db.transaction(async (tx) => {
      const { session, device } = await this.startSession(
        tx,
        user,
        body.rememberMe,
        meta,
        deviceToken,
      );
      await this.audit.record(tx, {
        action: 'auth.login',
        workspaceId: null,
        actor: { type: 'user', userId: user.id },
        entity: { type: 'session', id: session.sessionId },
        requestId: meta.requestId,
        personalContext: { ip: meta.ip, userAgent: meta.userAgent },
      });
      return { user: summarize(user), session, device };
    });
  }

  async logout(sessionId: string): Promise<void> {
    await this.db.transaction((tx) => this.sessions.revoke(tx, sessionId, 'logout'));
  }

  /** "Log out from all devices", including this one (review §3.3). */
  async logoutAll(userId: string, meta: RequestMeta): Promise<number> {
    return this.db.transaction(async (tx) => {
      const count = await this.sessions.revokeAllForUser(tx, userId, 'logout_all');
      await this.audit.record(tx, {
        action: 'auth.logout_all',
        workspaceId: null,
        actor: { type: 'user', userId },
        entity: { type: 'user', id: userId },
        newValue: { revokedSessions: count },
        requestId: meta.requestId,
        personalContext: { ip: meta.ip, userAgent: meta.userAgent },
      });
      return count;
    });
  }

  async getSummary(userId: string): Promise<UserSummary | null> {
    const [user] = await this.db.transaction((tx) =>
      tx.select().from(users).where(eq(users.id, userId)),
    );
    return user ? summarize(user) : null;
  }

  /** Admits the device (REQ-AUTH-005), then opens a session bound to it. */
  private async startSession(
    tx: DbTx,
    user: UserRow,
    remember: boolean,
    meta: RequestMeta,
    deviceToken: string | undefined,
  ): Promise<{ session: CreatedSession; device: AdmittedDevice }> {
    const label = deviceLabelFrom(meta.userAgent);
    const device = await this.devices.admit(tx, user.id, deviceToken, label);
    const session = await this.sessions.create(tx, user.id, {
      remember,
      deviceLabel: label,
      deviceId: device.deviceId,
      secondFactorSatisfied: user.totpEnabledAt === null,
    });
    return { session, device };
  }

  private async enforce(rule: RateLimitRule, subject: string): Promise<void> {
    const state = await this.rateLimiter.hit(rule, subject);
    if (state.limited) throw rateLimited(state.retryAfterSeconds);
  }

  /**
   * The account a phone or email signs in to: the verified holder if there is one, otherwise the
   * most recent unverified accounts (a pending account can sign in to finish verification).
   */
  private async findCandidates(identifier: string): Promise<UserRow[]> {
    const isEmail = identifier.includes('@');
    const value = isEmail ? identifier.toLowerCase() : normalizePhone(identifier);
    if (!value) return [];
    const column = isEmail ? users.email : users.phoneE164;
    const verifiedAt = isEmail ? users.emailVerifiedAt : users.phoneVerifiedAt;
    return this.db.transaction(async (tx) => {
      const verified = await tx
        .select()
        .from(users)
        .where(and(eq(column, value), isNotNull(verifiedAt)))
        .limit(1);
      if (verified.length > 0 || isEmail) return verified;
      return tx
        .select()
        .from(users)
        .where(and(eq(column, value), isNull(verifiedAt)))
        .orderBy(desc(users.createdAt))
        .limit(3);
    });
  }

  /** Inserts with a fresh platform code, retrying the rare code collision in a savepoint. */
  private async insertUser(
    tx: DbTx,
    values: Omit<typeof users.$inferInsert, 'platformCode'>,
  ): Promise<UserRow> {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const [row] = await tx.transaction((sp) =>
          sp
            .insert(users)
            .values({ ...values, platformCode: generatePlatformCode() })
            .returning(),
        );
        if (row) return row;
      } catch (err) {
        if (!isUniqueViolation(err, 'users_platform_code_key')) throw err;
      }
    }
    throw new Error('Could not allocate a unique platform code');
  }
}

function summarize(user: UserRow): UserSummary {
  return {
    id: user.id,
    nameAr: user.nameAr,
    platformCode: user.platformCode,
    status: user.status,
    phoneVerified: user.phoneVerifiedAt !== null,
    twoFactorEnabled: user.totpEnabledAt !== null,
  };
}

function rateLimited(retryAfterSeconds: number): AppError {
  return new AppError(429, 'rate_limited', 'Too many attempts', { retryAfterSeconds });
}
