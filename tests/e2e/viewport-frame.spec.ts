import { expect, test, type Page } from '@playwright/test';

interface ViewportState {
  height: number;
  offsetTop: number;
  scale: number;
}

async function setViewport(page: Page, state: Partial<ViewportState>) {
  await page.evaluate((next) => {
    (window as typeof window & { __setViewport(value: Partial<ViewportState>): void }).__setViewport(next);
  }, state);
  if (state.scale !== undefined && state.scale !== 1) return;
  await expect.poll(() => page.locator('#root').evaluate((element) => ({
    top: element.getBoundingClientRect().top,
    height: element.getBoundingClientRect().height,
  })) ).toEqual(await page.evaluate(() => ({
    top: window.visualViewport!.offsetTop,
    height: window.visualViewport!.height,
  })));
}

async function expectChatVisible(page: Page) {
  for (const selector of ['.appbar', '.composer__textarea']) {
    await expect.poll(() => page.locator(selector).evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const viewport = window.visualViewport!;
      return rect.top >= viewport.offsetTop - 1
        && rect.bottom <= viewport.offsetTop + viewport.height + 1;
    })).toBe(true);
  }
}

test.describe('Visual viewport frame', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const native = window.visualViewport;
      const state: Partial<ViewportState> = {};
      const viewport = new EventTarget();
      Object.defineProperties(viewport, {
        height: { get: () => state.height ?? native?.height ?? window.innerHeight },
        offsetTop: { get: () => state.offsetTop ?? native?.offsetTop ?? 0 },
        scale: { get: () => state.scale ?? native?.scale ?? 1 },
      });
      native?.addEventListener('resize', () => viewport.dispatchEvent(new Event('resize')));
      native?.addEventListener('scroll', () => viewport.dispatchEvent(new Event('scroll')));
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
      Object.defineProperty(window, '__setViewport', {
        value: (next: Partial<ViewportState>) => {
          Object.assign(state, next);
          viewport.dispatchEvent(new Event('resize'));
          viewport.dispatchEvent(new Event('scroll'));
        },
      });
    });
  });

  test('keeps the real header and editor visible during keyboard panning and typing', async ({ page }, testInfo) => {
    await page.goto('/#/dev/gallery?chat');
    await expect(page.locator('.chat--empty')).toBeVisible();
    const editor = page.getByRole('textbox', { name: 'Message', exact: true });
    if (testInfo.project.name !== 'desktop') await expect(editor).not.toBeFocused();
    await editor.click();
    await setViewport(page, { height: 440, offsetTop: 180 });
    await expectChatVisible(page);
    const relativeTop = await editor.evaluate((element) => element.getBoundingClientRect().top - window.visualViewport!.offsetTop);
    for (const offsetTop of [80, 160, 40, 120, 0, 180]) {
      await setViewport(page, { offsetTop });
      await editor.pressSequentially('x');
      await expect(editor).toBeFocused();
      await expectChatVisible(page);
      expect(await editor.evaluate((element) => element.getBoundingClientRect().top - window.visualViewport!.offsetTop)).toBeCloseTo(relativeTop, 0);
    }
    await testInfo.attach('panned-chat', { body: await page.screenshot(), contentType: 'image/png' });
  });

  test('preserves focus, long-draft scrolling, and geometry through repeated keyboard dismissal', async ({ page }) => {
    await page.goto('/#/dev/gallery?chat');
    await expect(page.locator('.chat--empty')).toBeVisible();
    const editor = page.getByRole('textbox', { name: 'Message', exact: true });
    const fullHeight = await page.evaluate(() => window.innerHeight);
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await editor.click();
      await setViewport(page, { height: 440, offsetTop: 180 });
      await editor.fill('A long draft with native textarea scrolling. '.repeat(40));
      await expect(page.locator('.composer--multiline')).toBeVisible();
      await expectChatVisible(page);
      expect(await editor.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
      await editor.evaluate((element) => element.scrollTo(0, element.scrollHeight));
      await expect.poll(() => editor.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      await editor.evaluate((element) => element.blur());
      await expectChatVisible(page);
      await setViewport(page, { height: fullHeight, offsetTop: 0 });
      await expectChatVisible(page);
    }
  });

  test('preserves user zoom and does not intercept touch movement', async ({ page }) => {
    await page.goto('/#/dev/gallery?chat');
    await expect(page.locator('.chat--empty')).toBeVisible();
    const initial = await page.locator('#root').boundingBox();
    await setViewport(page, { height: 300, offsetTop: 140, scale: 2 });
    expect(await page.locator('#root').boundingBox()).toEqual(initial);
    const canceled = await page.evaluate(() => {
      const target = document.querySelector('.appbar')!;
      const start = new Event('touchstart', { bubbles: true });
      Object.defineProperty(start, 'touches', { value: [{ clientX: 100, clientY: 200 }] });
      target.dispatchEvent(start);
      const move = new Event('touchmove', { bubbles: true, cancelable: true });
      Object.defineProperty(move, 'touches', { value: [{ clientX: 100, clientY: 100 }] });
      target.dispatchEvent(move);
      return move.defaultPrevented;
    });
    expect(canceled).toBe(false);
    await setViewport(page, { height: 440, offsetTop: 80, scale: 1 });
    await expectChatVisible(page);
  });

  test('keeps latest history pinned through resize without moving a reader away from older messages', async ({ page }) => {
    await page.goto('/#/dev/gallery');
    await expect(page.locator('.appbar')).toBeVisible();
    await page.evaluate(async () => {
      const modulePath = '/src/data/local/localRepository.ts';
      const { LocalRepository } = await import(modulePath);
      const local = new LocalRepository();
      await local.createThread({ id: 'viewport-eval' });
      for (let index = 0; index < 20; index += 1) {
        await local.appendMessage({
          id: `viewport-message-${index}`, threadId: 'viewport-eval', role: 'assistant',
          content: index === 19 ? 'Latest viewport reply' : `Reply ${index}. ${'Message history content. '.repeat(16)}`,
          status: 'complete', createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
        });
      }
    });
    await page.goto('/#/dev/gallery?chat');
    await expect(page.getByText('Latest viewport reply')).toBeVisible();
    const history = page.locator('.chat__scroll');
    const distance = () => history.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop);
    await expect.poll(distance).toBeLessThanOrEqual(1);
    await setViewport(page, { height: 440, offsetTop: 180 });
    await expect.poll(distance).toBeLessThanOrEqual(1);
    await expectChatVisible(page);
    await history.evaluate((element) => element.scrollTo(0, 250));
    await expect(page.getByRole('button', { name: 'Jump to latest' })).toBeVisible();
    await setViewport(page, { height: 520, offsetTop: 100 });
    expect(await history.evaluate((element) => element.scrollTop)).toBe(250);
  });

  test('does not animate the focused composer when the first message arrives', async ({ page }) => {
    await page.goto('/#/dev/gallery?chat');
    await expect(page.locator('.chat--empty')).toBeVisible();
    const editor = page.getByRole('textbox', { name: 'Message', exact: true });
    await editor.click();
    await setViewport(page, { height: 440, offsetTop: 180 });
    await editor.fill('First message');
    const animations = await page.evaluate(async () => {
      const slot = document.querySelector('.composer-slot')!;
      let animationCount = 0;
      const observer = new MutationObserver(() => { animationCount += slot.getAnimations().length; });
      observer.observe(document.querySelector('.chat')!, { attributes: true });
      const repositoryPath = '/src/data/local/localRepository.ts';
      const storePath = '/src/state/store.ts';
      const { LocalRepository } = await import(repositoryPath);
      const { useUi } = await import(storePath);
      const local = new LocalRepository();
      await local.createThread({ id: 'viewport-eval' });
      await local.appendMessage({
        id: 'first-message', threadId: 'viewport-eval', role: 'user',
        content: 'First message', status: 'complete', createdAt: new Date().toISOString(),
      });
      useUi.getState().bumpThread('viewport-eval');
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      observer.disconnect();
      return animationCount;
    });
    await expect(page.locator('.chat--empty')).toHaveCount(0);
    expect(animations).toBe(0);
    await expect(editor).toBeFocused();
    await expectChatVisible(page);
  });

  test('keeps a real portaled Library dialog inside the same visual viewport', async ({ page }) => {
    await page.goto('/#/dev/library-picker-eval');
    await page.getByRole('button', { name: 'Add attachment' }).click();
    await page.getByRole('menuitem', { name: 'Add from Library' }).click();
    const search = page.getByRole('textbox', { name: 'Search Library' });
    await expect(search).toBeVisible();
    await search.click();
    await setViewport(page, { height: 440, offsetTop: 180 });
    const dialog = page.getByRole('dialog', { name: 'Add from Library' });
    await expect.poll(() => dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const viewport = window.visualViewport!;
      return rect.top >= viewport.offsetTop - 1 && rect.bottom <= viewport.offsetTop + viewport.height + 1;
    })).toBe(true);
    await search.fill('poster');
    await expect(search).toBeFocused();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
  });

  test('keeps the focused editor at the iOS zoom-safe font size', async ({ page }) => {
    await page.goto('/#/dev/gallery?chat');
    await expect(page.locator('.chat--empty')).toBeVisible();
    await page.evaluate(() => { document.documentElement.style.fontSize = '14.4px'; });
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveCSS('font-size', '16px');
  });
});

test('native touch drags scroll history while the header stays visible', async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Chromium native touch input');
  await page.setViewportSize({ width: 390, height: 500 });
  await page.goto('/#/dev/gallery');
  const history = page.locator('.chat__scroll');
  const header = page.locator('.appbar');
  await expect(history).toBeVisible();
  const headerBefore = await header.boundingBox();
  const client = await context.newCDPSession(page);
  const drag = async (startY: number, endY: number) => {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 180, y: startY }] });
    for (let step = 1; step <= 8; step += 1) {
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: [{ x: 180, y: startY + (endY - startY) * step / 8 }],
      });
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await drag(390, 180);
  await expect.poll(() => history.evaluate((element) => element.scrollTop)).toBeGreaterThan(50);
  await history.evaluate((element) => element.scrollTo(0, element.scrollHeight));
  await drag(390, 180);
  await expect(header).toBeInViewport();
  expect((await header.boundingBox())!.y).toBe(headerBefore!.y);
  await history.evaluate((element) => element.scrollTo(0, 0));
  await drag(180, 390);
  await expect.poll(() => history.evaluate((element) => element.scrollTop)).toBe(0);
  await expect(header).toBeInViewport();
  await testInfo.attach('native-history-scroll', { body: await page.screenshot(), contentType: 'image/png' });
  await client.detach();
});