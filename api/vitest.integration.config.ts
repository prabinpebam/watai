import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.integration.test.ts'],
    setupFiles: ['./src/test/integrationSetup.ts'],
    passWithNoTests: false,
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});