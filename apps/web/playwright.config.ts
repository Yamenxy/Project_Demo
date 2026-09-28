import { defineConfig, devices } from '@playwright/test';

/**
 * Browser checks of the built web app (run after `pnpm build`). A mid-range Android phone
 * viewport, because most students use one (review PERF-01, UX-01).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:3100',
    ...devices['Pixel 7'],
  },
  webServer: {
    command: 'pnpm exec next start --port 3100',
    url: 'http://localhost:3100/ar',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
