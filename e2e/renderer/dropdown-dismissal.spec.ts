import { expect, test, type Locator, type Page } from '@playwright/test';

const OUTSIDE_COMMIT = 'f19b263a8af31408d5f665caf7a5508e108c0fd1';

const dropdowns: Array<{
  name: string;
  url?: string;
  prepare?: (page: Page) => Promise<void>;
  toggle: (page: Page) => Locator;
  popup: (page: Page) => Locator;
}> = [
  { name: 'main menu', toggle: (page) => page.getByRole('button', { name: 'Main menu', exact: true }), popup: (page) => page.getByRole('menu', { name: 'Git Khronos menu' }) },
  { name: 'remote picker', toggle: (page) => page.getByRole('button', { name: /^Select remote, current/ }), popup: (page) => page.getByRole('menu', { name: 'Select remote for pull and push' }) },
  { name: 'branch picker', toggle: (page) => page.getByRole('button', { name: /^Switch branch, current/ }), popup: (page) => page.getByRole('dialog', { name: 'Switch branch', exact: true }) },
  { name: 'fetch options', toggle: (page) => page.getByRole('button', { name: 'Fetch options', exact: true }), popup: (page) => page.getByRole('menu', { name: 'Fetch options' }) },
  { name: 'pull options', toggle: (page) => page.getByRole('button', { name: 'Pull options', exact: true }), popup: (page) => page.getByRole('menu', { name: 'Pull options' }) },
  { name: 'branch options', toggle: (page) => page.getByRole('button', { name: 'Branch options', exact: true }), popup: (page) => page.getByRole('menu', { name: 'Branch options' }) },
  { name: 'stash options', toggle: (page) => page.getByRole('button', { name: 'Stash options', exact: true }), popup: (page) => page.getByRole('menu', { name: 'Stash options' }) },
  { name: 'identity popover', toggle: (page) => page.locator('.identity-chip'), popup: (page) => page.locator('.identity-popover') },
  {
    name: 'author filter',
    prepare: async (page) => {
      const settings = page.getByRole('button', { name: 'Configure graph columns', exact: true });
      await settings.click();
      const author = page.getByRole('dialog', { name: 'Graph settings' }).getByLabel('Author', { exact: true });
      if (!(await author.isChecked())) await author.check();
      await settings.click();
    },
    toggle: (page) => page.getByRole('button', { name: 'Filter commits by author', exact: true }), popup: (page) => page.getByRole('dialog', { name: 'Author filter' }) },
  { name: 'working directory options', toggle: (page) => page.getByRole('button', { name: 'Working directory options', exact: true }), popup: (page) => page.getByRole('menu', { name: 'Working directory options' }) },
  { name: 'co-author picker', toggle: (page) => page.locator('.add-coauthor'), popup: (page) => page.locator('.coauthor-picker') },
  {
    name: 'diff file menu',
    url: '/?compare-commits&diff-viewer=split',
    toggle: (page) => page.locator('.diff-file-position'),
    popup: (page) => page.getByRole('menu', { name: 'Changed files' }),
  },
];

async function open(page: Page, dropdown: (typeof dropdowns)[number]): Promise<Locator> {
  await dropdown.toggle(page).click();
  const popup = dropdown.popup(page);
  await expect(popup).toBeVisible();
  return popup;
}

// Popups may cover part of a row, so press where the row itself receives the event.
async function unobstructedPoint(row: Locator): Promise<[number, number]> {
  const point = await row.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const y = box.top + box.height / 2;
    for (let x = box.left + 4; x < box.right; x += 16) {
      if (element.contains(document.elementFromPoint(x, y))) return [x, y] as [number, number];
    }
    return null;
  });
  expect(point).not.toBeNull();
  return point!;
}

for (const dropdown of dropdowns) {
  test(`${dropdown.name} closes on outside presses but not on inside presses`, async ({ page }) => {
    await page.goto(dropdown.url ?? '/');
    await dropdown.prepare?.(page);
    await expect(dropdown.toggle(page)).toBeVisible();

    let popup = await open(page, dropdown);
    await (dropdown.name === 'co-author picker' ? popup.getByText('Name', { exact: true }) : popup).click({ position: { x: 2, y: 2 } });
    await expect(popup).toBeVisible();

    await dropdown.toggle(page).click();
    await expect(popup).toHaveCount(0);

    // A bare press closes the dropdown even when the surface underneath stops click propagation.
    popup = await open(page, dropdown);
    const statusbar = (await page.locator('.statusbar').boundingBox())!;
    await page.mouse.move(statusbar.x + 5, statusbar.y + statusbar.height / 2);
    await page.mouse.down();
    try {
      await expect(popup).toHaveCount(0);
    } finally {
      await page.mouse.up();
    }

    popup = await open(page, dropdown);
    await page.mouse.click(statusbar.x + 5, statusbar.y + statusbar.height / 2, { button: 'right' });
    await expect(popup).toHaveCount(0);
    await page.keyboard.press('Escape');
  });
}

test('an outside click closes a dropdown and still acts on its target', async ({ page }) => {
  await page.goto('/');
  const rows = [page.locator(`[data-commit-oid="${OUTSIDE_COMMIT}"]`), page.locator('[data-commit-oid]').last()];
  await expect(rows[1]).toBeVisible();
  for (const [index, dropdown] of dropdowns.filter(({ url }) => !url).entries()) {
    const row = rows[index % 2];
    await dropdown.prepare?.(page);
    if (!(await dropdown.toggle(page).isVisible())) await page.getByText('Working Directory', { exact: true }).click();
    await expect(row).not.toHaveClass(/selected/);
    const popup = await open(page, dropdown);
    await page.mouse.click(...await unobstructedPoint(row));
    await expect(popup).toHaveCount(0);
    await expect(row).toHaveClass(/selected/);
  }
});
