import { expect, test } from '@playwright/test';
import { createWorkspace, PASSWORD, signUp } from './fixtures';

test('a teacher invites a helper, who accepts and gets a permission (Arabic)', async ({
  browser,
}) => {
  const teacherContext = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const helperContext = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const teacher = await signUp(teacherContext, { name: 'أ. منى فؤاد', twoFactor: true });
  const helper = await signUp(helperContext, { name: 'سلمى حسن' });
  const workspaceId = await createWorkspace(teacher.userId, 'أ. منى فؤاد — أحياء');

  // The teacher invites the helper by phone and gets a link to share.
  const teacherPage = await teacherContext.newPage();
  await teacherPage.goto(`/ar/w/${workspaceId}/staff`);
  await expect(teacherPage.getByRole('heading', { name: 'الفريق', exact: true })).toBeVisible();
  await teacherPage.getByLabel('رقم الموبايل').fill(helper.phone);
  await teacherPage.getByRole('button', { name: 'إنشاء رابط الدعوة' }).click();
  const link = (await teacherPage.locator('p.font-mono').textContent())?.trim() ?? '';
  expect(link).toContain('/join/staff?w=');
  await expect(teacherPage.getByRole('link', { name: 'إرسال عبر واتساب' })).toHaveAttribute(
    'href',
    /^https:\/\/wa\.me\/\?text=/,
  );

  // The helper opens it signed out: signing in brings them back to accept.
  await helperContext.clearCookies({ name: 'lms_session' });
  const helperPage = await helperContext.newPage();
  await helperPage.goto(link);
  await expect(helperPage).toHaveURL(/\/ar\/login\?next=/);
  await helperPage.getByLabel('رقم الموبايل أو البريد الإلكتروني').fill(helper.phone);
  await helperPage.getByLabel('كلمة المرور').fill(PASSWORD);
  await helperPage.getByRole('button', { name: 'دخول' }).click();
  await expect(helperPage.getByText('بدور مساعد')).toBeVisible();
  await helperPage.getByRole('button', { name: 'قبول الدعوة' }).click();
  await expect(helperPage).toHaveURL(new RegExp(`/ar/w/${workspaceId}$`));
  await expect(helperPage.getByText('مساعد', { exact: true })).toBeVisible();

  // The teacher sees the new member and grants attendance.
  await teacherPage.reload();
  await expect(teacherPage.getByText('سلمى حسن')).toBeVisible();
  const attendance = teacherPage.getByRole('checkbox', { name: 'تسجيل الحضور' });
  await attendance.click(); // saved on the server, then shown as checked
  await expect(attendance).toBeChecked();
  await teacherPage.reload();
  await expect(teacherPage.getByRole('checkbox', { name: 'تسجيل الحضور' })).toBeChecked();

  await teacherContext.close();
  await helperContext.close();
});
