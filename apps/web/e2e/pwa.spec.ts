import { expect, test } from '@playwright/test';
import { adminQuery, createWorkspace, signUp } from './fixtures';

test('the app is installable and serves its service worker', async ({ request }) => {
  const manifest = await request.get('http://localhost:3100/manifest.webmanifest');
  expect(manifest.ok()).toBe(true);
  expect(await manifest.json()).toMatchObject({
    name: 'منصة المعلّم',
    display: 'standalone',
    start_url: '/ar',
  });
  const sw = await request.get('http://localhost:3100/sw.js');
  expect(sw.ok()).toBe(true);
  expect(sw.headers()['content-type']).toContain('javascript');
});

test('the attendance scanner reopens with no connection, after one visit online (REQ-ATT-001)', async ({
  browser,
}) => {
  const context = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const teacher = await signUp(context, { name: 'أ. نهى صبري', twoFactor: true });
  const workspaceId = await createWorkspace(teacher.userId, 'أ. نهى صبري — تاريخ');
  const student = await signUp(await browser.newContext({ baseURL: 'http://localhost:3100' }), {
    name: 'آدم رشاد',
  });
  const [row] = await adminQuery<{ membership: string; code: string }>(
    `with m as (
       insert into memberships (workspace_id, id, user_id, role, status, created_at, updated_at)
       values ($1, gen_random_uuid(), $2, 'student', 'active', now(), now()) returning id)
     select m.id as membership, u.platform_code as code from m, users u where u.id = $2`,
    [workspaceId, student.userId],
  );
  const [cls] = await adminQuery<{ id: string }>(
    `insert into classes (workspace_id, id, name, responsible_membership_id, created_at, updated_at)
     values ($1, gen_random_uuid(), 'مجموعة الأحد',
             (select id from memberships where workspace_id = $1 and role = 'owner'), now(), now())
     returning id`,
    [workspaceId],
  );
  await adminQuery(
    `insert into class_enrollments (workspace_id, id, class_id, membership_id, enrolled_at, enrolled_by)
     values ($1, gen_random_uuid(), $2, $3, now(), $4)`,
    [workspaceId, cls?.id, row?.membership, teacher.userId],
  );
  const [session] = await adminQuery<{ id: string }>(
    `insert into class_sessions (workspace_id, id, class_id, local_date, starts_at, ends_at, created_at)
     values ($1, gen_random_uuid(), $2, current_date, now(), now() + interval '2 hours', now())
     returning id`,
    [workspaceId, cls?.id],
  );

  const page = await context.newPage();
  const url = `/ar/w/${workspaceId}/sessions/${session?.id}/scan`;
  await page.goto(url);
  // The first visit installs the worker; the next one goes through it and is kept.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'مسح أكواد الحضور' })).toBeVisible();
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'مسح أكواد الحضور' })).toBeVisible();
  const code = page.getByLabel('كود الطالب');
  await code.fill(`lms:${row?.code ?? ''}`);
  await page.getByRole('button', { name: 'تسجيل' }).click();
  await expect(page.getByText('حاضر ✓')).toBeVisible();
  await context.setOffline(false);
  await context.close();
});

test('no notification prompt on first load; the notifications page offers it only when the server can push', async ({
  browser,
}) => {
  const context = await browser.newContext({ baseURL: 'http://localhost:3100' });
  await signUp(context, { name: 'سلمى عادل' });
  const page = await context.newPage();
  await page.goto('/ar/notifications');
  await expect(page.getByRole('heading', { name: 'الإشعارات' })).toBeVisible();
  // Push isn't configured for the browser tests, so nothing is offered, and nothing is asked.
  await expect(page.getByRole('button', { name: 'تفعيل الإشعارات' })).toHaveCount(0);
  expect(await page.evaluate(() => Notification.permission)).not.toBe('granted');
  await context.close();
});
