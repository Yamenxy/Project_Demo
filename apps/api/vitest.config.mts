import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC is required so NestJS decorator metadata (used for dependency injection) is emitted in tests.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    environment: 'node',
    env: {
      NODE_ENV: 'test',
      DEPLOY_TIER: 'local',
      DATA_CLASS: 'synthetic',
      DATABASE_URL: 'postgres://lms_test:lms_test@localhost:5432/lms_test',
    },
  },
});
