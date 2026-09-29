import { Injectable } from '@nestjs/common';
import { normalizePhone, toWesternDigits } from '@lms/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { AppError, Clock, IdGenerator } from '../../common';
import { TenantDb, type DbTx } from '../../database';
import { AuditService } from '../audit';
import { CONSENT_VERSION, consentDueAt, consentState, isMinor, type ConsentState } from './consent';
import { OtpLimits } from './otp/otp-limits';
import { OtpSender } from './otp/otp-sender';
import { OtpService } from './otp/otp.service';
import type { RequestMeta } from './request-meta';
import { guardianConsents, otpChallenges, users } from './schema';

export interface ConsentStatus {
  state: ConsentState;
  /** When a limited account stops working in workspaces; null when nothing is needed. */
  dueAt: Date | null;
  dateOfBirth: string | null;
  guardianPhone: string | null;
  method: 'otp' | 'paper' | null;
  version: string;
}

type UserRow = typeof users.$inferSelect;

/**
 * Guardian consent for students under 18 (REQ-PRIV-001): by a code sent to the guardian's phone,
 * or on paper, recorded by workspace staff. A student can't use their own number as the
 * guardian's (OQ-09); they need paper consent instead.
 */
@Injectable()
export class ConsentService {
  constructor(
    private readonly db: TenantDb,
    private readonly otp: OtpService,
    private readonly sender: OtpSender,
    private readonly limits: OtpLimits,
    private readonly audit: AuditService,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async status(userId: string): Promise<ConsentStatus> {
    return this.db.transaction(async (tx) => {
      const user = await this.getUser(tx, userId);
      const [latest] = await tx
        .select({ method: guardianConsents.method })
        .from(guardianConsents)
        .where(eq(guardianConsents.userId, userId))
        .orderBy(desc(guardianConsents.createdAt))
        .limit(1);
      const state = this.stateOf(user);
      return {
        state,
        dueAt: state === 'needed' || state === 'overdue' ? consentDueAt(user.createdAt) : null,
        dateOfBirth: user.dateOfBirth,
        guardianPhone: user.guardianPhoneE164,
        method: latest?.method ?? null,
        version: CONSENT_VERSION,
      };
    });
  }

  /**
   * The student gives their date of birth (once; later changes go through support, so it can't
   * be moved to skip consent) and their guardian's phone.
   */
  async updateDetails(
    userId: string,
    input: { dateOfBirth?: string; guardianPhone?: string },
    meta: RequestMeta,
  ): Promise<ConsentStatus> {
    const guardianPhone =
      input.guardianPhone === undefined ? undefined : normalizePhone(input.guardianPhone);
    if (guardianPhone === null)
      throw new AppError(400, 'invalid_phone', 'Phone number is not valid');
    await this.db.transaction(async (tx) => {
      const user = await this.getUser(tx, userId, true);
      const dateOfBirth = input.dateOfBirth ?? user.dateOfBirth;
      if (input.dateOfBirth && user.dateOfBirth && user.dateOfBirth !== input.dateOfBirth) {
        throw new AppError(409, 'date_of_birth_locked', 'Contact support to change it');
      }
      if (dateOfBirth && dateOfBirth > this.today()) {
        throw new AppError(400, 'invalid_date_of_birth', 'Date of birth is in the future');
      }
      const minor = !dateOfBirth || isMinor(dateOfBirth, this.clock.now());
      if (guardianPhone && minor && guardianPhone === user.phoneE164) {
        throw new AppError(400, 'guardian_phone_is_own', 'Use your guardian’s own number');
      }
      const now = this.clock.now();
      const phoneChanged = guardianPhone !== undefined && guardianPhone !== user.guardianPhoneE164;
      await tx
        .update(users)
        .set({
          dateOfBirth,
          ...(guardianPhone !== undefined ? { guardianPhoneE164: guardianPhone } : {}),
          updatedAt: now,
        })
        .where(eq(users.id, userId));
      if (phoneChanged) {
        // A code already sent to the old number can't confirm the new one.
        await tx
          .update(otpChallenges)
          .set({ consumedAt: now })
          .where(
            and(
              eq(otpChallenges.userId, userId),
              eq(otpChallenges.purpose, 'guardian_consent'),
              isNull(otpChallenges.consumedAt),
            ),
          );
      }
      await this.audit.record(tx, {
        action: 'user.consent_details_changed',
        workspaceId: null,
        actor: { type: 'user', userId },
        entity: { type: 'user', id: userId },
        newValue: {
          dateOfBirthSet: Boolean(input.dateOfBirth && !user.dateOfBirth),
          guardianPhoneChanged: phoneChanged,
        },
        requestId: meta.requestId,
      });
    });
    return this.status(userId);
  }

  async sendCode(userId: string, meta: RequestMeta): Promise<number> {
    const user = await this.db.transaction((tx) => this.getUser(tx, userId));
    const phone = this.assertCanRequest(user);
    await this.limits.limitSends(phone, meta.ip);
    const { code, expiresInSeconds } = await this.db.transaction((tx) =>
      this.otp.issue(tx, userId, phone, 'guardian_consent'),
    );
    await this.sender.send(phone, code, 'guardian_consent');
    return expiresInSeconds;
  }

  async verifyCode(userId: string, rawCode: string, meta: RequestMeta): Promise<ConsentStatus> {
    const lockKey = `guardian_consent:${userId}`;
    await this.limits.assertNotLocked(lockKey);
    const code = toWesternDigits(rawCode.trim());
    const check = await this.db.transaction(async (tx) => {
      const user = await this.getUser(tx, userId, true);
      const phone = this.assertCanRequest(user);
      const result = await this.otp.check(tx, userId, 'guardian_consent', code);
      if (result !== 'ok') return result;
      await this.grant(tx, user, { method: 'otp', guardianPhone: phone }, meta.requestId);
      return result;
    });
    if (check !== 'ok') await this.limits.codeFailure(check, lockKey);
    return this.status(userId);
  }

  /**
   * Paper consent seen by staff of a workspace the student belongs to. The caller checks the
   * membership and permission. Uploading the scanned form waits for file storage (Phase 5).
   */
  async recordPaper(input: {
    userId: string;
    workspaceId: string;
    recordedBy: string;
    note: string | null;
    requestId?: string;
  }): Promise<void> {
    // In the workspace scope: the audit event belongs to that workspace's log.
    await this.db.inWorkspace(input.workspaceId, async (tx) => {
      const user = await this.getUser(tx, input.userId, true);
      const state = this.stateOf(user);
      if (state === 'granted' || state === 'not_required') {
        throw new AppError(409, 'consent_not_needed', 'Consent is already in place');
      }
      await this.grant(
        tx,
        user,
        {
          method: 'paper',
          workspaceId: input.workspaceId,
          recordedBy: input.recordedBy,
          note: input.note,
        },
        input.requestId,
      );
    });
  }

  private async grant(
    tx: DbTx,
    user: UserRow,
    how:
      | { method: 'otp'; guardianPhone: string }
      | { method: 'paper'; workspaceId: string; recordedBy: string; note: string | null },
    requestId?: string,
  ): Promise<void> {
    const now = this.clock.now();
    const id = this.ids.newId();
    await tx.insert(guardianConsents).values({
      id,
      userId: user.id,
      method: how.method,
      version: CONSENT_VERSION,
      guardianPhoneE164: how.method === 'otp' ? how.guardianPhone : user.guardianPhoneE164,
      workspaceId: how.method === 'paper' ? how.workspaceId : null,
      recordedBy: how.method === 'paper' ? how.recordedBy : null,
      note: how.method === 'paper' ? how.note : null,
      createdAt: now,
    });
    await tx
      .update(users)
      .set({ guardianConsentAt: now, updatedAt: now })
      .where(eq(users.id, user.id));
    await this.audit.record(tx, {
      action: 'consent.granted',
      workspaceId: how.method === 'paper' ? how.workspaceId : null,
      actor: { type: 'user', userId: how.method === 'paper' ? how.recordedBy : user.id },
      entity: { type: 'user', id: user.id },
      newValue: { consentId: id, method: how.method, version: CONSENT_VERSION },
      requestId,
    });
  }

  /** Consent by code needs a known minor age and a guardian number that isn't the student's. */
  private assertCanRequest(user: UserRow): string {
    const state = this.stateOf(user);
    if (state === 'granted' || state === 'not_required') {
      throw new AppError(409, 'consent_not_needed', 'Consent is already in place');
    }
    if (!user.dateOfBirth) {
      throw new AppError(400, 'date_of_birth_required', 'Enter your date of birth first');
    }
    if (!user.guardianPhoneE164) {
      throw new AppError(400, 'guardian_phone_required', 'Enter your guardian’s number first');
    }
    if (user.guardianPhoneE164 === user.phoneE164) {
      throw new AppError(400, 'guardian_phone_is_own', 'Use your guardian’s own number');
    }
    return user.guardianPhoneE164;
  }

  private stateOf(user: UserRow): ConsentState {
    return consentState(
      {
        dateOfBirth: user.dateOfBirth,
        createdAt: user.createdAt,
        consentAt: user.guardianConsentAt,
      },
      this.clock.now(),
    );
  }

  private today(): string {
    return this.clock.now().toISOString().slice(0, 10);
  }

  private async getUser(tx: DbTx, userId: string, lock = false): Promise<UserRow> {
    const query = tx.select().from(users).where(eq(users.id, userId));
    const [user] = lock ? await query.for('update') : await query;
    if (!user) throw new AppError(401, 'unauthenticated', 'Authentication required');
    return user;
  }
}
