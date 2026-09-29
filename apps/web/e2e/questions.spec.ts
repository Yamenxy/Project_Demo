import { expect, test } from '@playwright/test';
import { adminQuery, createWorkspace, signUp } from './fixtures';

test('a teacher writes a question with maths in Arabic and sees it rendered', async ({
  browser,
}) => {
  const context = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const teacher = await signUp(context, { name: 'أ. كمال فؤاد', twoFactor: true });
  const workspaceId = await createWorkspace(teacher.userId, 'أ. كمال فؤاد — رياضيات');
  const [course] = await adminQuery<{ id: string }>(
    `insert into courses (workspace_id, id, title, created_at, updated_at)
     values ($1, gen_random_uuid(), 'جبر', now(), now()) returning id`,
    [workspaceId],
  );

  const page = await context.newPage();
  await page.goto(`/ar/w/${workspaceId}/courses/${course?.id ?? ''}/questions`);
  await page.getByLabel('نص السؤال').fill('أوجد قيمة $x$ إذا كان $x^2 = 9$ و $x > 0$');
  await expect(page.locator('.katex').first()).toBeVisible(); // live preview
  await page.getByLabel('الاختيارات (كل اختيار في سطر)').fill('3\n-3\n9');
  await page.getByRole('button', { name: 'إضافة السؤال' }).click();
  await expect(page.getByText('سؤال 1 · اختيار من متعدد', { exact: false })).toBeVisible();
  await expect(page.locator('ol .katex')).toHaveCount(3);
  await context.close();
});
