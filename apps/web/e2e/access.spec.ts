import { expect, test } from '@playwright/test';
import { adminQuery, createWorkspace, signUp } from './fixtures';

test('a group opens a lesson for a student, and pausing closes it (Arabic)', async ({
  browser,
}) => {
  const teacherContext = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const studentContext = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const teacher = await signUp(teacherContext, { name: 'أ. عادل وهبة', twoFactor: true });
  const student = await signUp(studentContext, { name: 'سما عاطف' });
  const workspaceId = await createWorkspace(teacher.userId, 'أ. عادل وهبة — فيزياء');
  const [member] = await adminQuery<{ id: string }>(
    `insert into memberships (workspace_id, id, user_id, role, status, created_at, updated_at)
     values ($1, gen_random_uuid(), $2, 'student', 'active', now(), now()) returning id`,
    [workspaceId, student.userId],
  );
  const [course] = await adminQuery<{ id: string }>(
    `insert into courses (workspace_id, id, title, created_at, updated_at)
     values ($1, gen_random_uuid(), 'فيزياء', now(), now()) returning id`,
    [workspaceId],
  );
  await adminQuery(
    `insert into lessons (workspace_id, id, course_id, title, body, position, published_at,
                          created_at, updated_at)
     values ($1, gen_random_uuid(), $2, 'قانون نيوتن الأول', 'الجسم الساكن يبقى ساكنًا.', 0, now(),
             now(), now())`,
    [workspaceId, course?.id],
  );

  const studentPage = await studentContext.newPage();
  await studentPage.goto(`/ar/w/${workspaceId}/lessons`);
  await expect(studentPage.getByText('لا توجد دروس متاحة لك بعد.')).toBeVisible();

  const page = await teacherContext.newPage();
  await page.goto(`/ar/w/${workspaceId}/groups`);
  await page.getByLabel('اسم المجموعة').fill('مجموعة السبت');
  await page.getByRole('button', { name: 'إنشاء' }).click();
  await page.getByRole('button', { name: /مجموعة السبت/ }).click();
  await page.getByRole('checkbox', { name: 'قانون نيوتن الأول' }).click();
  await expect(page.getByRole('checkbox', { name: 'قانون نيوتن الأول' })).toBeChecked();
  await page.getByLabel('ابحث عن طالب لإضافته').fill('سما');
  await page.getByRole('button', { name: 'إضافة', exact: true }).click();
  await expect(page.getByRole('button', { name: 'إخراج' })).toBeVisible();

  await studentPage.reload();
  await studentPage.getByRole('link', { name: 'قانون نيوتن الأول' }).click();
  await expect(studentPage.getByText('الجسم الساكن يبقى ساكنًا.')).toBeVisible();

  // Pausing from the student's access page closes it.
  await page.goto(`/ar/w/${workspaceId}/students/${member?.id ?? ''}/access`);
  await expect(page.getByText('مفتوح عبر: مجموعة السبت')).toBeVisible();
  page.once('dialog', (dialog) => void dialog.accept('لم يدفع'));
  await page.getByRole('button', { name: 'إيقاف كل الوصول' }).click();
  await expect(page.getByText('الوصول متوقف لهذا الطالب.')).toBeVisible();
  await studentPage.reload();
  await expect(studentPage.getByText('وصولك متوقف مؤقتًا.')).toBeVisible();

  await teacherContext.close();
  await studentContext.close();
});
