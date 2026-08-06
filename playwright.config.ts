import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: 'test-results/library-experience',
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/library-experience', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: null,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { browserName: 'chromium', launchOptions: { args: ['--window-size=1440,900'] } },
    },
    {
      name: 'mobile',
      use: {
        browserName: 'chromium',
        hasTouch: true,
        launchOptions: { args: ['--window-size=390,844'] },
      },
    },
    {
      name: 'mobile-webkit',
      use: {
        ...devices['iPhone 13'],
        browserName: 'webkit',
      },
    },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
