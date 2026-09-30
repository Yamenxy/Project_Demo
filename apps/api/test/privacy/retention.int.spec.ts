import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Clock, FixedClock } from '../../src/common';
import { RetentionService } from '../../src/modules/platform-admin';
import { FileStorage } from '../../src/modules/files/storage';
import { adminQuery, insertMembership, insertUser, insertWorkspace } from '../support/fixtures';
import { createIntegrationApp } from '../support/integration-app';

// Close to the real date: the log purge refuses cutoffs less than a month before the database's now.
const clock = new FixedClock(new Date().toISOString());
let app: NestFastifyApplication;

const ago = (months: number) => `now() - interval '${String(months)} months'`;

async function file(workspaceId: string, owner: string, ownerType: string, uploader: string) {
  const id = randomUUID();
  await adminQuery(
    `insert into files (workspace_id, id, owner_type, owner_id, name, content_type, size_bytes,
                        sha256, status, uploaded_by, created_at)
     values ($1, $2, $3, $4, 'f.pdf', 'application/pdf', 4, repeat('a', 64), 'available', $5, now())`,
    [workspaceId, id, ownerType, owner, uploader],
  );
  await app
    .get(FileStorage, { strict: false })
    .put(`available/${workspaceId}/${id}`, Buffer.from('%PDF'));
  return id;
}

async function homeworkFile(
  workspaceId: string,
  course: string,
  student: string,
  owner: string,
  dueMonthsAgo: number,
) {
  const homework = randomUUID();
  await adminQuery(
    `insert into homework (workspace_id, id, course_id, title, due_at, max_score_centi, created_by,
                           created_at, updated_at)
     values ($1, $2, $3, 'واجب قديم', ${ago(dueMonthsAgo)}, 1000, $4, now(), now())`,
    [workspaceId, homework, course, owner],
  );
  const submission = randomUUID();
  await adminQuery(
    `insert into homework_submissions (workspace_id, id, homework_id, membership_id, number,
                                       submitted_at, late, score_centi)
     values ($1, $2, $3, $4, 1, now(), false, 800)`,
    [workspaceId, submission, homework, student],
  );
  return { submission, fileId: await file(workspaceId, submission, 'homework_submission', owner) };
}

async function proofFile(
  workspaceId: string,
  student: string,
  owner: string,
  decidedMonthsAgo: number,
) {
  const request = randomUUID();
  await adminQuery(
    `insert into payment_requests (workspace_id, id, membership_id, submitted_by, amount_piastres,
                                   method, reference, status, decided_by, decided_at, created_at,
                                   updated_at)
     values ($1, $2, $3, $4, 1000, 'wallet', 'REF-1', 'approved', $4, ${ago(decidedMonthsAgo)},
             ${ago(decidedMonthsAgo)}, now())`,
    [workspaceId, request, student, owner],
  );
  return file(workspaceId, request, 'payment_request', owner);
}

async function deleted(fileId: string): Promise<boolean> {
  const [row] = await adminQuery<{ deleted: boolean }>(
    'select deleted_at is not null as deleted from files where id = $1',
    [fileId],
  );
  return row?.deleted ?? false;
}

beforeAll(async () => {
  app = await createIntegrationApp((builder) => builder.overrideProvider(Clock).useValue(clock));
});

afterAll(async () => {
  await app.close();
});

describe('retention (REQ-PRIV-002)', () => {
  it('removes only what is past each cutoff, and records the run', async () => {
    const owner = await insertUser();
    const workspaceId = await insertWorkspace(owner);
    const [course] = await adminQuery<{ id: string }>(
      `insert into courses (workspace_id, id, title, created_at, updated_at)
       values ($1, gen_random_uuid(), 'مقرر', now(), now()) returning id`,
      [workspaceId],
    );
    const studentUser = await insertUser();
    const student = await insertMembership(workspaceId, studentUser, 'student');

    // Files: homework 12 months after it was due, proofs 12 months after the decision.
    const oldHomework = await homeworkFile(workspaceId, course?.id ?? '', student, owner, 13);
    const newHomework = await homeworkFile(workspaceId, course?.id ?? '', student, owner, 11);
    const oldProof = await proofFile(workspaceId, student, owner, 13);
    const newProof = await proofFile(workspaceId, student, owner, 11);

    // Security records: 12 months.
    const oldSession = randomUUID();
    const newSession = randomUUID();
    for (const [id, months] of [
      [oldSession, 13],
      [newSession, 11],
    ] as const) {
      await adminQuery(
        `insert into sessions (id, user_id, token_hash, created_at, last_seen_at, idle_expires_at,
                               absolute_expires_at, revoked_at, revoke_reason)
         values ($1, $2, $3, ${ago(months)}, ${ago(months)}, ${ago(months)}, ${ago(months)},
                 ${ago(months)}, 'logout')`,
        [id, studentUser, randomUUID()],
      );
    }

    // Notifications: 12 months. Audit log: 5 years, including a whole old monthly partition.
    for (const months of [13, 11]) {
      await adminQuery(
        `insert into notifications (id, created_at, recipient_user_id, workspace_id, type, params)
         values (gen_random_uuid(), ${ago(months)}, $1, $2, $3, '{}')`,
        [studentUser, workspaceId, months === 13 ? 'retention.test_old' : 'retention.test_new'],
      );
    }
    await adminQuery(`create table if not exists audit_log_2019_01 partition of audit_log
                        for values from ('2019-01-01 00:00Z') to ('2019-02-01 00:00Z')`);
    await adminQuery(
      `insert into audit_log (id, occurred_at, workspace_id, actor_type, action)
       values (gen_random_uuid(), '2019-01-15Z', $1, 'system', 'retention.test_partition'),
              (gen_random_uuid(), ${ago(61)}, $1, 'system', 'retention.test_old'),
              (gen_random_uuid(), ${ago(59)}, $1, 'system', 'retention.test_recent')`,
      [workspaceId],
    );

    // Accounts: 3 years without activity are anonymized; workspace owners are left alone.
    const idle = await insertUser();
    const active = await insertUser();
    const idleOwner = await insertUser();
    await insertWorkspace(idleOwner);
    await adminQuery(
      `update users set created_at = ${ago(40)}, updated_at = ${ago(40)} where id in ($1, $2)`,
      [idle, idleOwner],
    );
    await adminQuery(
      `update users set created_at = ${ago(30)}, updated_at = ${ago(30)} where id = $1`,
      [active],
    );

    const counts = await app.get(RetentionService).run();

    expect(await deleted(oldHomework.fileId)).toBe(true);
    expect(await deleted(newHomework.fileId)).toBe(false);
    expect(await deleted(oldProof)).toBe(true);
    expect(await deleted(newProof)).toBe(false);
    await expect(
      app.get(FileStorage, { strict: false }).get(`available/${workspaceId}/${oldHomework.fileId}`),
    ).rejects.toThrow();
    // Scores stay when the files go.
    const [score] = await adminQuery<{ score: number }>(
      'select score_centi as score from homework_submissions where id = $1',
      [oldHomework.submission],
    );
    expect(score?.score).toBe(800);

    const sessions = await adminQuery<{ id: string }>(
      'select id from sessions where id in ($1, $2)',
      [oldSession, newSession],
    );
    expect(sessions.map((s) => s.id)).toEqual([newSession]);
    const notes = await adminQuery<{ type: string }>(
      `select type from notifications where recipient_user_id = $1 and type like 'retention.%'`,
      [studentUser],
    );
    expect(notes.map((n) => n.type)).toEqual(['retention.test_new']);
    const audit = await adminQuery<{ action: string }>(
      `select action from audit_log where workspace_id = $1 and action like 'retention.test%'`,
      [workspaceId],
    );
    expect(audit.map((a) => a.action)).toEqual(['retention.test_recent']);
    const [partition] = await adminQuery<{ exists: boolean }>(
      `select to_regclass('public.audit_log_2019_01') is not null as exists`,
    );
    expect(partition?.exists).toBe(false);

    const statuses = await adminQuery<{ id: string; status: string }>(
      'select id, status from users where id in ($1, $2, $3)',
      [idle, active, idleOwner],
    );
    expect(Object.fromEntries(statuses.map((s) => [s.id, s.status]))).toEqual({
      [idle]: 'anonymized',
      [active]: 'active',
      [idleOwner]: 'active',
    });

    expect(counts.homeworkFiles).toBeGreaterThanOrEqual(1);
    const [run] = await adminQuery<{ n: string }>(
      `select count(*) as n from audit_log where action = 'retention.run'`,
    );
    expect(Number(run?.n)).toBeGreaterThanOrEqual(1);
  });

  it('refuses a cutoff that would empty current logs', async () => {
    await expect(
      adminQuery(`select app.purge_expired_log_rows('audit_log', now())`),
    ).rejects.toThrow(/cutoff too recent/);
    await expect(
      adminQuery(`select app.purge_expired_log_rows('users', now() - interval '2 years')`),
    ).rejects.toThrow(/unsupported/);
  });
});
