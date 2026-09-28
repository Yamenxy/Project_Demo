import { expect, test } from '@playwright/test';

test.describe('locales and direction (REQ-I18N-001, REQ-I18N-002)', () => {
  test('the root redirects to Arabic', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/ar$/);
  });

  test('Arabic renders right-to-left and English left-to-right', async ({ page }) => {
    await page.goto('/ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await page.goto('/en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('the language switch keeps the page and changes the locale', async ({ page }) => {
    await page.goto('/ar');
    await page.getByRole('link', { name: 'English' }).click();
    await expect(page).toHaveURL(/\/en$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Everything a teacher needs, in one place',
    );
  });

  test('no horizontal scrolling on a phone in either direction', async ({ page }) => {
    for (const locale of ['ar', 'en']) {
      await page.goto(`/${locale}`);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, locale).toBeLessThanOrEqual(0);
    }
  });

  test('no untranslated message keys are shown', async ({ page }) => {
    for (const locale of ['ar', 'en']) {
      await page.goto(`/${locale}`);
      await expect(page.locator('body')).not.toContainText(/\b(home|common|meta)\.[a-zA-Z]+/);
    }
  });
});
