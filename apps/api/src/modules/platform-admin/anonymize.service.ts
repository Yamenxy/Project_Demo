import { randomInt } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Clock } from '../../common';
import type { DbTx } from '../../database';
import { PlatformDb } from '../../database/platform-db';
import { AuditService } from '../audit';
import { NotificationsService } from '../notify';

/** Days between a deletion request and anonymization; mirrors DELETION_GRACE_DAYS (tenancy). */
const GRACE_DAYS = 14;

/** The name an anonymized account shows wherever its records remain. */
export const ANONYMIZED_NAME = 'حساب محذوف';

/**
 * Anonymizes accounts whose deletion request is older than 14 days (REQ-PRIV-003, D30). Records
 * stay (grades, attendance, payments, submissions) under the anonymized account; everything that
 * identifies the person goes, in one transaction per account:
 * - the profile (name, phone, email, date of birth, guardian's phone), sign-in secrets, sessions,
 *   devices, one-time codes, recovery codes and push subscriptions;
 * - their own notifications;
 * - staff notes and provisional name and phone on their memberships, which end;
 * - invitations sent to their number;
 * - the personal context of their audit events (REQ-AUDIT-001).
 * The owner teachers of their workspaces are told. Each run is audited.
 */
@Injectable()
export class AnonymizeService {
  private readonly logger = new Logger('Anonymize');

  constructor(
    private readonly platformDb: PlatformDb,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly clock: Clock,
  ) {}

  /** The nightly job: every account past its 14 days. */
  async run(): Promise<{ anonymized: number }> {
    const due = await this.platformDb.run('privacy: accounts due for anonymization', (tx) =>
      tx.execute<{ id: string }>(sql`
        select id from users
         where deletion_requested_at is not null and status <> 'anonymized'
           and deletion_requested_at <= ${this.clock.now()}::timestamptz - make_interval(days => ${GRACE_DAYS})`),
    );
    for (const row of due.rows) await this.anonymize(row.id);
    this.logger.log({ event: 'anonymize_run', anonymized: due.rows.length });
    return { anonymized: due.rows.length };
  }

  async anonymize(userId: string): Promise<void> {
    await this.platformDb.run('privacy: anonymize an account', async (tx) => {
      const [user] = (
        await tx.execute<{ phone: string; status: string }>(
          sql`select phone_e164 as phone, status from users where id = ${userId} for update`,
        )
      ).rows;
      if (!user || user.status === 'anonymized') return;
      const now = this.clock.now();
      const placeholder = placeholderPhone();
      await tx.execute(sql`
        update users set name_ar = ${ANONYMIZED_NAME}, name_latin = null,
               phone_e164 = ${placeholder}, phone_verified_at = null,
               email = null, email_verified_at = null, date_of_birth = null,
               guardian_phone_e164 = null, password_hash = 'anonymized',
               totp_secret_encrypted = null, totp_enabled_at = null, totp_last_step = null,
               status = 'anonymized', deletion_requested_at = null, updated_at = ${now}
         where id = ${userId}`);
      await tx.execute(sql`
        update sessions set revoked_at = coalesce(revoked_at, ${now}),
               revoke_reason = coalesce(revoke_reason, 'logout_all'), device_label = null
         where user_id = ${userId}`);
      await tx.execute(sql`
        update device_registrations set label = null, revoked_at = coalesce(revoked_at, ${now}),
               revoked_by_type = coalesce(revoked_by_type, 'system')
         where user_id = ${userId}`);
      await tx.execute(sql`delete from otp_challenges where user_id = ${userId}`);
      await tx.execute(sql`delete from recovery_codes where user_id = ${userId}`);
      await tx.execute(sql`delete from push_subscriptions where user_id = ${userId}`);
      await tx.execute(sql`delete from notifications where recipient_user_id = ${userId}`);
      await tx.execute(sql`
        update workspace_invitations set phone_e164 = ${placeholder}
         where phone_e164 = ${user.phone} or accepted_by = ${userId}`);
      await tx.execute(sql`
        update audit_log set personal_context = null
         where actor_user_id = ${userId} and personal_context is not null`);
      const ended = await tx.execute<{ workspace_id: string; role: string }>(sql`
        update memberships set status = 'removed', notes = null, provisional_name = null,
               provisional_phone = null, updated_at = ${now}
         where user_id = ${userId} and status <> 'removed'
        returning workspace_id, role`);
      await this.audit.record(tx, {
        action: 'account.anonymized',
        workspaceId: null,
        actor: { type: 'system' },
        entity: { type: 'user', id: userId },
        newValue: { memberships: ended.rows.length },
      });
      await this.tellOwners(tx, userId, ended.rows);
    });
  }

  private async tellOwners(
    tx: DbTx,
    userId: string,
    ended: { workspace_id: string; role: string }[],
  ): Promise<void> {
    for (const m of ended) {
      const [owner] = (
        await tx.execute<{ owner: string }>(
          sql`select owner_user_id as owner from workspaces where id = ${m.workspace_id}`,
        )
      ).rows;
      if (!owner || owner.owner === userId) continue;
      await this.audit.record(tx, {
        action: 'membership.account_deleted',
        workspaceId: m.workspace_id,
        actor: { type: 'system' },
        entity: { type: 'user', id: userId },
        newValue: { role: m.role },
      });
      await this.notifications.notify(tx, {
        recipientUserId: owner.owner,
        workspaceId: m.workspace_id,
        type: 'privacy.account_deleted',
        params: { role: m.role },
        link: `/w/${m.workspace_id}/audit-log`,
      });
    }
  }
}

/**
 * A number no one can have: +999 isn't assigned to any country. Random, so anonymized accounts
 * don't share one, and unverified, so it never blocks anyone.
 */
function placeholderPhone(): string {
  let digits = '';
  for (let i = 0; i < 11; i++) digits += String(randomInt(10));
  return `+999${digits}`;
}
