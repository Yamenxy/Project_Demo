import { expect, test } from '@playwright/test';
import { adminQuery, createWorkspace, signUp } from './fixtures';

test('a student submits homework, the teacher grades and releases it, and the student sees the grade', async ({
  browser,
}) => {
  const teacherContext = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const studentContext = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const teacher = await signUp(teacherContext, { name: 'أ. هالة سعيد', twoFactor: true });
  const student = await signUp(studentContext, { name: 'ياسين عادل' });
  const workspaceId = await createWorkspace(teacher.userId, 'أ. هالة سعيد — كيمياء');
  const w = `/api/v1/w/${workspaceId}`;
  const [member] = await adminQuery<{ id: string }>(
    `insert into memberships (workspace_id, id, user_id, role, status, created_at, updated_at)
     values ($1, gen_random_uuid(), $2, 'student', 'active', now(), now()) returning id`,
    [workspaceId, student.userId],
  );
  const api = teacherContext.request;
  const course = (await (await api.post(`${w}/courses`, { data: { title: 'كيمياء' } })).json()) as {
    id: string;
  };
  const cls = (await (
    await api.post(`${w}/classes`, { data: { name: 'فصل', courseId: course.id } })
  ).json()) as { id: string };
  await api.post(`${w}/classes/${cls.id}/students`, { data: { membershipIds: [member?.id] } });

  // The teacher creates and publishes the homework in the browser.
  const teacherPage = await teacherContext.newPage();
  await teacherPage.goto(`/ar/w/${workspaceId}/courses/${course.id}/homework`);
  await expect(teacherPage.getByRole('checkbox', { name: 'فصل' })).toBeChecked();
  await teacherPage.getByLabel('عنوان الواجب').fill('واجب الروابط');
  await teacherPage.getByLabel('موعد التسليم (بتوقيت القاهرة)').fill('2099-01-01T20:00');
  await teacherPage.getByRole('button', { name: 'إنشاء الواجب' }).click();
  await expect(teacherPage.getByText('واجب الروابط')).toBeVisible();
  await teacherPage.getByRole('button', { name: 'نشر', exact: true }).click();
  await expect(teacherPage.getByRole('button', { name: 'إلغاء النشر' })).toBeVisible();

  const page = await studentContext.newPage();
  await page.goto(`/ar/w/${workspaceId}/homework`);
  await page.getByLabel('إجابتك').fill('الرابطة الأيونية بين فلز ولا فلز');
  await page.getByRole('button', { name: 'تسليم', exact: true }).click();
  await expect(page.getByText(/^التسليم 1 في/)).toBeVisible();

  await teacherPage.getByRole('button', { name: 'التسليمات' }).click();
  await expect(teacherPage.getByText('الرابطة الأيونية بين فلز ولا فلز')).toBeVisible();
  await teacherPage.getByLabel('الدرجة', { exact: true }).fill('9');
  await teacherPage.getByLabel('ملاحظات', { exact: true }).fill('ممتاز');
  await teacherPage.getByRole('button', { name: 'حفظ الدرجة' }).click();
  await expect(teacherPage.getByLabel('الدرجة', { exact: true })).toHaveValue('9');
  await teacherPage.getByLabel('اكتب تعليقًا').fill('راجع توزيع الإلكترونات');
  await teacherPage.getByRole('button', { name: 'إرسال', exact: true }).click();
  await expect(teacherPage.getByText('راجع توزيع الإلكترونات')).toBeVisible();
  await teacherPage.getByRole('button', { name: 'إعلان النتائج' }).click();
  await expect(teacherPage.getByText(/النتائج معلنة/)).toBeVisible();

  await page.reload();
  await expect(page.getByText('الدرجة: 9 من 10')).toBeVisible();
  await expect(page.getByText('ملاحظات المعلم: ممتاز')).toBeVisible();
  await expect(page.getByText('راجع توزيع الإلكترونات')).toBeVisible();
  await page.getByLabel('اكتب تعليقًا').fill('شكرًا، سأراجعها');
  await page.getByRole('button', { name: 'إرسال', exact: true }).click();
  await expect(page.getByText('شكرًا، سأراجعها')).toBeVisible();

  // The owner sees both sides of every thread.
  await teacherPage.goto(`/ar/w/${workspaceId}/comments`);
  await expect(teacherPage.getByText('شكرًا، سأراجعها')).toBeVisible();
  await expect(teacherPage.getByText('راجع توزيع الإلكترونات')).toBeVisible();
  await teacherContext.close();
  await studentContext.close();
});
