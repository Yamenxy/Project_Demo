import { expect, test } from '@playwright/test';
import { adminQuery } from './fixtures';
import { latestOtp, randomPhone, totp } from './support';

const PASSWORD = 'نجمة-الصباح-2026';

test('register, confirm the phone, turn on 2FA, sign back in and sign out everywhere (Arabic)', async ({
  page,
}) => {
  const phone = randomPhone();
  // Browser tests all sign up from one local address (test database only).
  await adminQuery('delete from rate_limit_counters');

  // Register.
  await page.goto('/ar/register');
  await page.getByLabel('الاسم الكامل').fill('طالب تجريبي');
  await page.getByLabel('رقم الموبايل').fill(phone);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'إنشاء الحساب' }).click();
  await expect(page).toHaveURL(/\/ar\/verify-phone$/);

  // Confirm the phone with the code, typed in Arabic-Indic digits.
  await page.getByRole('button', { name: 'إرسال الكود' }).click();
  await expect(page.getByRole('status')).toBeVisible();
  const code = await latestOtp(phone, 'verify_phone');
  const arabicDigits = code.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)));
  await page.getByLabel('الكود').fill(arabicDigits);
  await page.getByRole('button', { name: 'تأكيد' }).click();
  await expect(page).toHaveURL(/\/ar\/account$/);
  await expect(page.getByText('رقم الموبايل مؤكَّد')).toBeVisible();
  await expect(page.getByText('هذا الجهاز')).toBeVisible();

  // Turn on two-step verification and keep a recovery code.
  await page.getByRole('button', { name: 'تفعيل التحقق بخطوتين' }).click();
  await expect(page.getByRole('img', { name: /QR/ })).toBeVisible();
  const secret = (await page.locator('p.font-mono').textContent())?.trim() ?? '';
  expect(secret).toMatch(/^[A-Z2-7]+$/);
  await page.getByLabel('الكود من التطبيق').fill(totp(secret));
  await page.getByRole('button', { name: 'تفعيل', exact: true }).click();
  const recoveryCode = (await page.locator('ul[dir="ltr"] li').first().textContent())?.trim() ?? '';
  expect(recoveryCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  await page.getByRole('button', { name: 'حفظتُ الأكواد' }).click();
  await expect(page.getByText('مفعَّل')).toBeVisible();
  await expect(page.getByRole('img', { name: /QR/ })).toHaveCount(0);

  // The security notification is waiting.
  await page.getByRole('link', { name: 'الإشعارات (1)' }).click();
  await expect(page.getByText('تم تفعيل التحقق بخطوتين على حسابك.')).toBeVisible();
  await page.getByRole('button', { name: 'تعليم الكل كمقروء' }).click();
  await expect(page.getByRole('button', { name: 'تعليم الكل كمقروء' })).toHaveCount(0);
  await page.getByRole('link', { name: 'العودة إلى حسابي' }).click();

  // Sign out, and back in: the second step accepts a recovery code.
  await page.getByRole('button', { name: 'تسجيل الخروج', exact: true }).click();
  await expect(page).toHaveURL(/\/ar\/login$/);
  await page.getByLabel('رقم الموبايل أو البريد الإلكتروني').fill(phone);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await expect(page).toHaveURL(/\/ar\/two-factor(\?|$)/);
  await page.getByLabel('الكود').fill(recoveryCode);
  await page.getByRole('button', { name: 'تأكيد' }).click();
  await expect(page).toHaveURL(/\/ar\/account$/);

  // Sign out of every device.
  await page.getByRole('button', { name: 'تسجيل الخروج من كل الأجهزة' }).click();
  await expect(page).toHaveURL(/\/ar\/login$/);
  await page.goto('/ar/account');
  await expect(page).toHaveURL(/\/ar\/login$/);
});

test('a wrong password shows a translated error (English)', async ({ page }) => {
  await page.goto('/en/login');
  await page.getByLabel('Mobile number or email').fill(randomPhone());
  await page.getByLabel('Password').fill('not the right password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  // Next.js has its own (empty) route announcer with role=alert; target the form's message.
  await expect(page.locator('form [role="alert"]')).toHaveText('Wrong mobile number or password.');
});
