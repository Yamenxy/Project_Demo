import { expect, test } from '@playwright/test';
import { createWorkspace, signUp } from './fixtures';

test('the owner writes a course with lessons and publishes one (Arabic)', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const teacher = await signUp(context, { name: 'أ. هالة عمر', twoFactor: true });
  const workspaceId = await createWorkspace(teacher.userId, 'أ. هالة عمر — أحياء');

  const page = await context.newPage();
  await page.goto(`/ar/w/${workspaceId}/courses`);
  await page.getByLabel('اسم المقرر').fill('أحياء — الترم الأول');
  await page.getByRole('button', { name: 'إنشاء' }).click();
  await page.getByRole('link', { name: /أحياء — الترم الأول/ }).click();
  await expect(page.getByRole('heading', { name: 'أحياء — الترم الأول' })).toBeVisible();

  await page.getByLabel('عنوان الدرس').fill('الخلية');
  await page.getByRole('button', { name: 'إضافة' }).click();
  await expect(page.getByText('الخلية', { exact: true })).toBeVisible();
  await expect(page.getByText('مسودة')).toBeVisible();
  await page.getByRole('button', { name: 'نشر' }).click();
  await expect(page.getByText('منشور')).toBeVisible();
  await context.close();
});
