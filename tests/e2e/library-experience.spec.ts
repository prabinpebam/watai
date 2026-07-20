import { expect, test, type Page, type TestInfo } from '@playwright/test';

const ROOT = '/#/dev/library-eval';
const PICKER_ROOT = '/#/dev/library-picker-eval';

async function attachState(page: Page, testInfo: TestInfo, name: string, rootSelector = '.library, .library-detail') {
  const state = await page.locator(rootSelector).evaluate((root) => ({
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
  test('catalog loading uses structural shimmer and no circular spinner', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'One project is sufficient for loading-state paint');
    await page.goto(`${ROOT}?fixture=slow`);
    await expect(page.getByRole('status', { name: 'Loading Library' })).toBeVisible();
    await expect(page.locator('.library-skeleton-row')).toHaveCount(8);
    await expect(page.locator('.library__results .spinner')).toHaveCount(0);
    await expect(page.locator('.library-row')).toHaveCount(8);
  });

  test('image columns justify the full width and reduce only at the minimum tile size', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'One project drives the responsive width matrix');
    await page.goto(`${ROOT}?kind=image`);
    await expect(page.locator('.library-tile')).toHaveCount(2);
    const widths = [390, 560, 760, 1024, 1440];
    const measurements: Array<{ viewport: number; gridWidth: number; tracks: number[]; gap: number; overflow: number }> = [];
    for (const width of widths) {
      await page.setViewportSize({ width, height: 844 });
      await expect.poll(() => page.locator('.library').evaluate((root) => root.scrollWidth - root.clientWidth)).toBeLessThanOrEqual(1);
      measurements.push(await page.locator('.library-grid').evaluate((grid, viewport) => {
        const style = getComputedStyle(grid);
        return {
          viewport,
          gridWidth: grid.getBoundingClientRect().width,
          tracks: style.gridTemplateColumns.split(' ').map(Number.parseFloat),
          gap: Number.parseFloat(style.columnGap),
          overflow: document.querySelector<HTMLElement>('.library')!.scrollWidth - document.querySelector<HTMLElement>('.library')!.clientWidth,
        };
      }, width));
    }
    for (const measurement of measurements) {
      expect(Math.max(...measurement.tracks) - Math.min(...measurement.tracks)).toBeLessThanOrEqual(1);
      expect(Math.min(...measurement.tracks)).toBeGreaterThanOrEqual(179);
      const occupied = measurement.tracks.reduce((sum, track) => sum + track, 0) + (measurement.tracks.length - 1) * measurement.gap;
      expect(Math.abs(occupied - measurement.gridWidth)).toBeLessThanOrEqual(1);
      expect(measurement.overflow).toBeLessThanOrEqual(1);
    }
    expect(measurements.find((measurement) => measurement.viewport === 390)?.tracks).toHaveLength(2);
    expect(measurements.find((measurement) => measurement.viewport === 760)?.tracks).toHaveLength(4);
    expect(measurements.find((measurement) => measurement.viewport === 1440)?.tracks).toHaveLength(5);
  });

  test('desktop browse, URL filters, keyboard search, image paint, detail, and focus return', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Desktop-specific shell and density checks');
    await page.goto(ROOT);
    await expect(page.getByText('A precise Watai launch poster with crisp cobalt typography')).toBeVisible();
    const hiddenGeometry = await page.locator('.sr-only').evaluateAll((elements) => elements.map((element) => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height, position: getComputedStyle(element).position, overflow: getComputedStyle(element).overflow })));
    expect(hiddenGeometry.every(({ width, height, position, overflow }) => width <= 1 && height <= 1 && position === 'absolute' && overflow === 'hidden')).toBe(true);
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

  test('composer picker stages compatible items, exposes unavailable reasons, toggles image mode, and sends refs', async ({ page }, testInfo) => {
    await page.goto(PICKER_ROOT);
    await page.getByRole('button', { name: 'Add attachment' }).click();
    await page.getByRole('menuitem', { name: 'Add from Library' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add from Library' });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Search Library' })).toBeFocused();

    await expect(dialog.getByText('Assets.zip')).toHaveCount(0);
    await dialog.getByRole('checkbox', { name: 'Show unavailable' }).check();
    const unavailable = dialog.getByRole('button', { name: /assets\.zip/i });
    await expect(unavailable).toBeDisabled();
    await expect(unavailable).toHaveAttribute('title', /download-only/);

    await dialog.getByRole('button', { name: /reference.png/ }).click();
    await dialog.getByRole('button', { name: /launch-brief.pdf/ }).click();
    const dialogBox = await dialog.boundingBox();
    if (testInfo.project.name === 'mobile' && dialogBox) {
      const viewportHeight = await page.evaluate(() => innerHeight);
      expect(dialogBox.y + dialogBox.height).toBeLessThanOrEqual(viewportHeight + 1);
      expect(dialogBox.height).toBeLessThanOrEqual(viewportHeight * 0.9);
    }
    const done = dialog.getByRole('button', { name: 'Done (2)' });
    await done.focus();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
    await done.click();

    await expect(page.getByText('reference.png')).toBeVisible();
    await expect(page.getByText('launch-brief.pdf')).toBeVisible();
    const mode = page.getByRole('button', { name: /Attach for analysis: reference.png/ });
    await mode.click();
    await expect(page.getByRole('button', { name: /Use as generation reference: reference.png/ })).toBeVisible();
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByTestId('submitted-items')).toContainText('uploaded-image:reference');
    await expect(page.getByTestId('submitted-items')).toContainText('brief-pdf:attach');

    await attachState(page, testInfo, `${testInfo.project.name}-picker`, '.library-picker-eval');
  });

  test('direct upload shows progress, uses one reservation PUT, finalizes, and appears in Library', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'One browser project is sufficient for the upload transaction');
    let putCount = 0;
    await page.route('https://fixture.blob/**', async (route) => {
      putCount++;
      expect(route.request().method()).toBe('PUT');
      expect(route.request().headers()['x-ms-blob-type']).toBe('BlockBlob');
      await route.fulfill({ status: 201, body: '' });
    });
    await page.goto(ROOT);
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Upload' }).click();
    await (await chooser).setFiles({ name: 'experience.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF experience') });
    const uploadRow = page.getByLabel('Uploads').getByText('experience.pdf').locator('..');
    await expect(uploadRow).toContainText('100%');
    await expect(page.getByRole('button', { name: /experience.pdf/ })).toBeVisible();
    expect(putCount).toBe(1);
    await attachState(page, testInfo, 'desktop-upload');
  });

  test('Use in new chat stages the item in a minted lazy thread and does not auto-send', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'One project is sufficient for navigation semantics');
    await page.goto(`${ROOT}/generated-image`);
    await page.getByRole('button', { name: 'Use in new chat' }).click();
    await expect(page).toHaveURL(/#\/dev\/library-new-chat-eval\/.+/);
    await expect(page.getByText('launch-poster.png')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible();
    await expect(page.getByTestId('submitted-items')).toHaveText('');
    await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled();
    await attachState(page, testInfo, 'desktop-use-new-chat', '.library-picker-eval');
  });
});
