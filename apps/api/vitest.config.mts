import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC is required so NestJS decorator metadata (used for dependency injection) is emitted in tests.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    environment: 'node',
    env: {
      NODE_ENV: 'test',
      DEPLOY_TIER: 'local',
      DATA_CLASS: 'synthetic',
      LOG_LEVEL: 'silent',
      WEB_ORIGINS: 'http://localhost:3000',
      // Test-only key.
      SECRET_ENCRYPTION_KEY: 'bHUi9RJpLGyXJBsx54GiqCJNN7W72cshb2sYwWcIFDE=',
      DATABASE_URL: 'postgres://lms_test:lms_test@localhost:5432/lms_test',
      DATABASE_PLATFORM_URL: 'postgres://lms_test_platform:lms_test@localhost:5432/lms_test',
    },
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['src/**/*.spec.ts'] },
      },
      {
        // Runs against a real PostgreSQL in Docker (Testcontainers), with production migrations.
        extends: true,
        test: {
          name: 'integration',
          include: ['test/**/*.int.spec.ts'],
          globalSetup: ['test/global-setup.ts'],
          hookTimeout: 180_000,
          testTimeout: 60_000,
        },
      },
    ],
  },
});
