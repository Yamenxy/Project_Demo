import { expect, test } from '@playwright/test';
import { adminQuery, createWorkspace, signUp } from './fixtures';

test('a teacher enters a paper exam score, releases it, and the student sees it (Arabic)', async ({
  browser,
}) => {
  const teacherContext = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const studentContext = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const teacher = await signUp(teacherContext, { name: 'أ. مروة جمال', twoFactor: true });
  const student = await signUp(studentContext, { name: 'آسر حمدي' });
  const workspaceId = await createWorkspace(teacher.userId, 'أ. مروة جمال — عربي');
  const [member] = await adminQuery<{ id: string }>(
    `insert into memberships (workspace_id, id, user_id, role, status, created_at, updated_at)
     values ($1, gen_random_uuid(), $2, 'student', 'active', now(), now()) returning id`,
    [workspaceId, student.userId],
  );
  const [cls] = await adminQuery<{ id: string }>(
    `insert into classes (workspace_id, id, name, responsible_membership_id, created_at, updated_at)
     values ($1, gen_random_uuid(), 'الصف الأول', (select id from memberships
             where workspace_id = $1 and role = 'owner'), now(), now()) returning id`,
    [workspaceId],
  );
  await adminQuery(
    `insert into class_enrollments (workspace_id, id, class_id, membership_id, enrolled_at, enrolled_by)
     values ($1, gen_random_uuid(), $2, $3, now(), $4)`,
    [workspaceId, cls?.id, member?.id, teacher.userId],
  );

  const page = await teacherContext.newPage();
  await page.goto(`/ar/w/${workspaceId}/classes/${cls?.id ?? ''}/grades`);
  await page.getByLabel('اسم البند').fill('امتحان الشهر');
  await page.getByLabel('الدرجة العظمى').fill('20');
  await page.getByRole('button', { name: 'إضافة' }).click();
  await page.getByLabel('درجة آسر حمدي').fill('١٨٫٥');
  await page.getByRole('button', { name: 'حفظ الدرجات' }).click();
  await expect(page.getByText('تم الحفظ.')).toBeVisible();

  const studentPage = await studentContext.newPage();
  await studentPage.goto(`/ar/w/${workspaceId}/grades`);
  await expect(studentPage.getByText('لا توجد درجات معلنة بعد.')).toBeVisible();

  await page.getByRole('button', { name: 'إعلان للطلاب' }).click();
  await expect(page.getByText('معلنة للطلاب', { exact: false })).toBeVisible();
  await studentPage.reload();
  await expect(studentPage.getByText('امتحان الشهر')).toBeVisible();
  await expect(studentPage.getByText('18.5 / 20')).toBeVisible();

  await teacherContext.close();
  await studentContext.close();
});
