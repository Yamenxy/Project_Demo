import { expect, test } from '@playwright/test';
import { adminQuery, createWorkspace, signUp } from './fixtures';

test('a teacher attaches a PDF to a lesson; it becomes available after the check (Arabic)', async ({
  browser,
}) => {
  const context = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const teacher = await signUp(context, { name: 'أ. نهى زكي', twoFactor: true });
  const workspaceId = await createWorkspace(teacher.userId, 'أ. نهى زكي — جغرافيا');
  const [course] = await adminQuery<{ id: string }>(
    `insert into courses (workspace_id, id, title, created_at, updated_at)
     values ($1, gen_random_uuid(), 'جغرافيا', now(), now()) returning id`,
    [workspaceId],
  );
  await adminQuery(
    `insert into lessons (workspace_id, id, course_id, title, position, created_at, updated_at)
     values ($1, gen_random_uuid(), $2, 'الخرائط', 0, now(), now())`,
    [workspaceId, course?.id],
  );

  const page = await context.newPage();
  await page.goto(`/ar/w/${workspaceId}/courses/${course?.id ?? ''}`);
  await page.getByRole('button', { name: 'تعديل' }).click();
  await page.locator('input[type=file][accept*="pdf"]').setInputFiles({
    name: 'خريطة.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n%%EOF\n'),
  });
  await expect(page.getByText('خريطة.pdf')).toBeVisible();
  // The check job runs in the API process; reload until it has passed.
  await expect(async () => {
    await page.reload();
    await page.getByRole('button', { name: 'تعديل' }).click();
    await expect(page.getByText('متاح', { exact: true })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await expect(page.getByRole('link', { name: 'خريطة.pdf' })).toBeVisible();
  await context.close();
});
