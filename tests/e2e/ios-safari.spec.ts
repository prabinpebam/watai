import { expect, test } from '@playwright/test';

test.describe('iOS Safari reliability', () => {
  test.skip(({ browserName }) => browserName !== 'webkit', 'WebKit-specific regression coverage');

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const handlers = new Set<EventListener>();
      const viewport = {
        height: window.innerHeight,
        offsetTop: 0,
        addEventListener: (type: string, handler: EventListener) => {
          if (type === 'resize') handlers.add(handler);
        },
        removeEventListener: (type: string, handler: EventListener) => {
          if (type === 'resize') handlers.delete(handler);
        },
      };
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
      Object.defineProperty(window, '__setTestVisualViewport', {
        configurable: true,
        value: (height: number) => {
          viewport.height = height;
          handlers.forEach((handler) => handler(new Event('resize')));
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
        keyboardInset: document.documentElement.style.getPropertyValue('--keyboard-inset'),
        keyboardOpen: document.documentElement.hasAttribute('data-keyboard-open'),
        innerHeight: window.innerHeight,
      };
    });

    expect(metrics.appHeight).toBe(`${metrics.innerHeight}px`);
    expect(metrics.keyboardInset).toBe('260px');
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
      (window as typeof window & { __setTestVisualViewport(height: number): void })
        .__setTestVisualViewport(window.innerHeight - keyboardHeight);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const bottom = textarea.getBoundingClientRect().bottom;
      return window.innerHeight - keyboardHeight - bottom;
    });

    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThanOrEqual(24);
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