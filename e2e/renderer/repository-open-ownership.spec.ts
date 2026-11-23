import { expect, test, type Page } from '@playwright/test';

const ROOT = '/home/maya/projects/git-khronos';
const OTHER_TAB = '/home/maya/projects/git-khronos-partial-staging';
const FIRST = '/owned/first';
const SECOND = '/owned/second';
const manager = (page: Page) => page.getByRole('dialog', { name: 'Repository management' });
const selectedPath = (page: Page) => page.locator('.status-repository-path');
const row = (page: Page, path: string) => manager(page).getByRole('button', { name: `Open ${path.split('/').at(-1)} at ${path}`, exact: true });

async function showManager(page: Page) {
  await page.getByRole('button', { name: 'New repository tab', exact: true }).click();
  await expect(manager(page).getByRole('tab', { name: 'Browse', exact: true })).toHaveAttribute('aria-selected', 'true');
}

async function closeManager(page: Page) {
  await manager(page).getByRole('button', { name: 'Close repository management' }).click();
  await expect(manager(page)).toHaveCount(0);
}

async function requested(page: Page, key: string) {
  await expect.poll(() => page.evaluate(key => (window as any).__managedOpen.pending[key] !== undefined, key)).toBe(true);
}

async function reply(page: Page, key: string, value: string | boolean = true) {
  await page.evaluate(({ key, value }) => (window as any).__managedOpen.pending[key](value), { key, value });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(paths => {
    localStorage.setItem('git-khronos.recent-repositories.v1', JSON.stringify(paths));
  }, [FIRST, SECOND]);
  await page.goto('/?worktree-tabs');
  await expect(selectedPath(page)).toHaveText(ROOT);
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gk-app'));
    const git = app.git;
    const fixture = (window as any).__managedOpen = { pending: {} as Record<string, (value: string | boolean) => void>, opened: [] as string[] };
    app.setAutoFetchInterval(0);
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      if (command === 'plugin:dialog|open') return new Promise(resolve => fixture.pending.picker = resolve);
      if (command !== 'open_repository') return Promise.reject(new Error(`Unexpected ${command}`));
      const path = args.path as string;
      fixture.opened.push(path);
      const snapshot = { ...git.repository(), id: `owned:${path}`, name: path.split('/').at(-1), path };
      return new Promise((resolve, reject) => fixture.pending[path] = value => value
        ? resolve(snapshot) : reject({ message: 'Owned open refusal' }));
    } };
  });
  await showManager(page);
});

test('closing a recent repository read keeps the current tab and replacement manager', async ({ page }) => {
  await row(page, FIRST).click();
  await requested(page, FIRST);
  await closeManager(page);
  const otherTab = page.locator('.repo-tab-main').nth(1);
  await otherTab.click();
  await expect(otherTab).toHaveAttribute('aria-selected', 'true');
  await expect(selectedPath(page)).toHaveText(OTHER_TAB);
  await showManager(page);
  await reply(page, FIRST);
  await expect(page.locator('.app-shell')).not.toHaveClass(/is-busy/);
  await expect(selectedPath(page)).toHaveText(OTHER_TAB);
  await expect(manager(page)).toBeVisible();
  await expect(page.locator('.repo-tab-main')).toHaveCount(2);
});

test('a folder chooser from a retired Browse visit cannot open a repository', async ({ page }) => {
  await manager(page).getByRole('button', { name: /Open a repository Browse to/ }).click();
  await requested(page, 'picker');
  await manager(page).getByRole('tab', { name: 'Clone', exact: true }).click();
  await manager(page).getByRole('tab', { name: 'Browse', exact: true }).click();
  await reply(page, 'picker', FIRST);
  // Select a different row afterwards; exactly its read (not the old picker) should run.
  await row(page, SECOND).click();
  await requested(page, SECOND);
  await reply(page, SECOND);
  await expect(selectedPath(page)).toHaveText(SECOND);
  await expect(manager(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__managedOpen.opened)).toEqual([SECOND]);
});

test('a newer Browse selection owns completion even when the first read replies first', async ({ page }) => {
  await row(page, FIRST).click();
  await requested(page, FIRST);
  await row(page, SECOND).click();
  await requested(page, SECOND);
  await reply(page, FIRST);
  await reply(page, SECOND);
  await expect(page.locator('.app-shell')).not.toHaveClass(/is-busy/);
  await expect(selectedPath(page)).toHaveText(SECOND);
  await expect(manager(page)).toHaveCount(0);
  await expect(page.locator('.repo-tab-main')).toHaveCount(3);
});

test('an open refusal from an earlier manager is not shown in its replacement', async ({ page }) => {
  await row(page, FIRST).click();
  await requested(page, FIRST);
  await closeManager(page);
  await showManager(page);
  await reply(page, FIRST, false);
  await expect(page.locator('.app-shell')).not.toHaveClass(/is-busy/);
  await expect(manager(page)).toBeVisible();
  await expect(page.getByText('Owned open refusal', { exact: false })).toHaveCount(0);
  await expect(selectedPath(page)).toHaveText(ROOT);
});

test('Open Repository shortcut cannot override a checkout selected during its native read', async ({ page }) => {
  await closeManager(page);
  await page.keyboard.press('Control+Shift+O');
  await requested(page, 'picker');
  await reply(page, 'picker', FIRST);
  await requested(page, FIRST);
  await page.locator('.repo-tab-main').nth(1).click();
  const selection = await selectedPath(page).innerText();
  await reply(page, FIRST);
  await expect(page.locator('.app-shell')).not.toHaveClass(/is-busy/);
  await expect(selectedPath(page)).toHaveText(selection);
  await expect(page.locator('.repo-tab-main')).toHaveCount(2);
});

test('a refusal from the current Browse request stays visible', async ({ page }) => {
  await row(page, FIRST).click();
  await requested(page, FIRST);
  await reply(page, FIRST, false);
  await expect(page.getByRole('alert').filter({ hasText: 'Owned open refusal' })).toBeVisible();
  await expect(manager(page)).toBeVisible();
  await expect(selectedPath(page)).toHaveText(ROOT);
});
