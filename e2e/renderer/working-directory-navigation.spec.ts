import { expect, test, type Page } from '@playwright/test';

const entryPoints: { name: string; open: (page: Page) => Promise<void> }[] = [
  {
    name: 'status bar',
    open: async page => {
      await page.getByRole('button', { name: /^Open working directory changes/ }).click();
    },
  },
  {
    name: 'sidebar working directory',
    open: async page => {
      await page.locator('.wip-nav').click();
    },
  },
  {
    name: 'current worktree in the sidebar',
    open: async page => {
      await page.locator('.worktree-list-item.current .worktree-list-main').click();
    },
  },
  {
    name: 'current worktree graph row',
    open: async page => {
      await page.locator('.wip-row').first().locator('.wip-worktree-label').click();
    },
  },
  {
    name: 'current worktree graph row keyboard action',
    open: async page => {
      const row = page.locator('.wip-row').first();
      await row.focus();
      await row.press('Enter');
    },
  },
  {
    name: 'graph column handle click',
    open: async page => {
      await page.locator('.wip-row').first().locator('.graph-row-resizer').click();
    },
  },
  {
    name: 'command palette',
    open: async page => {
      await page.getByRole('button', { name: 'Command palette', exact: true }).click();
      const palette = page.getByRole('dialog', { name: 'Command palette' });
      await palette.getByRole('combobox', { name: 'Search commands' }).fill('view working directory changes');
      await palette.getByRole('option', { name: /View Working Directory Changes/ }).click();
    },
  },
];

for (const { name, open } of entryPoints) {
  test(`reopens a closed working directory inspector from the ${name}`, async ({ page }) => {
    await page.goto('/');
    const inspector = page.locator('.commit-panel');
    const summary = inspector.getByRole('textbox', { name: 'Commit summary', exact: true });
    await summary.fill('Keep this draft');
    await inspector.getByRole('button', { name: 'Close commit panel', exact: true }).click();
    await expect(inspector).toBeHidden();

    await open(page);

    await expect(inspector).toBeVisible();
    await expect(summary).toHaveValue('Keep this draft');
  });
}

test('reopens and focuses the full-width working directory inspector from the graph', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 720 });
  await page.goto('/');
  const inspector = page.locator('.commit-panel');
  const summary = inspector.getByRole('textbox', { name: 'Commit summary', exact: true });
  await summary.fill('Keep the compact draft');
  await inspector.getByRole('button', { name: 'Close commit panel', exact: true }).click();
  await expect(inspector).toBeHidden();

  const row = page.locator('.wip-row').first();
  await row.focus();
  await row.press('Enter');

  await expect(inspector).toBeVisible();
  await expect(summary).toHaveValue('Keep the compact draft');
  await expect(inspector.getByRole('button', { name: 'Close commit panel', exact: true })).toBeFocused();
});

test('selects the linked worktree when its graph column handle is clicked', async ({ page }) => {
  await page.goto('/');
  const inspector = page.locator('.commit-panel');
  await inspector.getByRole('button', { name: 'Close commit panel', exact: true }).click();
  await expect(inspector).toBeHidden();

  const linked = page.locator('.wip-row.linked-worktree');
  await linked.locator('.graph-row-resizer').click();

  await expect(linked).toHaveAttribute('aria-pressed', 'true');
  await expect(inspector).toBeVisible();
  await expect(inspector).toHaveAttribute('aria-label', 'Worktree inspector');
  await expect(inspector.getByRole('button', { name: 'Open Worktree', exact: true })).toBeVisible();
});
