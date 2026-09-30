import { expect, test } from '@playwright/test';
import { adminQuery, createWorkspace, signUp } from './fixtures';

test('an owner posts an announcement and the student is notified through the queue', async ({
  browser,
}) => {
  const teacherContext = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const studentContext = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const teacher = await signUp(teacherContext, { name: 'أ. رانيا فؤاد', twoFactor: true });
  const student = await signUp(studentContext, { name: 'مازن خليل' });
  const workspaceId = await createWorkspace(teacher.userId, 'أ. رانيا فؤاد — أحياء');
  await adminQuery(
    `insert into memberships (workspace_id, id, user_id, role, status, created_at, updated_at)
     values ($1, gen_random_uuid(), $2, 'student', 'active', now(), now())`,
    [workspaceId, student.userId],
  );

  const page = await teacherContext.newPage();
  await page.goto(`/ar/w/${workspaceId}/announcements`);
  await page.getByLabel('العنوان').fill('مراجعة ليلة الامتحان');
  await page.getByLabel('نص الإعلان').fill('المراجعة يوم الخميس الساعة 7 مساءً.');
  await page.getByRole('button', { name: 'نشر الإعلان' }).click();
  await expect(page.getByRole('status')).toHaveText('يُرسل الإعلان إلى طالب واحد.');

  const studentPage = await studentContext.newPage();
  // The queue writes the notification a moment later.
  await expect(async () => {
    await studentPage.goto('/ar/notifications');
    await expect(studentPage.getByText('إعلان جديد: «مراجعة ليلة الامتحان».')).toBeVisible({
      timeout: 1000,
    });
  }).toPass({ timeout: 20_000 });
  await studentPage.goto(`/ar/w/${workspaceId}/announcements`);
  await expect(studentPage.getByText('المراجعة يوم الخميس الساعة 7 مساءً.')).toBeVisible();
  await teacherContext.close();
  await studentContext.close();
});
