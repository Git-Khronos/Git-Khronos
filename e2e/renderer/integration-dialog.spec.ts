import { expect, test, type Page } from '@playwright/test';

type Comparison = { incomingCount: number; outgoingCount: number; outgoingPublished: number; mergeBase?: string | null };

async function installBackend(page: Page, comparison: Comparison | 'error'): Promise<void> {
  await page.evaluate((comparison) => {
    const host = window as any;
    const app = host.ng.getComponent(document.querySelector('gc-root'));
    let snapshot = structuredClone(app.git.repository());
    host.__integrationCalls = [];
    host.__TAURI_INTERNALS__ = {
      invoke: async (command: string, args: any) => {
        if (command === 'refresh_repository_status') return snapshot.status;
        if (command === 'refresh_repository') return snapshot;
        host.__integrationCalls.push({ command, args });
        if (command === 'compare_branches') {
          if (comparison === 'error') throw new Error('Comparison unavailable.');
          const make = (count: number, label: string) => Array.from({ length: count }, (_, index) => ({
            oid: `${index + 1}`.padStart(40, label === 'in' ? 'a' : 'b'), subject: `${label} change ${index + 1}`, author: 'Ada', timestamp: 1_700_000_000,
          }));
          return {
            target: args.target, source: args.source, targetOid: 'c'.repeat(40), sourceOid: 'd'.repeat(40),
            mergeBase: comparison.mergeBase === undefined ? 'e'.repeat(40) : comparison.mergeBase,
            incomingCount: comparison.incomingCount, outgoingCount: comparison.outgoingCount, outgoingPublished: comparison.outgoingPublished,
            incoming: make(comparison.incomingCount, 'in'), outgoing: make(comparison.outgoingCount, 'out'),
          };
        }
        if (command === 'preview_merge') {
          return { clean: false, conflictedPaths: ['src/app.ts'], files: [], messages: [] };
        }
        if (command === 'checkout_branch') {
          if (host.__failCheckout) throw new Error('Checkout would overwrite local changes.');
          snapshot = {
            ...snapshot,
            branches: snapshot.branches.map((branch: any) => ({ ...branch, current: !branch.remote && branch.name === args.name })),
            status: { ...snapshot.status, branch: args.name },
          };
          return snapshot;
        }
        if (command === 'integrate_branch') return snapshot;
        throw new Error(`Unexpected command ${command}`);
      },
    };
  }, comparison);
}

const calls = (page: Page, command?: string) => page.evaluate((command) => (window as any).__integrationCalls
  .filter((call: any) => !command || call.command === command), command);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible({ timeout: 15000 });
});

async function openFromBranchMenu(page: Page, branch: string) {
  await page.getByRole('button', { name: `Local branch ${branch}`, exact: true }).click({ button: 'right' });
  await page.locator('.context-menu').getByRole('menuitem', { name: 'Merge or rebase into main…' }).click();
  return page.getByRole('dialog', { name: 'Bring changes into main' });
}

test('recommends fast-forward when the current branch is only behind', async ({ page }) => {
  await installBackend(page, { incomingCount: 2, outgoingCount: 0, outgoingPublished: 0 });
  const dialog = await openFromBranchMenu(page, 'release');
  await expect(dialog.locator('#integrate-summary')).toHaveText('main is 2 commits behind release and has nothing of its own, so it can simply move forward.');
  await expect(dialog.getByRole('list', { name: 'Commits coming in' }).getByRole('listitem')).toHaveCount(2);
  const fastForward = dialog.getByRole('radio', { name: /Fast-forward main/ });
  await expect(fastForward).toBeChecked();
  await expect(dialog.locator('label.option.selected')).toContainText('Recommended');
  await expect(dialog.getByRole('radio', { name: /Rebase main onto release/ })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Fast-forward main', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => calls(page, 'integrate_branch')).toEqual([
    { command: 'integrate_branch', args: expect.objectContaining({ name: 'release', strategy: 'ff-only' }) },
  ]);
  expect(await calls(page, 'checkout_branch')).toEqual([]);
});

test('recommends merge for diverged branches and warns before rebasing pushed commits', async ({ page }) => {
  await installBackend(page, { incomingCount: 3, outgoingCount: 2, outgoingPublished: 1 });
  const dialog = await openFromBranchMenu(page, 'release');
  await expect(dialog.locator('#integrate-summary')).toContainText('Both branches changed: release has 3 commits that main lacks, and main has 2 commits of its own.');
  await expect(dialog.getByRole('radio', { name: /Merge release into main/ })).toBeChecked();
  await expect(dialog.getByRole('radio', { name: /Fast-forward main/ })).toBeDisabled();
  await expect(dialog).toContainText('Not possible: main has 2 commits that release does not have.');
  await expect(dialog).not.toContainText('already pushed');

  await dialog.getByRole('button', { name: 'Check for conflicts' }).click();
  await expect(dialog.getByRole('list', { name: 'Files expected to conflict' })).toContainText('src/app.ts');
  expect(await calls(page, 'preview_merge')).toHaveLength(1);

  await dialog.getByRole('radio', { name: /Rebase main onto release/ }).check();
  await expect(dialog.getByRole('note')).toContainText('1 of the commits being replayed is already pushed');
  await expect(dialog.getByRole('button', { name: 'Pick, reorder or squash commits first…' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Rebase main onto release', exact: true }).click();
  await expect.poll(() => calls(page, 'integrate_branch')).toEqual([
    { command: 'integrate_branch', args: expect.objectContaining({ name: 'release', strategy: 'rebase' }) },
  ]);
});

test('says when there is nothing to bring in and offers only Close', async ({ page }) => {
  await installBackend(page, { incomingCount: 0, outgoingCount: 1, outgoingPublished: 0 });
  const dialog = await openFromBranchMenu(page, 'release');
  await expect(dialog.locator('#integrate-summary')).toContainText('main already has every commit from release. Nothing to bring in.');
  await expect(dialog.getByRole('radio')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await calls(page, 'integrate_branch')).toEqual([]);
});

test('swapping direction switches to the other branch before integrating', async ({ page }) => {
  await installBackend(page, { incomingCount: 1, outgoingCount: 0, outgoingPublished: 0 });
  const dialog = await openFromBranchMenu(page, 'release');
  await dialog.getByRole('button', { name: 'Swap direction' }).click();
  const swapped = page.getByRole('dialog', { name: 'Bring changes into release' });
  await expect(swapped.locator('#integrate-source')).toHaveValue('main');
  await expect(swapped).toContainText('Git Khronos switches to release first.');
  await swapped.getByRole('button', { name: 'Fast-forward release', exact: true }).click();
  await expect.poll(() => calls(page)).toEqual(expect.arrayContaining([
    { command: 'checkout_branch', args: expect.objectContaining({ name: 'release' }) },
    { command: 'integrate_branch', args: expect.objectContaining({ name: 'main', strategy: 'ff-only' }) },
  ]));
  const order = (await calls(page)).map((call: any) => call.command).filter((command: string) => command !== 'compare_branches');
  expect(order).toEqual(['checkout_branch', 'integrate_branch']);
});

test('does not integrate when switching to the receiving branch fails', async ({ page }) => {
  await installBackend(page, { incomingCount: 1, outgoingCount: 0, outgoingPublished: 0 });
  await page.evaluate(() => { (window as any).__failCheckout = true; });
  const dialog = await openFromBranchMenu(page, 'release');
  await dialog.getByRole('button', { name: 'Swap direction' }).click();
  await page.getByRole('dialog', { name: 'Bring changes into release' }).getByRole('button', { name: 'Fast-forward release', exact: true }).click();
  await expect.poll(() => calls(page, 'checkout_branch')).toHaveLength(1);
  await page.waitForTimeout(100);
  expect(await calls(page, 'integrate_branch')).toEqual([]);
});

test('still allows a safe choice when the comparison is unavailable', async ({ page }) => {
  await installBackend(page, 'error');
  const dialog = await openFromBranchMenu(page, 'release');
  await expect(dialog).toContainText('Could not compare the branches');
  await expect(dialog.getByRole('radio', { name: /Merge release into main/ })).toBeChecked();
  await expect(dialog.getByRole('button', { name: 'Merge release into main', exact: true })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('opens from the toolbar, the command palette and the branch drop menu', async ({ page }) => {
  await installBackend(page, { incomingCount: 1, outgoingCount: 1, outgoingPublished: 0 });
  await page.getByRole('button', { name: 'Branch options' }).click();
  await page.getByRole('menu', { name: 'Branch options' }).getByRole('menuitem', { name: /Merge or rebase into main/ }).click();
  let dialog = page.getByRole('dialog', { name: 'Bring changes into main' });
  await expect(dialog.locator('#integrate-source')).toBeFocused();
  await dialog.locator('#integrate-source').selectOption('release');
  await expect(dialog.getByRole('radio', { name: /Merge release into main/ })).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  await page.getByRole('button', { name: 'Command palette', exact: true }).click();
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByLabel('Search commands').fill('merge or rebase');
  await palette.getByRole('option', { name: /Merge or rebase into main/ }).click();
  dialog = page.getByRole('dialog', { name: 'Bring changes into main' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: 'Local branch release', exact: true }).dragTo(page.getByRole('button', { name: /Local branch main, current/ }));
  const menu = page.getByRole('menu', { name: 'Branch drop actions' });
  await expect(menu.getByRole('status')).toHaveText('Both changed: 1 commit to bring in, 1 commit only on main.');
  await expect(menu.getByRole('menuitem', { name: /Merge release into main/ })).toContainText('Recommended');
  await expect(menu.getByRole('menuitem', { name: /Fast-forward main/ })).toContainText('Not possible: main has its own commits');
  await menu.getByRole('button', { name: 'Compare and choose…' }).click();
  dialog = page.getByRole('dialog', { name: 'Bring changes into main' });
  await expect(dialog.locator('#integrate-source')).toHaveValue('release');
});
