import { expect, test } from '@playwright/test';
import { adminQuery, createWorkspace, signUp } from './fixtures';

test('platform support opens a read-only session, and the owner sees it in the activity log', async ({
  browser,
}) => {
  const supportContext = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const ownerContext = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const support = await signUp(supportContext, { name: 'دعم المنصة', twoFactor: true });
  await adminQuery('insert into platform_owners (user_id, created_at) values ($1, now())', [
    support.userId,
  ]);
  const owner = await signUp(ownerContext, { name: 'أ. سمر نادر', twoFactor: true });
  const workspaceId = await createWorkspace(owner.userId, 'أ. سمر نادر — فيزياء');

  const page = await supportContext.newPage();
  await page.goto(`/ar/platform/${workspaceId}`);
  await page.getByLabel('سبب جلسة الدعم').fill('المعلمة لا ترى فصل السبت');
  await page.getByLabel('رقم التذكرة').fill('T-2031');
  await page.getByRole('button', { name: 'بدء جلسة الدعم' }).click();
  await page.getByRole('link', { name: 'فتح المساحة' }).click();
  await expect(page.getByRole('status')).toContainText('جلسة دعم للقراءة فقط');
  await page.goto(`/ar/w/${workspaceId}/classes`);
  await expect(page.getByRole('heading', { name: 'الفصول' })).toBeVisible();

  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto(`/ar/w/${workspaceId}/audit-log`);
  await ownerPage.getByLabel('المجال').selectOption('support');
  await expect(ownerPage.getByText('support.session_started')).toBeVisible();
  await expect(ownerPage.getByText('support.viewed').first()).toBeVisible();
  await supportContext.close();
  await ownerContext.close();
});
