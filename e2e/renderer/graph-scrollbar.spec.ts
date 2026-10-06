import { expect, test } from '@playwright/test';

// Headless Chromium hides scrollbars by default; this file needs real classic scrollbars.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

test('keeps the last graph column aligned with the settings button at its right end with a vertical scrollbar, highlighting full rows', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 700 });
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.addStyleTag({ content: '.commit-list { overflow-y: scroll !important; }' });
  const list = page.locator('.commit-list');
  await expect.poll(() => list.evaluate((element) => element.offsetWidth - element.clientWidth)).toBeGreaterThan(0);
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
  for (let step = 0; step < 4; step++) {
    await page.getByRole('separator', { name: 'Resize Commit Message column', exact: true }).focus();
    await page.keyboard.press('End');
  }
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
    const { headings, cells } = await overlaps();
    expect(headings, `headings at ${scrollLeft}`).toBeLessThanOrEqual(1);
    expect(cells, `cells at ${scrollLeft}`).toBeLessThanOrEqual(1);
  }
  // Scrolled to the end, the last column reaches the right edge with the settings button and row
  // actions inside its right end.
  const geometry = () => page.evaluate(() => {
    const heading = document.querySelector<HTMLElement>('.graph-columns > .trailing-column')!.getBoundingClientRect();
    const row = document.querySelector('.commit-row:not(.wip-row)')!;
    const cell = row.querySelector('.trailing-cell')!.getBoundingClientRect();
    const menu = row.querySelector('.row-menu')!.getBoundingClientRect();
    const commitList = document.querySelector('.commit-list')!;
    const listRight = commitList.getBoundingClientRect().left + commitList.clientWidth;
    const button = document.querySelector('.graph-settings-toggle')!.getBoundingClientRect();
    return { headingRight: heading.right, cellRight: cell.right, menuRight: menu.right, listRight, buttonLeft: button.left };
  });
  await expect.poll(async () => {
    const { headingRight, cellRight, menuRight, listRight, buttonLeft } = await geometry();
    return Math.abs(headingRight - cellRight) <= 1 && Math.abs(listRight - 16 - cellRight) <= 1 && buttonLeft >= headingRight - 32 && buttonLeft < headingRight && menuRight >= listRight - 17 && menuRight <= listRight - 13;
  }).toBe(true);
  await expect(page.locator('.graph-columns > .trailing-column')).toHaveAttribute('title', /Date/);
});
