import { chromium } from '@playwright/test';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const state = fileURLToPath(new URL('../.harness-state/deployed-eval/', import.meta.url));
const expectedEmail = 'latentvision128@gmail.com';
const accountView = process.argv.includes('--account-view');
const digest = value => createHash('sha256').update(value).digest('hex');
const startedAt = new Date().toISOString();
let result;
let stage = 'authority';
let pageInteractions = 0;
let observedRequests = 0;
let requestLimitReached = false;
const deadline = setTimeout(() => {
  process.stderr.write('LOGIN_VERIFICATION_DEADLINE\n', () => process.exit(1));
}, 20000);
try {
  const launch = JSON.parse((await readFile(`${state}fresh-edge-launch.json`, 'utf8')).replace(/^\uFEFF/, ''));
  const permitPath = `${state}verify-login-decision.json`;
  const permit = JSON.parse(await readFile(permitPath, 'utf8'));
  if (!launch.endpointVerified || launch.endpoint !== 'http://127.0.0.1:9222' ||
      permit.status !== 'APPROVED' || permit.oneShot !== true || Date.parse(permit.expiresAt) <= Date.now() ||
      permit.commandSha256 !== digest('verify-existing-pilot-login')) throw new Error('LOGIN_VERIFICATION_AUTHORITY_REQUIRED');
  await rename(permitPath, `${state}verify-login-decision-used-${randomUUID()}.json`);
  stage = 'connect';
  const browser = await chromium.connectOverCDP(launch.endpoint, { timeout: 10000 });
  const pages = browser.contexts().flatMap(context => context.pages()).filter(page => {
    try { const url = new URL(page.url()); return url.origin === 'https://prabinpebam.github.io' && url.pathname === '/watai/'; } catch { return false; }
  });
  if (pages.length !== 1) throw new Error('EXACTLY_ONE_WATAI_TARGET_REQUIRED');
  const page = pages[0];
  stage = 'inspect-current-page';
  if (accountView) {
    const guard = async route => {
      const request = route.request();
      if (request.method() !== 'GET' || ++observedRequests > 2) {
        requestLimitReached = true; await route.abort(); return;
      }
      await route.continue();
    };
    await page.route('**/*', guard);
    try {
      const visibleEmail = page.locator('.profile-hero__email:visible');
      if (!(await visibleEmail.count())) {
        const settings = page.getByRole('button', { name: 'Settings', exact: true });
        if (await settings.count() !== 1) throw new Error('SETTINGS_CONTROL_UNAVAILABLE');
        stage = 'open-settings';
        await settings.click({ timeout: 5000 }); pageInteractions++;
        stage = 'await-account-surface';
        await page.locator('.profile-hero__email:visible, button.account-hero:visible').first().waitFor({ timeout: 5000 });
        if (!(await visibleEmail.count())) {
          const account = page.locator('button.account-hero:visible');
          if (await account.count() !== 1) throw new Error('ACCOUNT_CONTROL_UNAVAILABLE');
          await account.click({ timeout: 5000 }); pageInteractions++;
        }
      }
      await visibleEmail.waitFor({ timeout: 5000 });
      if (requestLimitReached) throw new Error('ACCOUNT_VIEW_REQUEST_LIMIT');
    } finally { await page.unroute('**/*', guard); }
  }
  const observed = await page.evaluate(email => {
    const visible = element => element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    const emails = [...document.querySelectorAll('.profile-hero__email, .account-hero__email')].filter(visible).map(element => element.textContent.trim().toLowerCase());
    const badges = [...document.querySelectorAll('.profile-hero__badges .badge, .account-hero .badge')].filter(visible).map(element =>
      [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim());
    return {
      accountSurfaceVisible: emails.length > 0,
      expectedAccountVisible: emails.includes(email),
      differentAccountVisible: emails.some(value => value.includes('@') && value !== email),
      signedInBadge: badges.some(text => text.includes('Signed in')),
      memberBadge: badges.some(text => /\bMember\b/.test(text)),
      adminBadge: badges.some(text => /\bAdmin\b/.test(text)),
      composerVisible: [...document.querySelectorAll('textarea[aria-label="Message"]')].some(visible),
      signInVisible: [...document.querySelectorAll('.onboard__actions button')].filter(visible).some(element => element.textContent.trim() === 'Sign in'),
      cloudSyncVisible: [...document.querySelectorAll('.setting-row')].filter(visible).some(element =>
        element.querySelector('.setting-row__title')?.textContent.trim() === 'Cloud sync' && element.textContent.includes(email)),
      settingsVisible: [...document.querySelectorAll('.settings-head__title, .appbar__title')].filter(visible).some(element => /Settings|Account/.test(element.textContent)),
      accountLoading: [...document.querySelectorAll('.center-screen [role="status"], .center-screen .spinner')].some(visible),
    };
  }, expectedEmail);
  result = { status: observed.differentAccountVisible ? 'ACCOUNT_MISMATCH' : observed.expectedAccountVisible && observed.signedInBadge && observed.memberBadge && !observed.adminBadge
    ? 'UI_ACCOUNT_CONFIRMED' : observed.composerVisible && !observed.signInVisible ? 'SIGNED_IN_SHELL_ACCOUNT_NOT_VISIBLE' : 'ACCOUNT_NOT_VERIFIED',
    startedAt, verifiedAt: new Date().toISOString(), evidenceSource: 'existing-visible-account-DOM', target: 'https://prabinpebam.github.io/watai/',
    accountEmailSha256: digest(expectedEmail), ...observed, apiIdentityVerified: false, credentialsExported: false, pageInteractions, observedRequests,
    browserClosed: false, evalStarted: false };
  await writeFile(`${state}login-verification-${randomUUID()}.json`, JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
} catch (error) {
  result = { status: 'BLOCKED', code: /^[A-Z_]+$/.test(error.message) ? error.message : 'LOGIN_VERIFICATION_FAILED',
    errorType: error.name, stage, pageInteractions, observedRequests, requestLimitReached, startedAt, evalStarted: false };
  await writeFile(`${state}login-verification-${randomUUID()}.json`, JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
}
clearTimeout(deadline);
process.stdout.write(JSON.stringify(result, null, 2) + '\n', () => process.exit(result.status === 'BLOCKED' || result.status === 'ACCOUNT_MISMATCH' ? 1 : 0));