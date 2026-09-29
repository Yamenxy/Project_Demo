import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { SecretBox } from '../common/secret-box';
import { CONSENT_VERSION } from '../modules/identity/consent';
import { hashPassword } from '../modules/identity/password';
import { generatePlatformCode } from '../modules/identity/tokens';
import { base32Encode, generateTotpSecret } from '../modules/identity/two-factor/totp';

/**
 * Synthetic demo data in Arabic (REQ-OPS-005, REQ-PRIV-006). Never real people: every phone number
 * is in the 0100000xxxx block, and development OTP senders never send real messages anyway.
 * Idempotent: running it twice changes nothing.
 */
export const DEMO_PHONE_PREFIX = '+20100000';
const MARKER_PHONE = `${DEMO_PHONE_PREFIX}0001`;

export interface DemoLogin {
  role: string;
  name: string;
  phone: string;
  totpSecret?: string;
}

export interface SeedResult {
  created: boolean;
  password: string;
  logins: DemoLogin[];
}

interface PersonSpec {
  key: string;
  name: string;
  phoneSuffix: string;
  twoFactor?: boolean;
  dateOfBirth?: string;
  /** Students under 18: the guardian's number, and whether they already consented. */
  guardian?: { phoneSuffix: string; consented: boolean };
}

const PEOPLE: PersonSpec[] = [
  { key: 'platform', name: 'مالك المنصة', phoneSuffix: '0001', twoFactor: true },
  { key: 'physics', name: 'أ. محمد السيد', phoneSuffix: '0002', twoFactor: true },
  { key: 'chemistry', name: 'أ. سارة عبد الرحمن', phoneSuffix: '0003', twoFactor: true },
  { key: 'classTeacher', name: 'أ. كريم حسن', phoneSuffix: '0004', twoFactor: true },
  { key: 'helper', name: 'مساعد: يوسف علي', phoneSuffix: '0005' },
  {
    key: 's1',
    name: 'مريم أحمد',
    phoneSuffix: '0101',
    dateOfBirth: '2010-03-14',
    guardian: { phoneSuffix: '0201', consented: true },
  },
  {
    key: 's2',
    name: 'عمر خالد',
    phoneSuffix: '0102',
    dateOfBirth: '2009-11-02',
    guardian: { phoneSuffix: '0202', consented: true },
  },
  {
    key: 's3',
    name: 'نور محمود',
    phoneSuffix: '0103',
    dateOfBirth: '2010-07-21',
    guardian: { phoneSuffix: '0203', consented: true },
  },
  {
    key: 's4',
    name: 'آدم إبراهيم',
    phoneSuffix: '0104',
    dateOfBirth: '2011-01-09',
    guardian: { phoneSuffix: '0204', consented: true },
  },
  { key: 's5', name: 'فاطمة الزهراء سعيد', phoneSuffix: '0105', dateOfBirth: '2006-05-30' },
  {
    key: 's6',
    name: 'زياد مصطفى',
    phoneSuffix: '0106',
    dateOfBirth: '2011-09-17',
    guardian: { phoneSuffix: '0206', consented: false },
  },
];

export async function seedDemoData(
  pool: Pool,
  options: { password: string; secretEncryptionKey: string },
): Promise<SeedResult> {
  const client = await pool.connect();
  try {
    const existing = await client.query('select 1 from users where phone_e164 = $1', [
      MARKER_PHONE,
    ]);
    if (existing.rowCount) return { created: false, password: options.password, logins: [] };

    await client.query('begin');
    const box = new SecretBox(options.secretEncryptionKey);
    const passwordHash = await hashPassword(options.password);
    const ids: Record<string, string> = {};
    const logins: DemoLogin[] = [];

    for (const person of PEOPLE) {
      const id = randomUUID();
      ids[person.key] = id;
      const phone = `${DEMO_PHONE_PREFIX}${person.phoneSuffix}`;
      let sealed: string | null = null;
      let totpSecret: string | undefined;
      if (person.twoFactor) {
        const secret = generateTotpSecret();
        sealed = box.seal(secret);
        totpSecret = base32Encode(secret);
      }
      await client.query(
        `insert into users (id, platform_code, name_ar, phone_e164, phone_verified_at, status,
                            password_hash, password_changed_at, created_at, updated_at,
                            totp_secret_encrypted, totp_enabled_at, date_of_birth,
                            guardian_phone_e164, guardian_consent_at)
         values ($1, $2, $3, $4, now(), 'active', $5, now(), now(), now(), $6, $7, $8, $9, $10)`,
        [
          id,
          generatePlatformCode(),
          person.name,
          phone,
          passwordHash,
          sealed,
          sealed ? new Date() : null,
          person.dateOfBirth ?? '1990-01-01',
          person.guardian ? `${DEMO_PHONE_PREFIX}${person.guardian.phoneSuffix}` : null,
          person.guardian?.consented ? new Date() : null,
        ],
      );
      if (person.guardian?.consented) {
        await client.query(
          `insert into guardian_consents (id, user_id, method, version, guardian_phone_e164, created_at)
           values ($1, $2, 'otp', $3, $4, now())`,
          [randomUUID(), id, CONSENT_VERSION, `${DEMO_PHONE_PREFIX}${person.guardian.phoneSuffix}`],
        );
      }
      logins.push({
        role: person.key,
        name: person.name,
        phone: `0${phone.slice(3)}`,
        ...(totpSecret ? { totpSecret } : {}),
      });
    }

    await client.query('insert into platform_owners (user_id, created_at) values ($1, now())', [
      ids.platform,
    ]);
    const physics = await insertWorkspace(
      client,
      'mohamed-physics',
      'أ. محمد السيد — فيزياء',
      ids.physics ?? '',
    );
    const chemistry = await insertWorkspace(
      client,
      'sara-chemistry',
      'أ. سارة — كيمياء',
      ids.chemistry ?? '',
    );

    await insertMembership(client, physics, ids.classTeacher ?? '', 'class_teacher');
    const helper = await insertMembership(client, physics, ids.helper ?? '', 'assistant');
    for (const permission of ['attendance.mark', 'payments.record', 'payments.view']) {
      await client.query(
        `insert into permission_grants (workspace_id, id, membership_id, permission, granted_by, created_at)
         values ($1, $2, $3, $4, $5, now())`,
        [physics, randomUUID(), helper, permission, ids.physics],
      );
    }
    // Students: some with both teachers, one of them paused (stopped paying), and a managed
    // record that hasn't been claimed yet.
    for (const key of ['s1', 's2', 's3', 's4', 's5']) {
      await insertMembership(client, physics, ids[key] ?? '', 'student', key === 's4');
    }
    for (const key of ['s1', 's3', 's6']) {
      await insertMembership(client, chemistry, ids[key] ?? '', 'student');
    }
    await client.query(
      `insert into memberships (workspace_id, id, user_id, role, status, provisional_name,
                                provisional_phone, created_at, updated_at)
       values ($1, $2, null, 'student', 'active', 'حسن طارق', $3, now(), now())`,
      [physics, randomUUID(), `${DEMO_PHONE_PREFIX}0199`],
    );

    // Physics has paid for a month; chemistry is still on its trial.
    await client.query(
      `insert into subscriptions (workspace_id, plan, period_ends_at, grace_days, created_at, updated_at)
       values ($1, 'growth', now() + interval '20 days', 7, now(), now()),
              ($2, 'starter', now() + interval '10 days', 7, now(), now())`,
      [physics, chemistry],
    );
    await client.query(
      `insert into platform_payments (id, workspace_id, amount_piastres, currency, method, reference,
                                      paid_on, months, recorded_by, created_at)
       values ($1, $2, 150000, 'EGP', 'instapay', 'DEMO-0001', current_date - 10, 1, $3, now())`,
      [randomUUID(), physics, ids.platform],
    );

    await client.query('commit');
    return { created: true, password: options.password, logins };
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

async function insertWorkspace(
  client: PoolClient,
  slug: string,
  name: string,
  ownerUserId: string,
): Promise<string> {
  const id = randomUUID();
  await client.query(
    `insert into workspaces (id, slug, name, owner_user_id, created_at, updated_at)
     values ($1, $2, $3, $4, now(), now())`,
    [id, slug, name, ownerUserId],
  );
  await insertMembership(client, id, ownerUserId, 'owner');
  await client.query(
    `insert into workspace_settings (workspace_id, join_code, auto_approve_joins, updated_at)
     values ($1, app.random_join_code(), false, now())`,
    [id],
  );
  return id;
}

async function insertMembership(
  client: PoolClient,
  workspaceId: string,
  userId: string,
  role: string,
  paused = false,
): Promise<string> {
  const id = randomUUID();
  const owner = await client.query<{ owner_user_id: string }>(
    'select owner_user_id from workspaces where id = $1',
    [workspaceId],
  );
  await client.query(
    `insert into memberships (workspace_id, id, user_id, role, status, paused_at, paused_by,
                              pause_reason, created_at, updated_at)
     values ($1, $2, $3, $4, 'active', $5, $6, $7, now(), now())`,
    [
      workspaceId,
      id,
      userId,
      role,
      paused ? new Date() : null,
      paused ? owner.rows[0]?.owner_user_id : null,
      paused ? 'لم يسدد اشتراك الشهر' : null,
    ],
  );
  return id;
}
