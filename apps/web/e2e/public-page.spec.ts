import { expect, test } from '@playwright/test';
import { adminQuery, createWorkspace, PASSWORD, signUp } from './fixtures';

test('a visitor finds the teacher page, signs in and asks to join (Arabic)', async ({
  browser,
}) => {
  const teacherContext = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const studentContext = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const teacher = await signUp(teacherContext, { name: 'أ. شريف نبيل', twoFactor: true });
  const student = await signUp(studentContext, { name: 'ليلى أيمن' });
  const workspaceId = await createWorkspace(teacher.userId, 'أ. شريف نبيل — رياضيات');
  const [row] = await adminQuery<{ slug: string }>('select slug from workspaces where id = $1', [
    workspaceId,
  ]);
  const slug = row?.slug ?? '';

  // The teacher writes the page.
  const teacherPage = await teacherContext.newPage();
  await teacherPage.goto(`/ar/w/${workspaceId}/students`);
  await teacherPage.getByLabel('المواد', { exact: true }).fill('جبر، هندسة');
  await teacherPage.getByLabel('نبذة عنك').fill('شرح مبسط لطلاب الإعدادية.');
  await teacherPage.getByRole('button', { name: 'حفظ' }).click();
  await expect(teacherPage.getByText('تم الحفظ.')).toBeVisible();

  // A signed-out visitor sees it and is sent to sign in, then back to the page.
  await studentContext.clearCookies({ name: 'lms_session' });
  const page = await studentContext.newPage();
  await page.goto(`/ar/t/${slug}`);
  await expect(page.getByRole('heading', { name: 'أ. شريف نبيل — رياضيات' })).toBeVisible();
  await expect(page.getByText('هندسة', { exact: true })).toBeVisible();
  await expect(page.getByText('شرح مبسط لطلاب الإعدادية.')).toBeVisible();
  await page.getByRole('button', { name: 'طلب الانضمام' }).click();
  await expect(page).toHaveURL(/\/ar\/login\?next=/);
  await page.getByLabel('رقم الموبايل أو البريد الإلكتروني').fill(student.phone);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await expect(page).toHaveURL(new RegExp(`/ar/t/${slug}$`));
  await page.getByRole('button', { name: 'طلب الانضمام' }).click();
  await expect(
    page.getByText('تم إرسال طلبك إلى أ. شريف نبيل — رياضيات.', { exact: false }),
  ).toBeVisible();

  // Turned off, the page is gone.
  await teacherPage.getByLabel('الصفحة العامة ظاهرة').click(); // saved, then shown unchecked
  await expect(teacherPage.getByLabel('الصفحة العامة ظاهرة')).not.toBeChecked();
  await page.goto(`/ar/t/${slug}`);
  await expect(page.getByText('هذه الصفحة غير موجودة.')).toBeVisible();

  await teacherContext.close();
  await studentContext.close();
});
