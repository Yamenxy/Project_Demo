import { expect, test } from '@playwright/test';
import { adminQuery, createWorkspace, signUp } from './fixtures';

test('a teacher creates a class and adds a student (Arabic)', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const teacher = await signUp(context, { name: 'أ. نادر حلمي', twoFactor: true });
  const workspaceId = await createWorkspace(teacher.userId, 'أ. نادر حلمي — تاريخ');
  const student = await signUp(await browser.newContext({ baseURL: 'http://localhost:3100' }), {
    name: 'هنا مجدي',
  });
  await adminQuery(
    `insert into memberships (workspace_id, id, user_id, role, status, created_at, updated_at)
     values ($1, gen_random_uuid(), $2, 'student', 'active', now(), now())`,
    [workspaceId, student.userId],
  );

  const page = await context.newPage();
  await page.goto(`/ar/w/${workspaceId}/classes`);
  await expect(page.getByText('لا توجد فصول بعد.')).toBeVisible();
  await page.getByLabel('اسم الفصل').fill('الصف الثاني الثانوي — السبت');
  await page.getByRole('button', { name: 'إنشاء' }).click();
  await page.getByRole('link', { name: /الصف الثاني الثانوي — السبت/ }).click();
  await expect(page.getByRole('heading', { name: 'الصف الثاني الثانوي — السبت' })).toBeVisible();

  await page.getByLabel('ابحث باسم الطالب أو الكود أو الرقم').fill('هنا');
  await page.getByRole('button', { name: 'إضافة', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'طالب واحد' })).toBeVisible();
  await expect(page.getByText('هنا مجدي')).toBeVisible();

  await page.getByRole('link', { name: 'كل الفصول' }).click();
  await expect(page.getByText('طالب واحد')).toBeVisible();
  await context.close();
});
