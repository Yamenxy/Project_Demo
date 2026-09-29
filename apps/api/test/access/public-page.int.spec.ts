import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminQuery, insertMembership, insertUser, insertWorkspace } from '../support/fixtures';
import { createIntegrationApp } from '../support/integration-app';
import { signIn } from '../support/sessions';

let app: NestFastifyApplication;

type PageJson = { slug: string; name: string; bio: string | null; subjects: string[] };

async function workspace() {
  const owner = await insertUser();
  const workspaceId = await insertWorkspace(owner);
  const [row] = await adminQuery<{ slug: string }>('select slug from workspaces where id = $1', [
    workspaceId,
  ]);
  return {
    owner,
    workspaceId,
    slug: row?.slug ?? '',
    ownerToken: await signIn(app, owner, { twoFactor: true }),
  };
}

function update(workspaceId: string, token: string, payload: object) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/w/${workspaceId}/public-page`,
    cookies: { lms_session: token },
    payload,
  });
}

beforeAll(async () => {
  app = await createIntegrationApp();
});

afterAll(async () => {
  await app.close();
});

describe('public teacher page (REQ-CONTENT-003)', () => {
  it('shows what the owner wrote, without signing in, and nothing personal', async () => {
    const w = await workspace();
    await insertMembership(w.workspaceId, await insertUser(), 'student');
    const saved = await update(w.workspaceId, w.ownerToken, {
      bio: 'مدرس فيزياء للثانوية العامة منذ 10 سنوات.',
      subjects: ['فيزياء', 'ميكانيكا'],
    });
    expect(saved.json()).toMatchObject({
      slug: w.slug,
      enabled: true,
      subjects: ['فيزياء', 'ميكانيكا'],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/public/teachers/${w.slug.toUpperCase()}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-cache'); // hiding the page takes effect at once
    const page = res.json<PageJson>();
    expect(page).toEqual({
      slug: w.slug,
      name: 'مساحة تجريبية',
      bio: 'مدرس فيزياء للثانوية العامة منذ 10 سنوات.',
      subjects: ['فيزياء', 'ميكانيكا'],
    });
    const text = res.body;
    expect(text).not.toMatch(/\+20\d+/);
    expect(text).not.toContain(w.owner);
    expect(text).not.toContain('join');

    const audit = await adminQuery<{ action: string }>(
      `select action from audit_log where workspace_id = $1 and action = 'workspace.public_page_changed'`,
      [w.workspaceId],
    );
    expect(audit).toHaveLength(1);
  });

  it('is hidden when turned off, when the workspace is suspended, or when the slug is unknown', async () => {
    const w = await workspace();
    const get = async (slug: string) =>
      (await app.inject({ method: 'GET', url: `/api/v1/public/teachers/${slug}` })).statusCode;
    expect(await get(w.slug)).toBe(200);
    await update(w.workspaceId, w.ownerToken, { enabled: false });
    expect(await get(w.slug)).toBe(404);
    await update(w.workspaceId, w.ownerToken, { enabled: true });
    await adminQuery(
      `update workspaces set suspended_at = now(), suspension_reason = 'admin' where id = $1`,
      [w.workspaceId],
    );
    expect(await get(w.slug)).toBe(404);
    expect(await get('no-such-teacher')).toBe(404);
    expect(await get('bad_slug!')).toBe(400);
  });

  it('only the owner edits it', async () => {
    const w = await workspace();
    const helper = await insertUser();
    await insertMembership(w.workspaceId, helper, 'assistant');
    const res = await update(w.workspaceId, await signIn(app, helper), { bio: 'x' });
    expect(res.statusCode).toBe(403);
  });

  it('students join from the page by slug', async () => {
    const w = await workspace();
    const token = await signIn(app, await insertUser());
    const joined = await app.inject({
      method: 'POST',
      url: '/api/v1/join',
      cookies: { lms_session: token },
      payload: { slug: w.slug },
    });
    expect(joined.json()).toMatchObject({ workspaceId: w.workspaceId, status: 'pending' });
  });
});
