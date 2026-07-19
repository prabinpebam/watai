import { expect, test, type Page, type TestInfo } from '@playwright/test';

const ROOT = '/#/dev/library-eval';

async function attachState(page: Page, testInfo: TestInfo, name: string) {
  const state = await page.locator('.library, .library-detail').evaluate((root) => ({
    route: location.hash,
    viewport: { width: innerWidth, height: innerHeight },
    title: root.querySelector('h1')?.textContent?.trim() ?? '',
    itemIds: [...root.querySelectorAll<HTMLElement>('[data-library-item-id]')].map((element) => element.dataset.libraryItemId),
    controls: [...root.querySelectorAll<HTMLElement>('button, input, select, a')].map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        role: element.getAttribute('role') ?? element.tagName.toLowerCase(),
        name: element.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 80) ?? '',
        visible: rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden',
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    }),
    scroll: { width: root.scrollWidth, clientWidth: root.clientWidth, height: root.scrollHeight, clientHeight: root.clientHeight },
  }));
  await testInfo.attach(`${name}-dom-state`, { body: JSON.stringify(state, null, 2), contentType: 'application/json' });
  await testInfo.attach(`${name}-screenshot`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
}

async function expectCenterHit(page: Page, selector: string) {
  await expect.poll(() => page.locator(selector).first().evaluate((element, targetSelector) => {
    const rect = element.getBoundingClientRect();
    const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return target === element || !!target?.closest(targetSelector);
  }, selector)).toBe(true);
}

test.describe('Library read-only experience', () => {
  test('desktop browse, URL filters, keyboard search, image paint, detail, and focus return', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Desktop-specific shell and density checks');
    await page.goto(ROOT);
    await expect(page.getByText('A precise Watai launch poster with crisp cobalt typography')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Library' })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.library-row')).toHaveCount(8);
    const rowHeights = await page.locator('.library-row').evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height));
    expect(rowHeights.every((height) => height >= 64)).toBe(true);

    await page.keyboard.press('/');
    await expect(page.getByPlaceholder('Search files, prompts, and chats…')).toBeFocused();
    await page.getByPlaceholder('Search files, prompts, and chats…').fill('poster');
    await expect(page).toHaveURL(/q=poster/);
    await expect(page.locator('.library-row')).toHaveCount(1);
    await page.getByLabel('Clear search').click();
    await expect(page.locator('.library-row')).toHaveCount(8);

    await page.getByRole('tab', { name: 'Images' }).click();
    await expect(page).toHaveURL(/kind=image/);
    await expect(page.locator('.library-tile')).toHaveCount(2);
    const firstImage = page.locator('.library-tile img').first();
    await expect(firstImage).toBeVisible();
    await expect.poll(() => firstImage.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    await expectCenterHit(page, '.library-tile');

    const tile = page.locator('[data-library-item-id="generated-image"]');
    await tile.click();
    await expect(page).toHaveURL(/generated-image$/);
    await expect(page.getByRole('img', { name: /launch poster/i })).toBeVisible();
    await expect(page.getByText('Reference history is unavailable for this older image.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show in chat' })).toBeVisible();
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page).toHaveURL(/kind=image/);
    await expect(page.locator('[data-library-item-id="generated-image"]')).toBeFocused();
    await attachState(page, testInfo, 'desktop-browse');
  });

  test('desktop type-specific details are honest and usable', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Desktop detail matrix');

    await page.goto(`${ROOT}/brief-pdf`);
    const pdf = page.locator('iframe.library-pdf');
    await expect(pdf).toBeVisible();
    expect((await pdf.boundingBox())?.height).toBeGreaterThan(500);
    await expect(page.getByRole('heading', { name: 'Derived outputs' })).toBeVisible();
    await page.getByRole('button', { name: /metrics.csv/ }).click();
    await expect(page).toHaveURL(/metrics-csv$/);
    await expect(page.getByRole('cell', { name: '388' })).toBeVisible();

    await page.goto(`${ROOT}/notes-md`);
    await expect(page.getByRole('heading', { name: 'Release notes' })).toBeVisible();
    await expect(page.getByText('Type-aware preview')).toBeVisible();

    await page.goto(`${ROOT}/script-ts`);
    await expect(page.locator('.library-source pre')).toContainText('status = "ready"');
    await expect(page.getByRole('button', { name: 'Copy' })).toBeVisible();

    await page.goto(`${ROOT}/metrics-csv`);
    await expect(page.locator('.library-csv table')).toBeVisible();
    await expect(page.getByRole('cell', { name: '388' })).toBeVisible();

    await page.goto(`${ROOT}/deck-pptx`);
    await expect(page.getByText('Preview isn’t available for this file type.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download' })).toBeEnabled();
    await attachState(page, testInfo, 'desktop-detail-matrix');
  });

  test('empty and recoverable error states expose clear actions', async ({ page }, testInfo) => {
    await page.goto(`${ROOT}?fixture=empty`);
    await expect(page.getByRole('heading', { name: 'Your Library is empty' })).toBeVisible();
    await expect(page.getByText('Files you upload and content Watai creates will appear here.')).toBeVisible();

    await page.goto(`${ROOT}?fixture=error-once-${testInfo.project.name}`);
    await expect(page.getByRole('heading', { name: 'We couldn’t load your Library' })).toBeVisible();
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.locator('.library-row')).toHaveCount(8);
    await attachState(page, testInfo, `${testInfo.project.name}-recovery`);
  });

  test('mobile drawer, two-column gallery, touch targets, and detail bar do not overlap', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'Mobile-specific shell and hit-target checks');
    await page.goto(`${ROOT}?kind=image`);
    await expect(page.locator('.library-tile')).toHaveCount(2);
    const columns = await page.locator('.library-grid').evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(' ').length);
    expect(columns).toBe(2);
    const overflow = await page.locator('.library').evaluate((root) => root.scrollWidth - root.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    await page.getByRole('button', { name: 'Open menu' }).click();
    const drawer = page.locator('.drawer');
    await expect(drawer).toBeVisible();
    const libraryNav = drawer.getByRole('button', { name: 'Library' });
    await expect(libraryNav).toHaveAttribute('aria-current', 'page');
    const navBox = await libraryNav.boundingBox();
    expect(navBox?.height).toBeGreaterThanOrEqual(44);
    await expectCenterHit(page, '.drawer .btn[aria-current="page"]');
    await page.getByRole('button', { name: 'Close menu' }).click();

    await page.locator('[data-library-item-id="generated-image"]').click();
    await expect(page.getByRole('img', { name: /launch poster/i })).toBeVisible();
    const barBoxes = await page.locator('.library-detail__bar > *').evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    }));
    for (let index = 1; index < barBoxes.length; index++) expect(barBoxes[index].left).toBeGreaterThanOrEqual(barBoxes[index - 1].right - 1);
    const viewportWidth = await page.evaluate(() => innerWidth);
    expect(barBoxes.every((box) => box.left >= 0 && box.right <= viewportWidth)).toBe(true);
    await attachState(page, testInfo, 'mobile-layout');
  });
});
