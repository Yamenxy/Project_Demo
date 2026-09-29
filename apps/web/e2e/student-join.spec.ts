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

test('a teacher imports students from a CSV file, and a student joins onto their record', async ({
  browser,
}) => {
  const teacherContext = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const studentContext = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const teacher = await signUp(teacherContext, { name: 'أ. هدى سمير', twoFactor: true });
  const student = await signUp(studentContext, { name: 'اسم التسجيل' });
  const workspaceId = await createWorkspace(teacher.userId, 'أ. هدى سمير — كيمياء');
  const code = await joinCodeOf(workspaceId);

  const teacherPage = await teacherContext.newPage();
  await teacherPage.goto(`/ar/w/${workspaceId}/students`);
  const csv = ['الاسم,الموبايل,الكود', `ريم خالد,${student.phone},K-7`, 'بدون رقم,,'].join('\r\n');
  await teacherPage.locator('input[type=file]').setInputFiles({
    name: 'طلاب.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv, 'utf-8'),
  });
  await expect(teacherPage.getByText('طالب واحد جاهز للإضافة من 2 صف.')).toBeVisible();
  await expect(teacherPage.getByText('لا يوجد رقم موبايل للطالب')).toBeVisible();
  await teacherPage.getByRole('button', { name: 'إضافة طالب واحد' }).click();
  await expect(teacherPage.getByText('تمت إضافة طالب واحد.')).toBeVisible();
  await expect(teacherPage.getByText('ريم خالد')).toBeVisible();
  await expect(teacherPage.getByText('لم يُفعِّل حسابه')).toBeVisible();

  // The student joins with the code and is in straight away, on the imported record.
  const studentPage = await studentContext.newPage();
  await studentPage.goto(`/ar/join?code=${code}`);
  await studentPage.getByRole('button', { name: 'إرسال الطلب' }).click();
  await expect(studentPage.getByText('انضممت إلى أ. هدى سمير — كيمياء.')).toBeVisible();
  await teacherPage.reload();
  await expect(teacherPage.getByText('K-7')).toBeVisible();
  await expect(teacherPage.getByText('لم يُفعِّل حسابه')).toHaveCount(0);

  await teacherContext.close();
  await studentContext.close();
});
