import { execFile } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VideoService } from '../../src/modules/video';
import { adminQuery, insertMembership, insertUser, insertWorkspace } from '../support/fixtures';
import { createIntegrationApp } from '../support/integration-app';
import { signIn } from '../support/sessions';

const run = promisify(execFile);
let app: NestFastifyApplication;
let clip: Buffer;

type ErrorJson = { error: { code: string } };
type Playback = { token: string; playlist: string; videoId: string };

function call(method: 'GET' | 'POST', url: string, token: string, payload?: object) {
  return app.inject({
    method,
    url,
    cookies: { lms_session: token },
    ...(payload ? { payload } : {}),
  });
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
     values ($1, gen_random_uuid(), $2, 'درس بالفيديو', 0, now(), now(), now()) returning id`,
    [workspaceId, course?.id],
  );
  const lessonId = lesson?.id ?? '';
  const studentUser = await insertUser();
  const student = await insertMembership(workspaceId, studentUser, 'student');
  const studentToken = await signIn(app, studentUser);
  const uploaded = await app.inject({
    method: 'POST',
    url: `${w}/lessons/${lessonId}/video`,
    cookies: { lms_session: ownerToken },
    headers: { 'content-type': 'application/octet-stream' },
    payload: clip,
  });
  expect(uploaded.statusCode).toBe(201);
  const videoId = uploaded.json<{ id: string }>().id;
  await app.get(VideoService).transcode(workspaceId, videoId);
  return {
    owner,
    workspaceId,
    ownerToken,
    w,
    lessonId,
    student,
    studentUser,
    studentToken,
    videoId,
  };
}

beforeAll(async () => {
  // A 3-second test clip with sound, made by ffmpeg itself.
  const dir = await mkdtemp(path.join(tmpdir(), 'lms-video-'));
  const file = path.join(dir, 'clip.mp4');
  await run(process.env.FFMPEG_PATH ?? 'ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc=duration=3:size=640x360:rate=24',
    '-f',
    'lavfi',
    '-i',
    'sine=duration=3',
    '-shortest',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    file,
  ]);
  clip = await readFile(file);
  app = await createIntegrationApp();
}, 60_000);

afterAll(async () => {
  await app.close();
});

describe('self-hls video (REQ-VIDEO-001, -003, -005)', () => {
  it('transcodes to HLS renditions and serves them only with a session-bound token', async () => {
    const s = await setup();
    const info = (await call('GET', `${s.w}/lessons/${s.lessonId}/video`, s.ownerToken)).json<{
      video: { status: string; durationSeconds: number };
    }>();
    expect(info.video).toMatchObject({ status: 'ready', durationSeconds: 3 });

    // No access yet: no token.
    expect(
      (await call('POST', `${s.w}/lessons/${s.lessonId}/playback`, s.studentToken)).statusCode,
    ).toBe(403);
    await call('POST', `${s.w}/access/rules`, s.ownerToken, {
      membershipIds: [s.student],
      lessonIds: [s.lessonId],
      rule: 'grant',
    });
    const playback = (
      await call('POST', `${s.w}/lessons/${s.lessonId}/playback`, s.studentToken)
    ).json<Playback>();
    const master = await call('GET', playback.playlist, s.studentToken);
    expect(master.statusCode).toBe(200);
    expect(master.headers['content-type']).toBe('application/vnd.apple.mpegurl');
    expect(master.body).toContain(`240p.m3u8?t=${playback.token}`);
    expect(master.body).toContain(`480p.m3u8?t=${playback.token}`);
    const variant = await call(
      'GET',
      `${s.w}/video/${s.videoId}/240p.m3u8?t=${playback.token}`,
      s.studentToken,
    );
    const segment = variant.body.split('\n').find((line) => line.endsWith(`?t=${playback.token}`));
    expect(segment).toMatch(/^240p_\d{3}\.ts\?t=/);
    const bytes = await call('GET', `${s.w}/video/${s.videoId}/${segment ?? ''}`, s.studentToken);
    expect(bytes.statusCode).toBe(200);
    expect(bytes.headers['content-type']).toBe('video/mp2t');

    // Without the token, with a forged one, or from another session: refused.
    const bare = await call('GET', `${s.w}/video/${s.videoId}/240p.m3u8`, s.studentToken);
    expect(bare.json<ErrorJson>().error.code).toBe('invalid_playback_token');
    const forged = await call(
      'GET',
      `${s.w}/video/${s.videoId}/240p.m3u8?t=${playback.token}x`,
      s.studentToken,
    );
    expect(forged.json<ErrorJson>().error.code).toBe('invalid_playback_token');
    const otherSession = await signIn(app, s.studentUser);
    const stolen = await call('GET', playback.playlist, otherSession);
    expect(stolen.json<ErrorJson>().error.code).toBe('invalid_playback_token');
    // Paths outside the output folder are refused.
    const escape = await call(
      'GET',
      `${s.w}/video/${s.videoId}/..%2Fsecret?t=${playback.token}`,
      s.studentToken,
    );
    expect(escape.statusCode).toBe(404);

    // A revoked student is stopped at the next playlist.
    await call('POST', `${s.w}/access/pause`, s.ownerToken, {
      membershipIds: [s.student],
      paused: true,
    });
    expect((await call('GET', playback.playlist, s.studentToken)).statusCode).toBe(403);
  });

  it('enforces the view limit by watch time, and staff can reset it', async () => {
    const s = await setup();
    await call('POST', `${s.w}/access/rules`, s.ownerToken, {
      membershipIds: [s.student],
      lessonIds: [s.lessonId],
      rule: 'grant',
    });
    await call('POST', `${s.w}/lessons/${s.lessonId}/video/limit`, s.ownerToken, {
      limitMinutes: 1,
    });
    const first = (
      await call('POST', `${s.w}/lessons/${s.lessonId}/playback`, s.studentToken)
    ).json<Playback>();
    for (let i = 0; i < 2; i++) {
      await call('POST', `${s.w}/video/${first.videoId}/progress`, s.studentToken, { seconds: 30 });
    }
    const limited = await call('POST', `${s.w}/lessons/${s.lessonId}/playback`, s.studentToken);
    expect(limited.json<ErrorJson>().error.code).toBe('view_limit_reached');
    // Staff aren't limited.
    expect(
      (await call('POST', `${s.w}/lessons/${s.lessonId}/playback`, s.ownerToken)).statusCode,
    ).toBe(200);
    await call('POST', `${s.w}/lessons/${s.lessonId}/video/reset/${s.student}`, s.ownerToken);
    expect(
      (await call('POST', `${s.w}/lessons/${s.lessonId}/playback`, s.studentToken)).statusCode,
    ).toBe(200);
  });

  it('marks a file that is not a video as failed', async () => {
    const owner = await insertUser();
    const workspaceId = await insertWorkspace(owner);
    const token = await signIn(app, owner, { twoFactor: true });
    const [course] = await adminQuery<{ id: string }>(
      `insert into courses (workspace_id, id, title, created_at, updated_at)
       values ($1, gen_random_uuid(), 'مقرر', now(), now()) returning id`,
      [workspaceId],
    );
    const [lesson] = await adminQuery<{ id: string }>(
      `insert into lessons (workspace_id, id, course_id, title, position, created_at, updated_at)
       values ($1, gen_random_uuid(), $2, 'درس', 0, now(), now()) returning id`,
      [workspaceId, course?.id],
    );
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/w/${workspaceId}/lessons/${lesson?.id ?? ''}/video`,
      cookies: { lms_session: token },
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from('not a video at all'),
    });
    const id = res.json<{ id: string }>().id;
    await app.get(VideoService).transcode(workspaceId, id);
    const [row] = await adminQuery<{ status: string }>(
      'select status from lesson_videos where id = $1',
      [id],
    );
    expect(row?.status).toBe('failed');
  });
});
