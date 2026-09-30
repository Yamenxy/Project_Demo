import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FilesService } from '../../src/modules/files';
import {
  adminQuery,
  grantConsent,
  insertMembership,
  insertUser,
  insertWorkspace,
} from '../support/fixtures';
import { createIntegrationApp } from '../support/integration-app';
import { signIn } from '../support/sessions';

let app: NestFastifyApplication;

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fake image body'),
]);
const HTML = Buffer.from('<html><script>alert(1)</script></html>');

type FileJson = { id: string; status: string; contentType: string };

function upload(url: string, token: string, data: Buffer) {
  return app.inject({
    method: 'POST',
    url,
    cookies: { lms_session: token },
    headers: { 'content-type': 'application/octet-stream' },
    payload: data,
  });
}

function get(url: string, token: string) {
  return app.inject({ method: 'GET', url, cookies: { lms_session: token } });
}

async function setup() {
  const owner = await insertUser();
  const workspaceId = await insertWorkspace(owner);
  const ownerToken = await signIn(app, owner, { twoFactor: true });
  const w = `/api/v1/w/${workspaceId}`;
  const [course] = await adminQuery<{ id: string }>(
    `insert into courses (workspace_id, id, title, created_at, updated_at)
     values ($1, gen_random_uuid(), 'مقرر', now(), now()) returning id`,
    [workspaceId],
  );
  const [lesson] = await adminQuery<{ id: string }>(
    `insert into lessons (workspace_id, id, course_id, title, position, published_at, created_at, updated_at)
     values ($1, gen_random_uuid(), $2, 'درس', 0, now(), now(), now()) returning id`,
    [workspaceId, course?.id],
  );
  const studentUser = await insertUser();
  const student = await insertMembership(workspaceId, studentUser, 'student');
  await grantConsent(studentUser);
  const studentToken = await signIn(app, studentUser);
  return { owner, workspaceId, ownerToken, w, lessonId: lesson?.id ?? '', student, studentToken };
}

beforeAll(async () => {
  app = await createIntegrationApp();
});

afterAll(async () => {
  await app.close();
});

describe('files (REQ-FILE-001)', () => {
  it('a lesson file waits in quarantine, then is served only through AccessPolicy', async () => {
    const s = await setup();
    const res = await upload(
      `${s.w}/lessons/${s.lessonId}/files?name=${encodeURIComponent('ملخص.pdf')}`,
      s.ownerToken,
      PDF,
    );
    expect(res.statusCode).toBe(201);
    const file = res.json<FileJson>();
    expect(file.status).toBe('quarantine');
    expect((await get(`${s.w}/files/${file.id}`, s.ownerToken)).statusCode).toBe(404);

    await app.get(FilesService).scan(s.workspaceId, file.id);
    const staff = await get(`${s.w}/files/${file.id}`, s.ownerToken);
    expect(staff.statusCode).toBe(200);
    expect(staff.headers['content-type']).toBe('application/pdf');
    expect(staff.headers['content-disposition']).toMatch(/^attachment; filename\*=UTF-8''/);
    expect(staff.headers['x-content-type-options']).toBe('nosniff');
    expect(staff.rawPayload.equals(PDF)).toBe(true);

    // The student has no access yet; a grant opens it.
    expect((await get(`${s.w}/files/${file.id}`, s.studentToken)).statusCode).toBe(403);
    expect((await get(`${s.w}/lessons/${s.lessonId}/files`, s.studentToken)).statusCode).toBe(403);
    await app.inject({
      method: 'POST',
      url: `${s.w}/access/rules`,
      cookies: { lms_session: s.ownerToken },
      payload: { membershipIds: [s.student], lessonIds: [s.lessonId], rule: 'grant' },
    });
    expect((await get(`${s.w}/files/${file.id}`, s.studentToken)).statusCode).toBe(200);
    const list = (await get(`${s.w}/lessons/${s.lessonId}/files`, s.studentToken)).json<{
      files: FileJson[];
    }>();
    expect(list.files.map((f) => f.id)).toEqual([file.id]);
  });

  it('rejects files whose bytes are not an allowed type, whatever the name', async () => {
    const s = await setup();
    const file = (
      await upload(`${s.w}/lessons/${s.lessonId}/files?name=notes.pdf`, s.ownerToken, HTML)
    ).json<FileJson>();
    await app.get(FilesService).scan(s.workspaceId, file.id);
    const [row] = await adminQuery<{ status: string; reason: string }>(
      'select status, reject_reason as reason from files where id = $1',
      [file.id],
    );
    expect(row).toEqual({ status: 'rejected', reason: 'type_not_allowed' });
    expect((await get(`${s.w}/files/${file.id}`, s.ownerToken)).statusCode).toBe(404);
    // Students never upload lesson files; JSON bodies are refused.
    expect(
      (await upload(`${s.w}/lessons/${s.lessonId}/files?name=a.pdf`, s.studentToken, PDF))
        .statusCode,
    ).toBe(403);
    const json = await app.inject({
      method: 'POST',
      url: `${s.w}/lessons/${s.lessonId}/files?name=a.pdf`,
      cookies: { lms_session: s.ownerToken },
      payload: { not: 'a file' },
    });
    expect(json.statusCode).toBe(415);
  });

  it('payment proofs: the student adds one to their pending request; only confirmers see it', async () => {
    const s = await setup();
    const request = (
      await app.inject({
        method: 'POST',
        url: `${s.w}/my/payment-requests`,
        cookies: { lms_session: s.studentToken },
        payload: { amountPiastres: 10000, method: 'wallet', reference: 'VF-1' },
      })
    ).json<{ id: string }>().id;
    const proof = (
      await upload(`${s.w}/payment-requests/${request}/files?name=proof.png`, s.studentToken, PNG)
    ).json<FileJson>();
    await app.get(FilesService).scan(s.workspaceId, proof.id);
    const shown = await get(`${s.w}/files/${proof.id}`, s.ownerToken);
    expect(shown.statusCode).toBe(200);
    expect(shown.headers['content-disposition']).toMatch(/^inline/);
    expect((await get(`${s.w}/files/${proof.id}`, s.studentToken)).statusCode).toBe(200);

    const helper = await insertUser();
    await insertMembership(s.workspaceId, helper, 'assistant');
    expect((await get(`${s.w}/files/${proof.id}`, await signIn(app, helper))).statusCode).toBe(404);
    // A PDF isn't accepted as a proof.
    const pdfProof = (
      await upload(`${s.w}/payment-requests/${request}/files?name=p.pdf`, s.studentToken, PDF)
    ).json<FileJson>();
    await app.get(FilesService).scan(s.workspaceId, pdfProof.id);
    const [row] = await adminQuery<{ status: string }>('select status from files where id = $1', [
      pdfProof.id,
    ]);
    expect(row?.status).toBe('rejected');
  });

  it('a student without guardian consent yet cannot upload (REQ-PRIV-001)', async () => {
    const s = await setup();
    const minorUser = await insertUser();
    await insertMembership(s.workspaceId, minorUser, 'student');
    const token = await signIn(app, minorUser);
    const request = (
      await app.inject({
        method: 'POST',
        url: `${s.w}/my/payment-requests`,
        cookies: { lms_session: token },
        payload: { amountPiastres: 10000, method: 'wallet', reference: 'VF-2' },
      })
    ).json<{ id: string }>().id;
    const refused = await upload(`${s.w}/payment-requests/${request}/files?name=p.png`, token, PNG);
    expect(refused.statusCode).toBe(403);
    expect(refused.json<{ error: { code: string } }>().error.code).toBe('consent_required');
    const [n] = await adminQuery<{ n: string }>(
      'select count(*) as n from files where owner_id = $1',
      [request],
    );
    expect(n?.n).toBe('0');
  });
});
