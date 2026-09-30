import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { adminQuery, createWorkspace, signUp } from './fixtures';

test('the owner downloads this month’s payments as a CSV that Excel reads as Arabic', async ({
  browser,
}) => {
  const context = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const owner = await signUp(context, { name: 'أ. شريف نبيل', twoFactor: true });
  const workspaceId = await createWorkspace(owner.userId, 'أ. شريف نبيل — لغة عربية');
  const student = await signUp(await browser.newContext({ baseURL: 'http://localhost:3100' }), {
    name: 'ريم حسن',
  });
  const [member] = await adminQuery<{ id: string }>(
    `insert into memberships (workspace_id, id, user_id, role, status, created_at, updated_at)
     values ($1, gen_random_uuid(), $2, 'student', 'active', now(), now()) returning id`,
    [workspaceId, student.userId],
  );
  const recorded = await context.request.post(`/api/v1/w/${workspaceId}/payments`, {
    data: { membershipId: member?.id, amountPiastres: 20000, method: 'cash' },
  });
  expect(recorded.status()).toBe(201);

  const page = await context.newPage();
  await page.goto(`/ar/w/${workspaceId}/payments`);
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'تنزيل مدفوعات هذا الشهر (CSV)' }).click();
  const file = await (await download).path();
  const text = await readFile(file, 'utf8');
  expect(text.charCodeAt(0)).toBe(0xfeff);
  expect(text).toContain('رقم الإيصال,التاريخ,الطالب,المبلغ');
  expect(text).toContain('ريم حسن,200.00,EGP,نقدي');
  await context.close();
});
