import { expect, test } from '@playwright/test';
import { createWorkspace, joinCodeOf, signUp } from './fixtures';

test('a student joins with the code and the teacher approves (Arabic)', async ({ browser }) => {
  const teacherContext = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const studentContext = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const teacher = await signUp(teacherContext, { name: 'أ. كريم عادل', twoFactor: true });
  await signUp(studentContext, { name: 'يوسف طارق' });
  const workspaceId = await createWorkspace(teacher.userId, 'أ. كريم عادل — فيزياء');
  const code = await joinCodeOf(workspaceId);

  // The teacher sees the join code and a link to share.
  const teacherPage = await teacherContext.newPage();
  await teacherPage.goto(`/ar/w/${workspaceId}/students`);
  await expect(teacherPage.getByRole('heading', { name: 'الطلاب', exact: true })).toBeVisible();
  await expect(teacherPage.getByText(code, { exact: true })).toBeVisible();

  // The student opens the shared link: the code is already filled in.
  const studentPage = await studentContext.newPage();
  await studentPage.goto(`/ar/join?code=${code}`);
  await expect(studentPage.getByLabel('كود الانضمام')).toHaveValue(code);
  await studentPage.getByRole('button', { name: 'إرسال الطلب' }).click();
  await expect(studentPage.getByText('تم إرسال طلبك إلى')).toBeVisible();

  // The teacher approves the request.
  await teacherPage.reload();
  await teacherPage.getByRole('button', { name: /طلبات الانضمام/ }).click();
  await expect(teacherPage.getByText('يوسف طارق')).toBeVisible();
  await teacherPage.getByRole('button', { name: 'قبول', exact: true }).click();
  await teacherPage.getByRole('button', { name: 'كل الطلاب' }).click();
  await expect(teacherPage.getByText('نشط', { exact: true })).toBeVisible();

  // The student can now open the workspace.
  await studentPage.goto(`/ar/w/${workspaceId}`);
  await expect(studentPage.getByText('أ. كريم عادل — فيزياء').first()).toBeVisible();

  await teacherContext.close();
  await studentContext.close();
});
