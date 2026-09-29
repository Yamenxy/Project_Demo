import { expect, test } from '@playwright/test';
import { adminQuery, createWorkspace, signUp } from './fixtures';

test('a teacher sees the dashboard and switches between workspaces (Arabic)', async ({
  browser,
}) => {
  const context = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const teacher = await signUp(context, { name: 'أ. عبير سالم', twoFactor: true });
  const first = await createWorkspace(teacher.userId, 'أ. عبير سالم — أحياء');
  const second = await createWorkspace(teacher.userId, 'أ. عبير سالم — جيولوجيا');
  const student = await signUp(await browser.newContext({ baseURL: 'http://localhost:3100' }), {
    name: 'مازن رءوف',
  });
  await adminQuery(
    `insert into memberships (workspace_id, id, user_id, role, status, created_at, updated_at)
     values ($1, gen_random_uuid(), $2, 'student', 'pending', now(), now())`,
    [first, student.userId],
  );

  const page = await context.newPage();
  await page.goto(`/ar/w/${first}`);
  await expect(page.getByRole('heading', { name: 'لوحة المساحة' })).toBeVisible();
  const pending = page.getByRole('link', { name: /طلبات انضمام/ });
  await expect(pending).toContainText('1');
  await pending.click();
  await expect(page).toHaveURL(`http://localhost:3100/ar/w/${first}/students?status=pending`);
  await expect(page.getByText('مازن رءوف')).toBeVisible();

  await page.getByLabel('الانتقال إلى مساحة أخرى').selectOption(second);
  await expect(page).toHaveURL(new RegExp(`/ar/w/${second}$`));
  await expect(page.getByText('أ. عبير سالم — جيولوجيا').first()).toBeVisible();

  await context.close();
});
