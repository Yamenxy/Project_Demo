import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { Pool, type PoolClient } from 'pg';
import { loadConfig } from '../../config';
import {
  generatePlatformCode,
  generateSessionToken,
  hashToken,
} from '../../modules/identity/tokens';
import { DEMO_PHONE_PREFIX } from '../seed';

/**
 * Prepares an exam load test (REQ-EXAM-005, load/README.md): a new workspace with an open exam
 * and N synthetic students, each with a session. Users and sessions are written directly (there
 * is no bulk sign-up); everything else goes through the running API, so it is built by the same
 * code the test measures. Writes the students' session tokens to a file for k6; local, demo and
 * staging tiers only, with synthetic data.
 *
 *   pnpm --filter @lms/api load:seed -- --students 700 --out ../../load/fixture.json
 */
const HOUR = 3600 * 1000;

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

async function insertUser(client: PoolClient, name: string, n: number): Promise<string> {
  const id = randomUUID();
  // Unverified numbers in the reserved demo block, so they never collide with real accounts.
  const phone = `${DEMO_PHONE_PREFIX}${String(5000 + (n % 5000)).padStart(4, '0')}`;
  await client.query(
    `insert into users (id, platform_code, name_ar, phone_e164, date_of_birth, status,
                        password_hash, password_changed_at, created_at, updated_at)
     values ($1, $2, $3, $4, '2000-01-01', 'active', 'load-test-no-login', now(), now(), now())`,
    [id, generatePlatformCode(), name, phone],
  );
  return id;
}

async function insertSession(client: PoolClient, userId: string): Promise<string> {
  const token = generateSessionToken();
  await client.query(
    `insert into sessions (id, user_id, token_hash, device_label, second_factor_at, created_at,
                           last_seen_at, idle_expires_at, absolute_expires_at)
     values ($1, $2, $3, 'load test', now(), now(), now(), now() + interval '1 day',
             now() + interval '1 day')`,
    [randomUUID(), userId, hashToken(token)],
  );
  return token;
}

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  if (config.deployTier === 'production' || config.dataClass !== 'synthetic') {
    throw new Error('The load seed only runs on synthetic, non-production tiers');
  }
  const students = Number(arg('students', '700'));
  const out = arg('out', 'load-fixture.json');
  const api = arg('api', process.env.API_URL ?? `http://localhost:${String(config.port)}`);
  if (!Number.isInteger(students) || students < 1 || students > 5000) {
    throw new Error('--students must be between 1 and 5000');
  }

  const pool = new Pool({ connectionString: config.databasePlatformUrl, max: 1 });
  const client = await pool.connect();
  let ownerToken: string;
  let workspaceId: string;
  const people: { userId: string; token: string }[] = [];
  try {
    await client.query('begin');
    const owner = await insertUser(client, 'معلم اختبار التحميل', 0);
    // The owner needs two-step verification; the session counts as verified.
    await client.query(
      `update users set totp_secret_encrypted = 'v1.load-test', totp_enabled_at = now()
        where id = $1`,
      [owner],
    );
    ownerToken = await insertSession(client, owner);
    workspaceId = randomUUID();
    await client.query(
      `insert into workspaces (id, slug, name, owner_user_id, created_at, updated_at)
       values ($1, $2, 'مساحة اختبار التحميل', $3, now(), now())`,
      [workspaceId, `load-${workspaceId.slice(0, 8)}`, owner],
    );
    await client.query(
      `insert into memberships (workspace_id, id, user_id, role, created_at, updated_at)
       values ($1, $2, $3, 'owner', now(), now())`,
      [workspaceId, randomUUID(), owner],
    );
    await client.query(
      `insert into workspace_settings (workspace_id, join_code, updated_at)
       values ($1, app.random_join_code(), now())`,
      [workspaceId],
    );
    for (let n = 1; n <= students; n++) {
      const userId = await insertUser(client, `طالب تحميل ${String(n)}`, n);
      people.push({ userId, token: await insertSession(client, userId) });
    }
    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }

  const w = `${api}/api/v1/w/${workspaceId}`;
  const call = async <T>(method: string, url: string, body?: object): Promise<T> => {
    const res = await fetch(url, {
      method,
      headers: {
        cookie: `lms_session=${ownerToken}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) throw new Error(`${method} ${url}: ${String(res.status)} ${await res.text()}`);
    return (res.status === 204 ? {} : await res.json()) as T;
  };

  try {
    const course = await call<{ id: string }>('POST', `${w}/courses`, { title: 'اختبار التحميل' });
    const cls = await call<{ id: string }>('POST', `${w}/classes`, {
      name: 'فصل التحميل',
      courseId: course.id,
    });
    // Students become members through the database (no join flow for thousands of accounts),
    // then are enrolled through the API.
    const members: string[] = [];
    const memberClient = await pool.connect();
    try {
      for (const p of people) {
        const id = randomUUID();
        await memberClient.query(
          `insert into memberships (workspace_id, id, user_id, role, created_at, updated_at)
           values ($1, $2, $3, 'student', now(), now())`,
          [workspaceId, id, p.userId],
        );
        members.push(id);
      }
    } finally {
      memberClient.release();
    }
    for (let i = 0; i < members.length; i += 200) {
      await call('POST', `${w}/classes/${cls.id}/students`, {
        membershipIds: members.slice(i, i + 200),
      });
    }
    const q = (body: object) =>
      call<{ id: string }>('POST', `${w}/courses/${course.id}/questions`, body);
    const questionIds = [
      (
        await q({
          kind: 'mcq',
          body: 'وحدة القوة؟',
          choices: ['نيوتن', 'جول', 'واط'],
          correctIndex: 0,
        })
      ).id,
      (await q({ kind: 'true_false', body: 'الضوء أسرع من الصوت', value: true })).id,
      (await q({ kind: 'short', body: 'عاصمة مصر؟', accepted: ['القاهرة'] })).id,
    ];
    const now = Date.now();
    const exam = await call<{ id: string }>('POST', `${w}/courses/${course.id}/exams`, {
      title: 'امتحان اختبار التحميل',
      timeLimitMinutes: 60,
      opensAt: new Date(now - 60_000).toISOString(),
      closesAt: new Date(now + 6 * HOUR).toISOString(),
      classIds: [cls.id],
      questionIds,
    });
    await call('POST', `${w}/exams/${exam.id}/publish`, { published: true });
    await writeFile(
      out,
      JSON.stringify({ api, workspaceId, examId: exam.id, tokens: people.map((p) => p.token) }),
    );
    process.stdout.write(
      `Load fixture ready: ${String(students)} students, exam ${exam.id}. Written to ${out}\n`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
