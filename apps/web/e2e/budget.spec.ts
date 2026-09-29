import { expect, test } from '@playwright/test';

/**
 * Performance budget for student-facing pages (review PERF-01): the JavaScript a phone downloads
 * to show the page, compressed, must stay under 170 KB.
 */
const BUDGET_BYTES = 170 * 1024;

for (const path of ['/ar', '/ar/login', '/ar/register', '/ar/account']) {
  test(`JavaScript on ${path} stays under the budget`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'networkidle' });
    const bytes = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .filter((entry) => (entry as PerformanceResourceTiming).initiatorType === 'script')
        .reduce((sum, entry) => sum + (entry as PerformanceResourceTiming).encodedBodySize, 0),
    );
    console.log(`${path}: ${(bytes / 1024).toFixed(1)} KB of JavaScript (compressed)`);
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThan(BUDGET_BYTES);
  });
}
