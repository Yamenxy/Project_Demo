import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['lib/**/*.spec.ts', 'messages/**/*.spec.ts'],
    environment: 'node',
  },
});
