import { expect, test } from '@playwright/test';
import { adminQuery, createWorkspace, signUp } from './fixtures';

test('the owner adds a price and it shows on the public page (Arabic)', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const teacher = await signUp(context, { name: 'أ. ماجد رشاد', twoFactor: true });
  const workspaceId = await createWorkspace(teacher.userId, 'أ. ماجد رشاد — علوم');
  const [row] = await adminQuery<{ slug: string }>('select slug from workspaces where id = $1', [
    workspaceId,
  ]);

  const page = await context.newPage();
  await page.goto(`/ar/w/${workspaceId}/prices`);
  await page.getByLabel('الاسم').fill('اشتراك شهري');
  await page.getByLabel('السعر بالجنيه').fill('١٥٠٫٥');
  await page.getByRole('button', { name: 'إضافة' }).click();
  await expect(page.getByText('اشتراك شهري')).toBeVisible();

  await page.goto(`/ar/t/${row?.slug ?? ''}`);
  await expect(page.getByRole('heading', { name: 'الأسعار' })).toBeVisible();
  await expect(page.getByText('اشتراك شهري')).toBeVisible();
  await expect(page.getByText(/150[.٫]50/)).toBeVisible();
  const [stored] = await adminQuery<{ amount: string }>(
    'select amount_piastres as amount from price_items where workspace_id = $1',
    [workspaceId],
  );
  expect(stored?.amount).toBe('15050');
  await context.close();
});
