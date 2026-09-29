import { execFile } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import { adminQuery, createWorkspace, signUp } from './fixtures';

const run = promisify(execFile);

test('a student with access plays the lesson video through HLS, with a watermark', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const dir = await mkdtemp(path.join(tmpdir(), 'lms-e2e-video-'));
  const file = path.join(dir, 'clip.mp4');
  await run(process.env.FFMPEG_PATH ?? 'ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc=duration=4:size=640x360:rate=24',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    file,
  ]);

  const teacherContext = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const studentContext = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const teacher = await signUp(teacherContext, { name: 'أ. طارق سليم', twoFactor: true });
  const student = await signUp(studentContext, { name: 'جنى مراد' });
  const workspaceId = await createWorkspace(teacher.userId, 'أ. طارق سليم — فيزياء');
  const [member] = await adminQuery<{ id: string }>(
    `insert into memberships (workspace_id, id, user_id, role, status, created_at, updated_at)
     values ($1, gen_random_uuid(), $2, 'student', 'active', now(), now()) returning id`,
    [workspaceId, student.userId],
  );
  const [course] = await adminQuery<{ id: string }>(
    `insert into courses (workspace_id, id, title, created_at, updated_at)
     values ($1, gen_random_uuid(), 'فيزياء', now(), now()) returning id`,
    [workspaceId],
  );
  const [lesson] = await adminQuery<{ id: string }>(
    `insert into lessons (workspace_id, id, course_id, title, position, published_at, created_at, updated_at)
     values ($1, gen_random_uuid(), $2, 'تجربة الفيديو', 0, now(), now(), now()) returning id`,
    [workspaceId, course?.id],
  );
  await adminQuery(
    `insert into lesson_rules (workspace_id, membership_id, lesson_id, kind, set_by, set_at)
     values ($1, $2, $3, 'grant', $4, now())`,
    [workspaceId, member?.id, lesson?.id, teacher.userId],
  );
  const uploaded = await teacherContext.request.post(
    `/api/v1/w/${workspaceId}/lessons/${lesson?.id ?? ''}/video`,
    { headers: { 'content-type': 'application/octet-stream' }, data: await readFile(file) },
  );
  expect(uploaded.status()).toBe(201);
  // The transcode job runs in the API process.
  await expect(async () => {
    const [row] = await adminQuery<{ status: string }>(
      'select status from lesson_videos where lesson_id = $1',
      [lesson?.id],
    );
    expect(row?.status).toBe('ready');
  }).toPass({ timeout: 60_000 });

  const page = await studentContext.newPage();
  const segment = page.waitForResponse((r) => /\/240p_000\.ts\?t=/.test(r.url()));
  await page.goto(`/ar/w/${workspaceId}/lessons/${lesson?.id ?? ''}`);
  expect((await segment).status()).toBe(200);
  const [code] = await adminQuery<{ code: string }>(
    'select platform_code as code from users where id = $1',
    [student.userId],
  );
  await expect(page.getByText(code?.code ?? 'missing', { exact: false })).toBeVisible();
  await expect(page.getByLabel('الجودة:')).toBeVisible();

  await teacherContext.close();
  await studentContext.close();
});
