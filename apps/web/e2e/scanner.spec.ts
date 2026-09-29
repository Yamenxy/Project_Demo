import { expect, test } from '@playwright/test';
import { adminQuery, createWorkspace, signUp } from './fixtures';

test('scanning works offline and syncs on reconnect without duplicates (Arabic)', async ({
  browser,
}) => {
  const context = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const teacher = await signUp(context, { name: 'أ. حازم طه', twoFactor: true });
  const workspaceId = await createWorkspace(teacher.userId, 'أ. حازم طه — جغرافيا');
  const student = await signUp(await browser.newContext({ baseURL: 'http://localhost:3100' }), {
    name: 'ملك سامح',
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
     values ($1, gen_random_uuid(), 'مجموعة المسح',
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
  await page.goto(`/ar/w/${workspaceId}/sessions/${session?.id}/scan`);
  await expect(page.getByRole('heading', { name: 'مسح أكواد الحضور' })).toBeVisible();
  await expect(page.getByText('متصل', { exact: false }).first()).toBeVisible();

  // The connection drops; the roster is already on the device.
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  const code = page.getByLabel('كود الطالب');
  await code.fill('ZZZZ2222');
  await page.getByRole('button', { name: 'تسجيل' }).click();
  await expect(page.getByText('كود غير معروف')).toBeVisible();
  for (let i = 0; i < 3; i++) {
    await code.fill(`lms:${row?.code ?? ''}`);
    await page.getByRole('button', { name: 'تسجيل' }).click();
  }
  await expect(page.getByText('حاضر ✓')).toBeVisible();
  await expect(page.getByText('1 بانتظار الرفع', { exact: false })).toBeVisible();

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByText('تم رفع 1', { exact: false })).toBeVisible();

  const [count] = await adminQuery<{ n: string; status: string }>(
    `select count(*) as n, max(status) as status from attendance_records where session_id = $1`,
    [session?.id],
  );
  expect(count).toEqual({ n: '1', status: 'present' });
  await context.close();
});
