import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['src/**/*.integration.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
