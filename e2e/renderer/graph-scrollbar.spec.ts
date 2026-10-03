import { expect, test } from '@playwright/test';

// Headless Chromium hides scrollbars by default; this file needs real classic scrollbars.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

test('keeps the last graph column aligned and clear of the settings button with a vertical scrollbar, highlighting full rows', async ({ page }) => {
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
      return rowCovers && Math.abs(headerRight - rowRight) <= 1 && headerRight <= buttonLeft - 2;
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

test('pins the last graph column and row actions to the right edge while columns overflow', async ({ page }) => {
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
  await list.evaluate((element) => { element.scrollLeft = 0; });
  const geometry = () => page.evaluate(() => {
    const heading = document.querySelector<HTMLElement>('.graph-columns > .trailing-column')!.getBoundingClientRect();
    const row = document.querySelector('.commit-row:not(.wip-row)')!;
    const cell = row.querySelector('.trailing-cell')!.getBoundingClientRect();
    const menu = row.querySelector('.row-menu')!.getBoundingClientRect();
    const commitList = document.querySelector('.commit-list')!;
    const listRight = commitList.getBoundingClientRect().left + commitList.clientWidth;
    const button = document.querySelector('.graph-settings-toggle')!.getBoundingClientRect();
    const probe = document.elementFromPoint(cell.left + cell.width / 2, cell.top + cell.height / 2);
    return { headingRight: heading.right, cellRight: cell.right, menuRight: menu.right, listRight, buttonLeft: button.left, cellOnTop: !!probe && row.querySelector('.trailing-cell')!.contains(probe) };
  });
  await expect.poll(async () => {
    const { headingRight, cellRight, menuRight, listRight, buttonLeft, cellOnTop } = await geometry();
    return cellOnTop && Math.abs(headingRight - cellRight) <= 1 && headingRight <= buttonLeft - 2 && headingRight >= buttonLeft - 8 && menuRight >= listRight - 7 && menuRight <= listRight - 3;
  }).toBe(true);
  await expect(page.locator('.graph-columns > .trailing-column')).toHaveAttribute('title', /Date/);
});
