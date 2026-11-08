import { expect, test } from '@playwright/test';

// Headless Chromium hides scrollbars by default; this file needs real classic scrollbars.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

test('keeps the last graph column aligned with the settings button at its right end with a vertical scrollbar, highlighting full rows', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 700 });
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.addStyleTag({ content: '.commit-list { overflow-y: scroll !important; }' });
  const list = page.locator('.commit-list');
  await expect.poll(() => list.evaluate((element) => {
    if (!(element instanceof HTMLElement)) throw new Error('The commit list must be an HTML element.');
    return element.offsetWidth - element.clientWidth;
  })).toBeGreaterThan(0);
  await page.setViewportSize({ width: 1601, height: 700 });
  const dateSeparator = page.getByRole('separator', { name: 'Resize Date and Time column', exact: true });
  const geometry = () => page.evaluate(() => {
    const headings = [...document.querySelectorAll<HTMLElement>('.graph-columns > .draggable-column')];
    const last = headings.reduce((a, b) => (b.getBoundingClientRect().right > a.getBoundingClientRect().right ? b : a));
    const rowDate = document.querySelector('.commit-row:not(.wip-row) .row-date')!.getBoundingClientRect();
    const row = document.querySelector('.commit-row:not(.wip-row)')!;
    const rowEnd = row.getBoundingClientRect().right;
    const cellsEnd = Math.max(...[...row.children].map((cell) => cell.getBoundingClientRect().right));
    const button = document.querySelector('.graph-settings-toggle')!.getBoundingClientRect();
    return { headerRight: last.getBoundingClientRect().right, rowRight: rowDate.right, buttonLeft: button.left, rowCovers: rowEnd >= cellsEnd - 0.5 };
  });
  const expectAligned = async () => {
    await expect.poll(async () => {
      const { headerRight, rowRight, buttonLeft, rowCovers } = await geometry();
      // The settings button stays rightmost, inside the trailing column's right end.
      return rowCovers && Math.abs(headerRight - rowRight) <= 1 && buttonLeft >= headerRight - 32 && buttonLeft < headerRight;
    }).toBe(true);
  };
  await expectAligned();
  await dateSeparator.focus();
  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Shift+ArrowLeft');
  await expectAligned();
  for (let step = 0; step < 4; step++) {
    await page.getByRole('separator', { name: 'Resize Commit Message column', exact: true }).focus();
    await page.keyboard.press('End');
  }
  await list.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  await expectAligned();
  await dateSeparator.focus();
  await page.keyboard.press('Shift+ArrowLeft');
  await list.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  await expectAligned();
  await page.keyboard.press('Home');
  await list.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  await expectAligned();
});

test('never lets graph headings or row cells overlap while columns overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 700 });
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.addStyleTag({ content: '.commit-list { overflow-y: scroll !important; }' });
  const messageSeparator = page.getByRole('separator', { name: 'Resize Commit Message column', exact: true });
  for (let step = 0; step < 4; step++) {
    await messageSeparator.focus();
    await page.keyboard.press('End');
  }
  const maximumWidth = await messageSeparator.getAttribute('aria-valuemax');
  expect(maximumWidth).not.toBeNull();
  await expect(messageSeparator).toHaveAttribute('aria-valuenow', maximumWidth!);
  const list = page.locator('.commit-list');
  await expect.poll(() => list.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeGreaterThan(100);
  const overlaps = () => page.evaluate(() => {
    const overlap = (elements: Element[]) => {
      const boxes = elements.map((element) => element.getBoundingClientRect());
      let worst = 0;
      for (let a = 0; a < boxes.length; a++) {
        for (let b = a + 1; b < boxes.length; b++) {
          worst = Math.max(worst, Math.min(boxes[a].right, boxes[b].right) - Math.max(boxes[a].left, boxes[b].left));
        }
      }
      return worst;
    };
    const row = document.querySelector('.commit-row:not(.wip-row)')!;
    return {
      headings: overlap([...document.querySelectorAll('.graph-columns > .draggable-column')]),
      cells: overlap([...row.children].filter((cell) => !cell.classList.contains('row-menu'))),
    };
  });
  const maximum = await list.evaluate((element) => element.scrollWidth - element.clientWidth);
  for (const scrollLeft of [0, Math.round(maximum / 2), maximum]) {
    await list.evaluate((element, left) => { element.scrollLeft = left; element.dispatchEvent(new Event('scroll')); }, scrollLeft);
    await expect.poll(() => list.evaluate((element) => Math.round(element.scrollLeft))).toBe(scrollLeft);
    const { headings, cells } = await overlaps();
    expect(headings, `headings at ${scrollLeft}`).toBeLessThanOrEqual(1);
    expect(cells, `cells at ${scrollLeft}`).toBeLessThanOrEqual(1);
  }
  // Scrolled to the end, the last column and row actions end before the 24px
  // marker rail. The settings button stays inside the trailing heading.
  const geometry = () => page.evaluate(() => {
    const heading = document.querySelector<HTMLElement>('.graph-columns > .trailing-column')!.getBoundingClientRect();
    const row = document.querySelector('.commit-row:not(.wip-row)')!;
    const cell = row.querySelector('.trailing-cell')!.getBoundingClientRect();
    const menu = row.querySelector('.row-menu')!.getBoundingClientRect();
    const commitList = document.querySelector('.commit-list')!;
    const listRight = commitList.getBoundingClientRect().left + commitList.clientWidth;
    const button = document.querySelector('.graph-settings-toggle')!.getBoundingClientRect();
    const scrollAtEnd = Math.abs(commitList.scrollWidth - commitList.clientWidth - commitList.scrollLeft) <= 1;
    return { headingRight: heading.right, cellRight: cell.right, menuRight: menu.right, listRight, buttonLeft: button.left, scrollAtEnd };
  });
  await expect.poll(async () => {
    const { headingRight, cellRight, menuRight, listRight, buttonLeft, scrollAtEnd } = await geometry();
    return {
      aligned: Math.abs(headingRight - cellRight) <= 1,
      cellEndInset: Math.round(listRight - cellRight),
      settingsInside: buttonLeft >= headingRight - 32 && buttonLeft < headingRight,
      menuEndInset: Math.round(listRight - menuRight),
      scrollAtEnd,
    };
  }).toEqual({ aligned: true, cellEndInset: 24, settingsInside: true, menuEndInset: 24, scrollAtEnd: true });
  await expect(page.locator('.graph-columns > .trailing-column')).toHaveAttribute('title', /Date/);
});

test('preserves a newer history scroll when an old header scroll event arrives with a focused heading', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 700 });
  await page.goto('/');
  const messageSeparator = page.getByRole('separator', { name: 'Resize Commit Message column', exact: true });
  await messageSeparator.focus();
  await page.keyboard.press('End');
  await expect(messageSeparator).toHaveAttribute('aria-valuenow', '2400');

  const list = page.locator('.commit-list');
  const header = page.locator('.graph-columns');
  await expect.poll(() => list.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeGreaterThan(100);
  await expect.poll(() => page.evaluate(() =>
    document.querySelector('.graph-columns')!.scrollLeft - document.querySelector('.commit-list')!.scrollLeft,
  )).toBe(0);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

  const { target, actual } = await page.evaluate(() => {
    const history = document.querySelector<HTMLElement>('.commit-list')!;
    const headings = document.querySelector<HTMLElement>('.graph-columns')!;
    const maximum = Math.min(history.scrollWidth - history.clientWidth, headings.scrollWidth - headings.clientWidth);
    const target = headings.scrollLeft < maximum / 2 ? Math.round(maximum * .75) : Math.round(maximum * .25);
    history.scrollLeft = target;
    headings.dispatchEvent(new Event('scroll'));
    return { target, actual: history.scrollLeft };
  });
  expect(actual).toBe(target);
  await expect.poll(() => header.evaluate((element) => element.scrollLeft)).toBe(target);
  await expect.poll(() => list.evaluate((element) => element.scrollLeft)).toBe(target);

  await list.evaluate((element) => { element.scrollLeft = 0; element.dispatchEvent(new Event('scroll')); });
  await expect.poll(() => header.evaluate((element) => element.scrollLeft)).toBe(0);
  const dateSeparator = page.getByRole('separator', { name: 'Resize Date and Time column', exact: true });
  await dateSeparator.focus();
  await expect(dateSeparator).toBeFocused();
  await expect.poll(() => page.evaluate(() => {
    const headings = document.querySelector<HTMLElement>('.graph-columns')!;
    const history = document.querySelector<HTMLElement>('.commit-list')!;
    return headings.scrollLeft > 0 && headings.scrollLeft === history.scrollLeft;
  })).toBe(true);
});
