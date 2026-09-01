import { expect, test } from '@playwright/test';

test.describe('iOS Safari reliability', () => {
  test.skip(({ browserName }) => browserName !== 'webkit', 'WebKit-specific regression coverage');

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const resizeHandlers = new Set<EventListener>();
      const scrollHandlers = new Set<EventListener>();
      const viewport = {
        height: window.innerHeight,
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
        keyboardOpen: document.documentElement.hasAttribute('data-keyboard-open'),
        innerHeight: window.innerHeight,
      };
    });

    expect(metrics.appHeight).toBe(`${metrics.innerHeight - 260}px`);
  expect(metrics.appTop).toBe('');
    expect(metrics.keyboardOpen).toBe(true);
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
      const keyboardOpen = document.documentElement.hasAttribute('data-keyboard-open');
      // The CSS focus trigger is intentional defense in depth: layout must remain correct even
      // when a browser's viewport metrics make inferred keyboard state transiently ambiguous.
      document.documentElement.removeAttribute('data-keyboard-open');
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const rect = textarea.getBoundingClientRect();
      return {
        keyboardOpen,
        bottom: rect.bottom,
        visibleBottom: window.innerHeight,
      };
    });

    expect(geometry.keyboardOpen).toBe(true);
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
});