import { expect, test } from '@playwright/test';
import { adminQuery, createWorkspace, signUp } from './fixtures';

test('the owner records a cash payment and the student sees the receipt (Arabic)', async ({
  browser,
}) => {
  const teacherContext = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const studentContext = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const teacher = await signUp(teacherContext, { name: 'أ. رامي نصر', twoFactor: true });
  const student = await signUp(studentContext, { name: 'دينا شريف' });
  const workspaceId = await createWorkspace(teacher.userId, 'أ. رامي نصر — رياضيات');
  await adminQuery(
    `insert into memberships (workspace_id, id, user_id, role, status, created_at, updated_at)
     values ($1, gen_random_uuid(), $2, 'student', 'active', now(), now())`,
    [workspaceId, student.userId],
  );
  await adminQuery(
    `insert into price_items (workspace_id, id, name, amount_piastres, created_at, updated_at)
     values ($1, gen_random_uuid(), 'اشتراك شهري', 30000, now(), now())`,
    [workspaceId],
  );

  const page = await teacherContext.newPage();
  await page.goto(`/ar/w/${workspaceId}/payments`);
  await page.getByLabel('ابحث عن الطالب بالاسم أو الكود').fill('دينا');
  await page.getByRole('button', { name: /دينا شريف/ }).click();
  await page.getByLabel('البند').selectOption({ index: 1 }); // the price item
  await expect(page.getByLabel('المبلغ المستلم بالجنيه')).toHaveValue('300');
  await page.getByLabel('المبلغ المستلم بالجنيه').fill('250');
  await page.getByRole('button', { name: 'تسجيل الدفعة' }).click();
  await expect(page.getByText('تم التسجيل: إيصال رقم 1.')).toBeVisible();
  await expect(page.getByText('إيصال 1 · دينا شريف')).toBeVisible();

  const studentPage = await studentContext.newPage();
  await studentPage.goto(`/ar/w/${workspaceId}/my-payments`);
  await studentPage.getByRole('link', { name: /إيصال 1/ }).click();
  await expect(studentPage.getByRole('heading', { name: /إيصال استلام/ })).toBeVisible();
  await expect(studentPage.getByText('اشتراك شهري')).toBeVisible();
  await expect(studentPage.getByText('أ. رامي نصر', { exact: true })).toBeVisible();

  await teacherContext.close();
  await studentContext.close();
});
