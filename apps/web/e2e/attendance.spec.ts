import { expect, test } from '@playwright/test';
import { adminQuery, createWorkspace, signUp } from './fixtures';

test('a teacher takes attendance by hand (Arabic)', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const teacher = await signUp(context, { name: 'أ. سمية عادل', twoFactor: true });
  const workspaceId = await createWorkspace(teacher.userId, 'أ. سمية عادل — فرنساوي');
  const student = await signUp(await browser.newContext({ baseURL: 'http://localhost:3100' }), {
    name: 'كريم فوزي',
  });
  const [membership] = await adminQuery<{ id: string }>(
    `insert into memberships (workspace_id, id, user_id, role, status, created_at, updated_at)
     values ($1, gen_random_uuid(), $2, 'student', 'active', now(), now()) returning id`,
    [workspaceId, student.userId],
  );

  const page = await context.newPage();
  await page.goto(`/ar/w/${workspaceId}/classes`);
  await page.getByLabel('اسم الفصل').fill('مجموعة الحضور');
  await page.getByRole('button', { name: 'إنشاء' }).click();
  await page.getByRole('link', { name: /مجموعة الحضور/ }).click();
  await expect(page.getByRole('heading', { name: 'مجموعة الحضور' })).toBeVisible();
  const classUrl = page.url();
  const classId = classUrl.split('/').at(-1) ?? '';
  await adminQuery(
    `insert into class_enrollments (workspace_id, id, class_id, membership_id, enrolled_at, enrolled_by)
     values ($1, gen_random_uuid(), $2, $3, now(), $4)`,
    [workspaceId, classId, membership?.id, teacher.userId],
  );
  await page.getByRole('button', { name: 'إضافة موعد أسبوعي' }).click();
  await page.getByRole('link', { name: /السبت/ }).first().click();

  await expect(page.getByRole('group', { name: 'كريم فوزي' })).toBeVisible();
  await page
    .getByRole('group', { name: 'كريم فوزي' })
    .getByRole('button', { name: 'متأخر' })
    .click();
  await page.getByRole('button', { name: 'حفظ تغيير واحد' }).click();
  await expect(page.getByText('تم الحفظ.')).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('group', { name: 'كريم فوزي' }).getByRole('button', { name: 'متأخر' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await context.close();
});
