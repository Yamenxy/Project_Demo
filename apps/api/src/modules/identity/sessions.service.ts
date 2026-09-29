import { Injectable } from '@nestjs/common';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { Clock, IdGenerator } from '../../common';
import { TenantDb, type DbTx } from '../../database';
import { consentState, type ConsentState } from './consent';
import { sessions, users, type SessionRevokeReason, type UserStatus } from './schema';
import { generateSessionToken, hashToken } from './tokens';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

/** "Remember me": sliding 14-day idle expiry (EDGE-05), capped at 60 days. */
const REMEMBERED = { idleMs: 14 * DAY, absoluteMs: 60 * DAY };
/** Otherwise: a browser-session cookie, and the server forgets it after 12 hours. */
const NOT_REMEMBERED = { idleMs: 12 * HOUR, absoluteMs: 12 * HOUR };
/** last_seen_at is written at most this often, to keep reads cheap. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export interface CreatedSession {
  sessionId: string;
  token: string;
  /** Cookie expiry; undefined means a browser-session cookie. */
  cookieExpiresAt?: Date;
}

export interface ResolvedSession {
  sessionId: string;
  userId: string;
  userStatus: UserStatus;
  twoFactorEnabled: boolean;
  /** Signed in with a password but the second factor isn't checked yet (REQ-AUTH-007). */
  secondFactorPending: boolean;
  /** Guardian consent (REQ-PRIV-001); enforced for student memberships only. */
  consent: ConsentState;
}

/** Opaque server-side sessions (REQ-AUTH-004). */
@Injectable()
export class SessionsService {
  constructor(
    private readonly db: TenantDb,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async create(
    tx: DbTx,
    userId: string,
    options: {
      remember: boolean;
      deviceLabel?: string;
      deviceId?: string;
      /** False when the account has 2FA: the session stays pending until the code is checked. */
      secondFactorSatisfied?: boolean;
    },
  ): Promise<CreatedSession> {
    const now = this.clock.now();
    const policy = options.remember ? REMEMBERED : NOT_REMEMBERED;
    const token = generateSessionToken();
    const sessionId = this.ids.newId();
    const absoluteExpiresAt = new Date(now.getTime() + policy.absoluteMs);
    await tx.insert(sessions).values({
      id: sessionId,
      userId,
      tokenHash: hashToken(token),
      deviceLabel: options.deviceLabel?.slice(0, 120) ?? null,
      deviceId: options.deviceId ?? null,
      secondFactorAt: options.secondFactorSatisfied === false ? null : now,
      createdAt: now,
      lastSeenAt: now,
      idleExpiresAt: new Date(now.getTime() + policy.idleMs),
      absoluteExpiresAt,
    });
    return {
      sessionId,
      token,
      cookieExpiresAt: options.remember ? absoluteExpiresAt : undefined,
    };
  }

  /** Returns the live session for a token, sliding its idle expiry, or null. */
  async resolve(token: string): Promise<ResolvedSession | null> {
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          sessionId: sessions.id,
          userId: sessions.userId,
          userStatus: users.status,
          lastSeenAt: sessions.lastSeenAt,
          idleExpiresAt: sessions.idleExpiresAt,
          absoluteExpiresAt: sessions.absoluteExpiresAt,
          createdAt: sessions.createdAt,
          secondFactorAt: sessions.secondFactorAt,
          totpEnabledAt: users.totpEnabledAt,
          dateOfBirth: users.dateOfBirth,
          userCreatedAt: users.createdAt,
          guardianConsentAt: users.guardianConsentAt,
        })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt)));
      if (!row) return null;
      if (row.idleExpiresAt <= now || row.absoluteExpiresAt <= now) return null;

      if (now.getTime() - row.lastSeenAt.getTime() >= TOUCH_INTERVAL_MS) {
        const idleMs = row.idleExpiresAt.getTime() - row.lastSeenAt.getTime();
        const nextIdle = Math.min(now.getTime() + idleMs, row.absoluteExpiresAt.getTime());
        await tx
          .update(sessions)
          .set({ lastSeenAt: now, idleExpiresAt: new Date(nextIdle) })
          .where(eq(sessions.id, row.sessionId));
      }
      const twoFactorEnabled = row.totpEnabledAt !== null;
      return {
        sessionId: row.sessionId,
        userId: row.userId,
        userStatus: row.userStatus,
        twoFactorEnabled,
        secondFactorPending: twoFactorEnabled && row.secondFactorAt === null,
        consent: consentState(
          {
            dateOfBirth: row.dateOfBirth,
            createdAt: row.userCreatedAt,
            consentAt: row.guardianConsentAt,
          },
          now,
        ),
      };
    });
  }

  async revoke(tx: DbTx, sessionId: string, reason: SessionRevokeReason): Promise<void> {
    await tx
      .update(sessions)
      .set({ revokedAt: this.clock.now(), revokeReason: reason })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
  }

  /** Revokes every live session of the user, optionally keeping one. Returns how many. */
  async revokeAllForUser(
    tx: DbTx,
    userId: string,
    reason: SessionRevokeReason,
    exceptSessionId?: string,
  ): Promise<number> {
    const revoked = await tx
      .update(sessions)
      .set({ revokedAt: this.clock.now(), revokeReason: reason })
      .where(
        and(
          eq(sessions.userId, userId),
          isNull(sessions.revokedAt),
          exceptSessionId ? ne(sessions.id, exceptSessionId) : undefined,
        ),
      )
      .returning({ id: sessions.id });
    return revoked.length;
  }
}
