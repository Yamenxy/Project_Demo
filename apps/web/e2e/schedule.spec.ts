import { expect, test } from '@playwright/test';
import { createWorkspace, signUp } from './fixtures';

test('a teacher adds a weekly time and sees the sessions on the schedule (Arabic)', async ({
  browser,
}) => {
  const context = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const teacher = await signUp(context, { name: 'أ. وليد صبري', twoFactor: true });
  const workspaceId = await createWorkspace(teacher.userId, 'أ. وليد صبري — لغة إنجليزية');

  const page = await context.newPage();
  await page.goto(`/ar/w/${workspaceId}/classes`);
  await page.getByLabel('اسم الفصل').fill('مجموعة السبت');
  await page.getByRole('button', { name: 'إنشاء' }).click();
  await page.getByRole('link', { name: /مجموعة السبت/ }).click();
  await expect(page.getByText('لا توجد مواعيد أسبوعية بعد.')).toBeVisible();

  // Defaults: Saturday, 17:00, 120 minutes, starting today.
  await page.getByRole('button', { name: 'إضافة موعد أسبوعي' }).click();
  await expect(page.getByText('كل السبت الساعة 17:00 لمدة 120 دقيقة')).toBeVisible();
  await expect(page.getByRole('button', { name: 'إلغاء الحصة' }).first()).toBeVisible();

  await page.goto(`/ar/w/${workspaceId}/schedule`);
  await expect(page.getByRole('heading', { name: 'المواعيد — أسبوعان' })).toBeVisible();
  await expect(page.getByText('مجموعة السبت').first()).toBeVisible();
  await context.close();
});
