import { expect, test } from '@playwright/test';

test('does not boot Watai inside an MSAL silent-response iframe', async ({ page }) => {
  await page.goto('/#/onboarding/welcome');

  const frame = await page.evaluate(() => {
    const iframe = document.createElement('iframe');
    iframe.title = 'silent auth response';
    iframe.src = `${location.origin}/#error=login_required&state=test`;
    document.body.append(iframe);
    return iframe.title;
  });
  const silentFrame = page.frameLocator(`iframe[title="${frame}"]`);

  await expect(silentFrame.locator('#root')).toBeAttached();
  await expect(silentFrame.locator('#root')).toBeEmpty();
  await expect(page.locator('iframe[title="silent auth response"]')).toHaveCount(1);
  await expect(silentFrame.locator('iframe')).toHaveCount(0);
});

test('cleans a failed authentication response before HashRouter mounts', async ({ page }) => {
  await page.goto('/#error=login_required&error_description=session_expired&state=stale');

  await expect(page.getByRole('heading', { name: 'Welcome to Watai' })).toBeVisible();
  await expect.poll(() => page.url()).not.toContain('error=login_required');
});

test('does not start cloud sync or silent auth while signed out', async ({ page }) => {
  const consoleMessages: string[] = [];
  const silentRequests: string[] = [];
  page.on('console', (message) => consoleMessages.push(message.text()));
  page.on('request', (request) => {
    if (request.url().includes('/authorize?') && request.url().includes('prompt=none')) {
      silentRequests.push(request.url());
    }
  });

  await page.goto('/#/onboarding/welcome');
  await expect(page.getByRole('heading', { name: 'Welcome to Watai' })).toBeVisible();
  await page.waitForTimeout(500);

  expect(consoleMessages.filter((message) => message.includes('[sync] sync failed'))).toEqual([]);
  expect(silentRequests).toEqual([]);
});