import { expect, test } from '@playwright/test';

test.describe('iOS Safari reliability', () => {
  test.skip(({ browserName }) => browserName !== 'webkit', 'WebKit-specific regression coverage');

  test('tracks an overlay keyboard and preserves touch scrolling', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

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
        innerHeight: window.innerHeight,
      };
    });

    expect(metrics.appHeight).toBe(`${metrics.innerHeight}px`);
    expect(metrics.keyboardInset).toBe('260px');
    expect(pageErrors).toEqual([]);
  });
});