import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { signUp } from './fixtures';

test('a person downloads their data, corrects their name, and asks to delete, then changes their mind', async ({
  browser,
}) => {
  const context = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const account = await signUp(context, { name: 'هنا يوسف' });
  const page = await context.newPage();
  await page.goto('/ar/account');

  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'تنزيل نسخة من بياناتي' }).click();
  const data = JSON.parse(await readFile(await (await download).path(), 'utf8')) as {
    account: { nameAr: string; phone: string };
  };
  expect(data.account).toMatchObject({
    nameAr: 'هنا يوسف',
    phone: `+20${account.phone.slice(1)}`,
  });

  await page.getByLabel('الاسم', { exact: true }).fill('هنا يوسف علي');
  await page.getByRole('button', { name: 'حفظ الاسم' }).click();
  await expect(page.getByText('تم حفظ الاسم.')).toBeVisible();

  await page.getByRole('button', { name: 'حذف حسابي' }).click();
  await page.getByRole('button', { name: 'نعم، احذف حسابي' }).click();
  await expect(page.getByText(/سيُحذف حسابك يوم/)).toBeVisible();
  await page.getByRole('button', { name: 'إلغاء الحذف' }).click();
  await expect(page.getByRole('button', { name: 'حذف حسابي' })).toBeVisible();
  await context.close();
});
