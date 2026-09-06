import { expect, test } from '@playwright/test';

test.describe('iOS Safari reliability', () => {
  test.skip(({ browserName }) => browserName !== 'webkit', 'WebKit-specific regression coverage');

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const resizeHandlers = new Set<EventListener>();
      const scrollHandlers = new Set<EventListener>();
      const nativeViewport = window.visualViewport;
      let simulatedHeight: number | undefined;
      const viewport = {
        get height() { return simulatedHeight ?? nativeViewport?.height ?? window.innerHeight; },
        set height(value: number) { simulatedHeight = value; },
        offsetTop: 0,
        scale: 1,
        addEventListener: (type: string, handler: EventListener) => {
          if (type === 'resize') resizeHandlers.add(handler);
          if (type === 'scroll') scrollHandlers.add(handler);
        },
        removeEventListener: (type: string, handler: EventListener) => {
          if (type === 'resize') resizeHandlers.delete(handler);
          if (type === 'scroll') scrollHandlers.delete(handler);
        },
      };
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
      Object.defineProperty(window, '__setTestVisualViewport', {
        configurable: true,
        value: (height: number, offsetTop = 0) => {
          viewport.height = height;
          viewport.offsetTop = offsetTop;
          resizeHandlers.forEach((handler) => handler(new Event('resize')));
        },
      });
      Object.defineProperty(window, '__panTestVisualViewport', {
        configurable: true,
        value: (offsetTop: number) => {
          viewport.offsetTop = offsetTop;
          scrollHandlers.forEach((handler) => handler(new Event('scroll')));
        },
      });
      Object.defineProperty(window, '__setTestViewports', {
        configurable: true,
        value: (height: number) => {
          Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
          viewport.height = height;
          resizeHandlers.forEach((handler) => handler(new Event('resize')));
          window.dispatchEvent(new Event('resize'));
        },
      });
    });
  });

  test('tracks an overlay keyboard and preserves touch scrolling', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/#/dev/gallery');
    const scroller = page.locator('.chat__scroll');
    await expect(scroller).toBeVisible();
    await scroller.evaluate((element) => element.scrollTo(0, element.scrollHeight));
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

    const metrics = await page.evaluate(async () => {
      const textarea = document.createElement('textarea');
      document.body.append(textarea);
      textarea.focus();
      (window as typeof window & { __setTestVisualViewport(height: number): void })
        .__setTestVisualViewport(window.innerHeight - 260);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return {
        appHeight: document.documentElement.style.getPropertyValue('--app-height'),
        appTop: document.documentElement.style.getPropertyValue('--app-top'),
        innerHeight: window.innerHeight,
      };
    });

    expect(metrics.appHeight).toBe(`${metrics.innerHeight - 260}px`);
    expect(metrics.appTop).toBe('');
    expect(pageErrors).toEqual([]);
  });

  test('docks an empty-chat composer at the keyboard edge', async ({ page }) => {
    await page.goto('/#/dev/gallery');
    await expect(page.getByText('Chat components DEV')).toBeVisible();
    const gap = await page.evaluate(async () => {
      const root = document.querySelector('#root');
      if (!root) throw new Error('Missing app root');
      root.innerHTML = `
        <div class="app">
          <main class="app__main">
            <div class="chat-area">
              <div class="chat chat--empty">
                <div class="chat__scroll"></div>
                <div class="chat__intro"><div class="empty__greeting">Start a chat</div></div>
                <div class="composer-slot">
                  <div class="composer-wrap">
                    <div class="composer">
                      <div class="composer__input">
                        <textarea class="composer__textarea" aria-label="Message"></textarea>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </main>
        </div>`;
      const textarea = root.querySelector<HTMLTextAreaElement>('textarea');
      if (!textarea) throw new Error('Missing composer textarea');
      textarea.focus();
      const keyboardHeight = 260;
      (window as typeof window & { __setTestVisualViewport(height: number, offsetTop?: number): void })
        .__setTestVisualViewport(window.innerHeight - keyboardHeight);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const rect = textarea.getBoundingClientRect();
      const viewport = window.visualViewport!;
      return {
        top: rect.top,
        bottom: rect.bottom,
        visualTop: viewport.offsetTop,
        visualBottom: viewport.offsetTop + viewport.height,
      };
    });

    expect(gap.top).toBeGreaterThanOrEqual(gap.visualTop);
    expect(gap.bottom).toBeLessThanOrEqual(gap.visualBottom);
    expect(gap.visualBottom - gap.bottom).toBeLessThanOrEqual(24);
  });

  test('docks correctly when iOS shrinks both layout and visual viewports', async ({ page }) => {
    await page.goto('/#/dev/gallery');
    await expect(page.getByText('Chat components DEV')).toBeVisible();
    const geometry = await page.evaluate(async () => {
      const root = document.querySelector('#root');
      if (!root) throw new Error('Missing app root');
      root.innerHTML = `
        <div class="app"><main class="app__main"><div class="chat-area">
          <div class="chat chat--empty"><div class="chat__scroll"></div>
            <div class="chat__intro"><div class="empty__greeting">Start a chat</div></div>
            <div class="composer-slot"><div class="composer-wrap"><div class="composer">
              <div class="composer__input"><textarea class="composer__textarea" aria-label="Message"></textarea></div>
            </div></div></div>
          </div>
        </div></main></div>`;
      const textarea = root.querySelector<HTMLTextAreaElement>('textarea');
      if (!textarea) throw new Error('Missing composer textarea');
      const fullHeight = window.innerHeight;
      textarea.focus();
      (window as typeof window & { __setTestViewports(height: number): void })
        .__setTestViewports(fullHeight - 260);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const rect = textarea.getBoundingClientRect();
      return {
        bottom: rect.bottom,
        visibleBottom: window.innerHeight,
      };
    });

    expect(geometry.bottom).toBeLessThanOrEqual(geometry.visibleBottom);
    expect(geometry.visibleBottom - geometry.bottom).toBeLessThanOrEqual(24);
  });

  test('keeps the whole chat visible without chasing Safari focus panning', async ({ page }) => {
    await page.goto('/#/dev/gallery');
    await expect(page.getByText('Chat components DEV')).toBeVisible();
    const geometry = await page.evaluate(async () => {
      const root = document.querySelector('#root');
      if (!root) throw new Error('Missing app root');
      root.innerHTML = `
        <div class="app">
          <main class="app__main">
            <div class="chat-area">
              <div class="chat">
                <div class="chat__scroll">
                  <div class="chat__column">
                    <div style="height: 700px"></div>
                    <div data-last-message style="height: 40px">Latest message</div>
                  </div>
                </div>
                <div class="composer-slot">
                  <div class="composer-wrap">
                    <div class="composer">
                      <div class="composer__input">
                        <textarea class="composer__textarea" aria-label="Message"></textarea>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </main>
        </div>`;
      const textarea = root.querySelector<HTMLTextAreaElement>('textarea');
      const scroller = root.querySelector<HTMLElement>('.chat__scroll');
      const lastMessage = root.querySelector<HTMLElement>('[data-last-message]');
      const app = root.querySelector<HTMLElement>('.app');
      if (!textarea || !scroller || !lastMessage || !app) throw new Error('Incomplete fixture');
      textarea.focus();
      const visualHeight = window.innerHeight - 260;
      (window as typeof window & { __setTestVisualViewport(height: number, offsetTop?: number): void })
        .__setTestVisualViewport(visualHeight);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const appRectBeforePan = app.getBoundingClientRect();
      const offsetTop = 84;
      (window as typeof window & { __panTestVisualViewport(offsetTop: number): void })
        .__panTestVisualViewport(offsetTop);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      scroller.style.scrollBehavior = 'auto';
      scroller.scrollTop = scroller.scrollHeight;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const visualBottom = offsetTop + visualHeight;
      const appRect = app.getBoundingClientRect();
      const editorRect = textarea.getBoundingClientRect();
      const messageRect = lastMessage.getBoundingClientRect();
      return { offsetTop, visualBottom, appRectBeforePan, appRect, editorRect, messageRect };
    });

    expect(geometry.appRect.top).toBeCloseTo(geometry.appRectBeforePan.top, 0);
    expect(geometry.appRect.bottom).toBeCloseTo(geometry.appRectBeforePan.bottom, 0);
    expect(geometry.editorRect.top).toBeGreaterThanOrEqual(geometry.offsetTop);
    expect(geometry.editorRect.bottom).toBeLessThanOrEqual(geometry.visualBottom);
    expect(geometry.messageRect.bottom).toBeGreaterThan(geometry.offsetTop);
    expect(geometry.messageRect.bottom).toBeLessThanOrEqual(geometry.editorRect.top);
  });

  test('preserves textarea focus and geometry while Safari emits pan events during typing', async ({ page }) => {
    await page.goto('/#/dev/gallery');
    await expect(page.getByText('Chat components DEV')).toBeVisible();
    const result = await page.evaluate(async () => {
      const root = document.querySelector('#root');
      if (!root) throw new Error('Missing app root');
      root.innerHTML = `
        <div class="app"><main class="app__main"><div class="chat-area">
          <div class="chat chat--empty"><div class="chat__scroll"></div>
            <div class="composer-slot"><div class="composer-wrap"><div class="composer">
              <div class="composer__input"><textarea class="composer__textarea" aria-label="Message"></textarea></div>
            </div></div></div>
          </div>
        </div></main></div>`;
      const textarea = root.querySelector<HTMLTextAreaElement>('textarea');
      const app = root.querySelector<HTMLElement>('.app');
      if (!textarea || !app) throw new Error('Incomplete fixture');
      textarea.focus();
      (window as typeof window & { __setTestVisualViewport(height: number): void })
        .__setTestVisualViewport(window.innerHeight - 260);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const before = textarea.getBoundingClientRect();
      const appBefore = app.getBoundingClientRect();
      for (let index = 0; index < 8; index += 1) {
        textarea.value += String(index);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        (window as typeof window & { __panTestVisualViewport(offsetTop: number): void })
          .__panTestVisualViewport(12 * (index + 1));
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      return {
        focused: document.activeElement === textarea,
        value: textarea.value,
        before,
        after: textarea.getBoundingClientRect(),
        appBefore,
        appAfter: app.getBoundingClientRect(),
      };
    });

    expect(result.focused).toBe(true);
    expect(result.value).toBe('01234567');
    expect(result.after.top).toBeCloseTo(result.before.top, 0);
    expect(result.after.bottom).toBeCloseTo(result.before.bottom, 0);
    expect(result.appAfter.top).toBeCloseTo(result.appBefore.top, 0);
    expect(result.appAfter.bottom).toBeCloseTo(result.appBefore.bottom, 0);
  });

  test('keeps the composer editor above the iOS focus-zoom threshold', async ({ page }) => {
    await page.goto('/#/dev/gallery');

    const fontSize = await page.evaluate(() => {
      document.documentElement.style.fontSize = '14.4px';
      const textarea = document.createElement('textarea');
      textarea.className = 'composer__textarea';
      document.body.append(textarea);
      return getComputedStyle(textarea).fontSize;
    });

    expect(fontSize).toBe('16px');
  });

  test('real message history follows viewport resizing only while pinned to latest', async ({ page }) => {
    await page.goto('/#/dev/gallery');
    await expect(page.getByText('Chat components DEV')).toBeVisible();
    await page.evaluate(async () => {
      const modulePath = '/src/data/local/localRepository.ts';
      const { LocalRepository } = await import(modulePath);
      const local = new LocalRepository();
      await local.createThread({ id: 'viewport-eval' });
      for (let index = 0; index < 20; index += 1) {
        await local.appendMessage({
          id: `viewport-message-${index}`,
          threadId: 'viewport-eval',
          role: 'assistant',
          content: index === 19 ? 'Latest viewport reply' : `Reply ${index}. ${'A message with enough text to exercise the history scroller. '.repeat(4)}`,
          status: 'complete',
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
        });
      }
    });
    await page.goto('/#/dev/gallery?chat');
    const scroller = page.locator('.chat__scroll');
    const distanceFromBottom = () => scroller.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop);
    await expect(page.getByText('Latest viewport reply')).toBeVisible();
    await expect.poll(distanceFromBottom).toBeLessThanOrEqual(1);
    const fullHeight = await page.evaluate(() => window.innerHeight);
    await page.getByRole('textbox', { name: 'Message', exact: true }).tap();
    await page.evaluate((height) => {
      (window as typeof window & { __setTestVisualViewport(height: number): void })
        .__setTestVisualViewport(height);
    }, fullHeight - 300);
    await expect.poll(() => page.locator('.app').evaluate((element) => element.clientHeight)).toBe(fullHeight - 300);
    await expect.poll(distanceFromBottom).toBeLessThanOrEqual(1);
    await expect(page.getByText('Latest viewport reply')).toBeInViewport();

    await scroller.evaluate((element) => element.scrollTo(0, 250));
    await expect(page.getByRole('button', { name: 'Jump to latest' })).toBeVisible();
    await page.evaluate((height) => {
      (window as typeof window & { __setTestVisualViewport(height: number): void })
        .__setTestVisualViewport(height);
    }, fullHeight);
    await expect.poll(() => page.locator('.app').evaluate((element) => element.clientHeight)).toBe(fullHeight);
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(250);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test('real composer stays docked through focus, typing, blur, and keyboard dismissal', async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/#/dev/gallery?chat');
    const editor = page.getByRole('textbox', { name: 'Message', exact: true });
    const header = page.getByRole('button', { name: 'Back to app' });
    await expect(page.locator('.chat--empty')).toBeVisible();
    await expect(editor).toBeVisible();
    const fullHeight = await page.evaluate(() => window.innerHeight);

    for (let cycle = 0; cycle < 3; cycle += 1) {
      await editor.evaluate((element) => element.blur());
      const beforeFocus = await editor.boundingBox();
      await editor.tap();
      await expect(editor).toBeFocused();
      const afterFocus = await editor.boundingBox();
      expect(afterFocus!.y).toBeCloseTo(beforeFocus!.y, 0);

      await page.evaluate((height) => {
        (window as typeof window & { __setTestVisualViewport(height: number): void })
          .__setTestVisualViewport(height);
      }, fullHeight - 300);
      await expect.poll(() => page.locator('.app').evaluate((element) => element.clientHeight)).toBe(fullHeight - 300);
      await editor.pressSequentially(`Keyboard cycle ${cycle}. `);
      await expect(editor).toBeFocused();
      await expect(editor).toHaveValue(new RegExp(`Keyboard cycle ${cycle}`));
      await expect.poll(() => editor.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) === element;
      })).toBe(true);

      const whileOpen = await editor.boundingBox();
      await editor.evaluate((element) => element.blur());
      await expect.poll(() => page.locator('.app').evaluate((element) => element.clientHeight)).toBe(fullHeight - 300);
      expect((await editor.boundingBox())!.y).toBeCloseTo(whileOpen!.y, 0);
      await editor.tap();
      await page.evaluate((height) => {
        (window as typeof window & { __setTestVisualViewport(height: number): void })
          .__setTestVisualViewport(height);
      }, fullHeight);
      await expect.poll(() => page.locator('.app').evaluate((element) => element.clientHeight)).toBe(fullHeight);
      await expect(editor).toBeFocused();
      await expect(header).toBeInViewport();
    }

    await page.evaluate((height) => {
      (window as typeof window & { __setTestVisualViewport(height: number): void })
        .__setTestVisualViewport(height);
    }, fullHeight - 300);
    await editor.fill('A multiline prompt with enough content to fill the editor. '.repeat(20));
    await expect(page.locator('.composer--multiline')).toBeVisible();
    await expect.poll(() => page.locator('.composer').evaluate((element) => element.getAnimations().length)).toBe(0);
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeInViewport();
    await expect(header).toBeInViewport();
    const geometry = await page.evaluate(() => {
      window.scrollTo(0, 500);
      const app = document.querySelector('.app')!;
      const composer = document.querySelector('.composer')!;
      return {
        windowScroll: window.scrollY,
        bodyScroll: document.body.scrollTop,
        rootScroll: document.querySelector('#root')!.scrollTop,
        appTop: app.getBoundingClientRect().top,
        composerBottom: composer.getBoundingClientRect().bottom,
        visibleBottom: window.visualViewport!.height,
      };
    });
    expect(geometry.windowScroll).toBe(0);
    expect(geometry.bodyScroll).toBe(0);
    expect(geometry.rootScroll).toBe(0);
    expect(geometry.appTop).toBe(0);
    expect(geometry.composerBottom).toBeLessThanOrEqual(geometry.visibleBottom);
    expect(errors).toEqual([]);
    await testInfo.attach('real-composer-keyboard', { body: await page.screenshot(), contentType: 'image/png' });
  });
});

test('desktop empty composer does not jump on focus', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop focus regression');
  await page.goto('/#/dev/gallery?chat');
  await expect(page.locator('.chat--empty')).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'Message', exact: true });
  await editor.evaluate((element) => element.blur());
  const before = await editor.boundingBox();
  await editor.click();
  await editor.pressSequentially('Desktop focus');
  await expect(editor).toBeFocused();
  expect((await editor.boundingBox())!.y).toBeCloseTo(before!.y, 0);
  await testInfo.attach('desktop-empty-composer', { body: await page.screenshot(), contentType: 'image/png' });
});