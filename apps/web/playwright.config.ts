import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * Browser checks of the built apps (run after `pnpm build`), on a mid-range Android phone
 * viewport because most students use one (review PERF-01, UX-01).
 *
 * Starts the built API and web app. The API uses the local database (docker compose, or the CI
 * service container) and the development `file` OTP sender, whose outbox the tests read.
 */
export const OTP_OUTBOX = path.resolve(__dirname, 'test-results', 'otp-outbox.jsonl');

const database = {
  DATABASE_URL:
    process.env.E2E_DATABASE_URL ?? 'postgres://lms_app:lms_app_local_only@localhost:5432/lms_dev',
  DATABASE_PLATFORM_URL:
    process.env.E2E_DATABASE_PLATFORM_URL ??
    'postgres://lms_platform:lms_platform_local_only@localhost:5432/lms_dev',
};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:3100',
    ...devices['Pixel 7'],
  },
  webServer: [
    {
      command: 'node ../api/dist/main.js',
      url: 'http://localhost:3001/api/health',
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...database,
        NODE_ENV: 'production',
        DEPLOY_TIER: 'local',
        DATA_CLASS: 'synthetic',
        PORT: '3001',
        LOG_LEVEL: 'warn',
        WEB_ORIGINS: 'http://localhost:3100',
        OTP_PROVIDER: 'file',
        OTP_OUTBOX_FILE: OTP_OUTBOX,
        STORAGE_DIR: path.resolve(__dirname, 'test-results', 'storage'),
        // Test-only key, for this throwaway local run.
        SECRET_ENCRYPTION_KEY: 'ZTJlLW9ubHkta2V5LWZvci1sb2NhbC1icm93c2VyLXQ=',
      },
    },
    {
      command: 'pnpm exec next start --port 3100',
      url: 'http://localhost:3100/ar',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
