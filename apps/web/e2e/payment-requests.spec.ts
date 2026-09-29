import { expect, test } from '@playwright/test';
import { adminQuery, createWorkspace, signUp } from './fixtures';

test('a student reports a wallet payment and the owner approves it (Arabic)', async ({
  browser,
}) => {
  const teacherContext = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const studentContext = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const teacher = await signUp(teacherContext, { name: 'أ. شادي منير', twoFactor: true });
  const student = await signUp(studentContext, { name: 'روان هشام' });
  const workspaceId = await createWorkspace(teacher.userId, 'أ. شادي منير — أحياء');
  await adminQuery(
    `insert into memberships (workspace_id, id, user_id, role, status, created_at, updated_at)
     values ($1, gen_random_uuid(), $2, 'student', 'active', now(), now())`,
    [workspaceId, student.userId],
  );

  const studentPage = await studentContext.newPage();
  await studentPage.goto(`/ar/w/${workspaceId}/my-payments`);
  await studentPage.getByLabel('المبلغ بالجنيه').fill('200');
  await studentPage.getByLabel('رقم العملية').fill('VF-998877');
  await studentPage.getByRole('button', { name: 'إرسال الطلب' }).click();
  await expect(studentPage.getByText('قيد المراجعة')).toBeVisible();

  const teacherPage = await teacherContext.newPage();
  await teacherPage.goto(`/ar/w/${workspaceId}/payments`);
  await expect(teacherPage.getByText('طلبات دفع للمراجعة (1)')).toBeVisible();
  await teacherPage.getByRole('button', { name: 'قبول وإصدار إيصال' }).click();
  await expect(teacherPage.getByText('إيصال 1 · روان هشام')).toBeVisible();

  await studentPage.reload();
  await expect(studentPage.getByText('تم القبول')).toBeVisible();
  await expect(studentPage.getByRole('link', { name: /إيصال 1/ })).toBeVisible();
  await teacherContext.close();
  await studentContext.close();
});
