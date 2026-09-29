import { expect, test } from '@playwright/test';
import { adminQuery, createWorkspace, signUp } from './fixtures';

test('the owner sees cash collected today and this month (Arabic)', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const teacher = await signUp(context, { name: 'أ. إيمان فكري', twoFactor: true });
  const workspaceId = await createWorkspace(teacher.userId, 'أ. إيمان فكري — كيمياء');
  const [student] = await adminQuery<{ id: string }>(
    `insert into memberships (workspace_id, id, user_id, role, status, provisional_name,
                              provisional_phone, created_at, updated_at)
     values ($1, gen_random_uuid(), null, 'student', 'active', 'طالب نقدي', '+201012300001',
             now(), now()) returning id`,
    [workspaceId],
  );
  const page = await context.newPage();
  const recorded = await page.request.post(`/api/v1/w/${workspaceId}/payments`, {
    data: { membershipId: student?.id, amountPiastres: 20000, method: 'cash' },
  });
  expect(recorded.status()).toBe(201);

  await page.goto(`/ar/w/${workspaceId}/cash`);
  await expect(page.getByRole('heading', { name: 'الخزنة' })).toBeVisible();
  await expect(page.getByText('أ. إيمان فكري (دفعة واحدة)')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'دخل هذا الشهر' })).toBeVisible();
  await expect(page.getByText('الصافي بعد القيود العكسية')).toBeVisible();
  await context.close();
});
