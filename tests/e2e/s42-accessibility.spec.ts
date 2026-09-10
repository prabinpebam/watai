import { expect, test } from '@playwright/test';

function contrastScript() {
  return [...document.querySelectorAll<HTMLElement>('.library-results-count, .library-row__meta')].map((element) => {
    const parse = (value: string) => value.match(/[\d.]+/g)!.slice(0, 3).map(Number);
    const luminance = (rgb: number[]) => {
      const channels = rgb.map((value) => value / 255).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    const style = getComputedStyle(element);
    const foreground = luminance(parse(style.color));
    let parent: HTMLElement | null = element;
    let background = [255, 255, 255];
    while (parent) {
      const color = getComputedStyle(parent).backgroundColor;
      if (color && color !== 'transparent' && !color.endsWith(', 0)')) { background = parse(color); break; }
      parent = parent.parentElement;
    }
    const backgroundLuminance = luminance(background);
    return (Math.max(foreground, backgroundLuminance) + 0.05) / (Math.min(foreground, backgroundLuminance) + 0.05);
  });
}

test('@desktop-only S42 canary keeps informative text and controls usable at 320px and 200% text', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/#/dev/library-eval');
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await expect(page.locator('.library-row')).toHaveCount(8);

  expect(await page.locator('meta[name="viewport"]').getAttribute('content')).not.toContain('user-scalable=no');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(contrastScript)).toEqual(expect.arrayContaining([expect.any(Number)]));
  expect((await page.evaluate(contrastScript)).every((ratio) => ratio >= 4.5)).toBe(true);

  for (const control of await page.locator('button:visible, input:visible').all()) {
    await control.scrollIntoViewIfNeeded();
    const hit = await control.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return rect.width > 0 && rect.height > 0 && (target === element || element.contains(target));
    });
    expect(hit).toBe(true);
  }
});