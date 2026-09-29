import { expect, test } from '@playwright/test';
import { adminQuery, createWorkspace, signUp } from './fixtures';
import { latestOtp, randomPhone } from './support';

test('a student under 18 gets guardian consent by code (Arabic)', async ({ browser }) => {
  const teacherContext = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const studentContext = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const teacher = await signUp(teacherContext, { name: 'أ. رانيا فتحي', twoFactor: true });
  const student = await signUp(studentContext, { name: 'سلمى وليد' });
  const workspaceId = await createWorkspace(teacher.userId, 'أ. رانيا فتحي — لغة عربية');
  await adminQuery(
    `insert into memberships (workspace_id, id, user_id, role, status, created_at, updated_at)
     values ($1, gen_random_uuid(), $2, 'student', 'active', now(), now())`,
    [workspaceId, student.userId],
  );

  // The teacher sees the student in the missing-consent list.
  const teacherPage = await teacherContext.newPage();
  await teacherPage.goto(`/ar/w/${workspaceId}/students?consent=missing`);
  await expect(
    teacherPage.getByRole('button', { name: 'بدون موافقة ولي الأمر (1)' }),
  ).toBeVisible();
  await expect(teacherPage.getByText('تنتظر موافقة ولي الأمر')).toBeVisible();

  // The student is reminded on their account page and completes consent.
  const page = await studentContext.newPage();
  await page.goto('/ar/account');
  await page.getByRole('link', { name: 'مطلوب موافقة ولي الأمر. اضغط هنا لإكمالها.' }).click();
  await expect(page.getByRole('heading', { name: 'موافقة ولي الأمر' })).toBeVisible();

  const thirteen = `${String(new Date().getFullYear() - 13)}-04-12`;
  await page.getByLabel('تاريخ الميلاد').fill(thirteen);
  await page.getByLabel('رقم موبايل ولي الأمر').fill(student.phone);
  await page.getByRole('button', { name: 'حفظ' }).click();
  await expect(
    page.getByText('اكتب رقم ولي الأمر نفسه، وليس رقمك.', { exact: false }),
  ).toBeVisible();

  const guardian = randomPhone();
  await page.getByLabel('تاريخ الميلاد').fill(thirteen);
  await page.getByLabel('رقم موبايل ولي الأمر').fill(guardian);
  await page.getByRole('button', { name: 'حفظ' }).click();
  await page.getByRole('button', { name: 'إرسال الكود إلى ولي الأمر' }).click();
  await page.getByLabel('الكود').fill(await latestOtp(guardian, 'guardian_consent'));
  await page.getByRole('button', { name: 'تأكيد الموافقة' }).click();
  await expect(page.getByText('تم تسجيل موافقة ولي الأمر. شكرًا!')).toBeVisible();

  await teacherPage.reload();
  await expect(
    teacherPage.getByRole('button', { name: 'موافقة ولي الأمر', exact: true }),
  ).toBeVisible();

  await teacherContext.close();
  await studentContext.close();
});
