import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Command palette', exact: true })).toBeVisible();
});

for (const outcome of ['cancel', 'failure'] as const) {
  test(`the lazy command catalogue is keyboard-contained on ${outcome}`, async ({ page }) => {
    const commands = /Fetch and prune remote references/;
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let requests = 0;
    let settled = 0;
    await page.route('**/chunk-*.js', async route => {
      const response = await route.fetch();
      const body = await response.text();
      if (!commands.test(body)) return route.fulfill({ response, body });
      requests++;
      await held;
      if (outcome === 'failure') await route.abort();
      else await route.fulfill({ response, body });
      settled++;
    });
    try {
      await page.reload();
      await expect(page.locator('.commit-row').first()).toBeVisible();
      expect(requests).toBe(0);
      await page.evaluate(() => {
        const app = (window as any).ng.getComponent(document.querySelector('gk-app'));
        const calls: string[] = (window as any).__paletteCalls = [];
        app.git.stageAll = async () => { calls.push('stage'); return null; };
        app.git.commit = async () => { calls.push('commit'); return false; };
      });
      const opener = page.getByRole('button', { name: 'Command palette', exact: true });
      await opener.click();
      const loading = page.getByRole('dialog', { name: 'Loading commands', exact: true });
      const cancel = loading.getByRole('button', { name: 'Cancel', exact: true });
      await expect(cancel).toBeFocused();
      await expect.poll(() => requests).toBe(1);
      await page.keyboard.press('Shift+Tab');
      await expect(cancel).toBeFocused();
      await page.keyboard.press('Control+Shift+Enter');
      await expect(loading).toBeVisible();
      if (outcome === 'cancel') await page.keyboard.press('Escape');
      release();
      await expect.poll(() => settled).toBe(1);
      if (outcome === 'failure') {
        const failure = page.getByRole('dialog', { name: 'Commands unavailable', exact: true });
        await expect(failure.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
        await page.keyboard.press('Escape');
      }
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(opener).toBeFocused();
      expect(await page.evaluate(() => (window as any).__paletteCalls)).toEqual([]);
    } finally {
      release();
    }
  });
}

test('keeps the global command launcher discoverable without crowding compact chrome', async ({ page }) => {
  const launcher = page.getByRole('button', { name: 'Command palette', exact: true });
  await expect(launcher).toContainText('Commands');
  await expect(launcher.locator('kbd')).toHaveText(/P$/);
  await expect(launcher).toHaveAttribute('aria-expanded', 'false');

  await launcher.click();
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  await expect(launcher).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 1100, height: 760 });
  await expect(launcher.locator('span')).toBeHidden();
  await expect(launcher.locator('kbd')).toBeHidden();
  await expect(launcher).toHaveAccessibleName('Command palette');
});

test('opens, filters, and recovers from an empty command search', async ({ page }) => {
  const opener = page.getByRole('button', { name: /Switch branch, current main/ });
  await opener.focus();
  await page.keyboard.press('Control+p');

  const palette = page.getByRole('dialog', { name: 'Command palette' });
  const search = palette.getByRole('combobox', { name: 'Search commands' });
  await expect(palette).toBeVisible();
  await expect(search).toBeFocused();
  await expect(search).toHaveAttribute('aria-activedescendant', 'command-palette-option-0');
  await expect(palette.getByRole('option', { selected: true })).toBeEnabled();
  await expect(palette.getByRole('option').first()).toHaveAttribute('tabindex', '-1');

  const close = palette.getByRole('button', { name: 'Close command palette' });
  await expect(close).toHaveCSS('border-top-style', 'solid');
  expect(await close.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  expect(await close.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return Math.min(box.width, box.height);
  })).toBeGreaterThanOrEqual(30);
  await search.press('Tab');
  await expect(close).toBeFocused();
  await close.press('Tab');
  await expect(search).toBeFocused();
  await search.press('Shift+Tab');
  await expect(close).toBeFocused();
  await close.press('Shift+Tab');
  await expect(search).toBeFocused();

  await search.fill('no-such-command-value');
  await expect(palette.getByRole('listbox')).toHaveCount(0);
  await expect(palette.getByRole('region', { name: 'Command search status' })).toBeVisible();
  await expect(palette.getByText('No matching commands, repositories, references, or files')).toBeVisible();
  await expect(palette.getByText('Try another phrase or browse the full list.')).toBeVisible();

  await palette.getByRole('button', { name: 'Clear search' }).click();
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('');
  await expect(palette.getByRole('listbox', { name: 'Available commands' })).toBeVisible();
  await expect(palette.getByRole('option', { name: /Fetch All/ })).toBeVisible();

  await search.fill('terminal');
  const terminal = palette.getByRole('option', { name: /Open Terminal/ });
  await expect(terminal.locator('kbd')).toHaveText('Alt T / Ctrl `');

  await search.press('Escape');
  await expect(palette).toBeHidden();
  await expect(opener).toBeFocused();
});

test('does not execute a disabled command when Enter is pressed', async ({ page }) => {
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gk-app'));
    (window as any).__executedPaletteActions = [];
    app.runCommand = (action: { id: string }) => (window as any).__executedPaletteActions.push(action.id);
  });
  await page.keyboard.press('Control+p');

  const palette = page.getByRole('dialog', { name: 'Command palette' });
  const search = palette.getByRole('combobox', { name: 'Search commands' });
  await search.fill('Undo');
  const undo = palette.getByRole('option', { name: /^Undo/ });
  await expect(undo).toBeDisabled();
  await expect(search).not.toHaveAttribute('aria-activedescendant');

  await search.press('Enter');
  await expect(palette).toBeVisible();
  expect(await page.evaluate(() => (window as any).__executedPaletteActions)).toEqual([]);
});

test('keeps keyboard selection visible and executes a searched view command', async ({ page }) => {
  await page.keyboard.press('Control+p');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  const search = palette.getByRole('combobox', { name: 'Search commands' });

  await search.press('ArrowDown');
  await expect(search).toHaveAttribute('aria-activedescendant', 'command-palette-option-1');
  await expect(palette.locator('#command-palette-option-1')).toHaveAttribute('aria-selected', 'true');

  await search.fill('toggle left panel');
  const action = palette.getByRole('option', { name: /Toggle Left Panel/ });
  await expect(action).toHaveAttribute('aria-selected', 'true');
  await search.press('Enter');

  await expect(palette).toBeHidden();
  await expect(page.locator('.left-panel')).toBeHidden();
});

test('discloses compact command descriptions without expanding result rows', async ({ page }) => {
  await page.setViewportSize({ width: 550, height: 560 });
  await page.keyboard.press('Control+p');

  const palette = page.getByRole('dialog', { name: 'Command palette' });
  const action = palette.getByRole('option', { name: /Search All History/ });
  const detail = action.locator('.palette-action-copy em');

  expect(await detail.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await expect(action).toHaveAttribute(
    'title',
    'Search All History — Search whole-repository history with optional advanced filters',
  );
});

test('ranks command-name matches ahead of incidental description matches', async ({ page }) => {
  await page.keyboard.press('Control+p');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  const search = palette.getByRole('combobox', { name: 'Search commands' });

  await search.fill('open');
  const options = palette.getByRole('option');
  await expect(options.first()).toContainText('Open Repository');
  await expect(options.first()).toContainText('Repository · Open a local Git working tree');
  await expect(palette.locator('.palette-group-heading')).toHaveCount(0);
  await expect(options.filter({ hasText: 'New Tab' })).not.toHaveCount(0);
});

test('returns focus to the palette opener after closing activity logs', async ({ page }) => {
  const opener = page.getByRole('button', { name: /Switch branch, current main/ });
  await opener.focus();
  await page.keyboard.press('Control+p');

  const palette = page.getByRole('dialog', { name: 'Command palette' });
  const search = palette.getByRole('combobox', { name: 'Search commands' });
  await search.fill('activity logs');
  await expect(palette.getByRole('option', { name: /Activity Logs/ })).toHaveAttribute('aria-selected', 'true');
  await search.press('Enter');

  const drawer = page.getByRole('region', { name: 'Activity logs' });
  await expect(palette).toBeHidden();
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('tab', { selected: true })).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(opener).toBeFocused();
});

test('opens a grouped branch switcher from the compact repository toolbar', async ({ page }) => {
  await page.setViewportSize({ width: 550, height: 720 });
  const more = page.getByRole('button', { name: 'More repository actions' });
  await more.click();
  const menu = page.getByRole('menu', { name: 'More repository actions' });
  await menu.getByRole('menuitem', { name: /Switch branch/ }).click();

  const palette = page.getByRole('dialog', { name: 'Command palette' });
  const search = palette.getByRole('combobox', { name: 'Search branches' });
  await expect(palette.getByText('Branches', { exact: true })).toBeVisible();
  await expect(palette.getByRole('listbox', { name: 'Branch choices' })).toBeVisible();
  await expect(palette.locator('.palette-footer')).toContainText('Switch');
  await expect(palette.getByRole('option', { name: /^main/ })).toBeDisabled();
  await search.fill('partial');
  await expect(palette.getByRole('option', { name: /feature\/partial-staging/ })).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(more).toBeFocused();
});

test('a late tracked-file search cannot populate a later visit to the same checkout', async ({ page }) => {
  await page.evaluate(() => {
    const { git } = (window as any).ng.getComponent(document.querySelector('gk-app'));
    const original = git.repository();
    git.repositories.update((repos: any[]) => [...repos, { ...original, id: 'other-search-checkout', path: '/owned/other' }]);
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'tracked file search test' }));
    const fixture = { original, requests: [] as Array<(paths: string[]) => void>, published: [] as string[][] };
    (window as any).__fileQueryLease = fixture;
    const publish = git.trackedFileSearch.set.bind(git.trackedFileSearch);
    git.trackedFileSearch.set = (result: any) => {
      if (result) fixture.published.push(result.paths);
      publish(result);
    };
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      if (command === 'search_tracked_files') {
        return new Promise(resolve => fixture.requests.push(paths => resolve({ paths, truncated: false })));
      }
      const repo = git.repositories().find((value: any) => value.id === args?.repoId);
      if (command === 'refresh_repository_status') return Promise.resolve(repo?.status);
      if (command === 'refresh_repository_metadata' || command === 'refresh_repository') return Promise.resolve(repo);
      return Promise.reject(new Error(`Unexpected command ${command}`));
    } };
  });
  await page.keyboard.press('Control+Shift+H');
  const input = page.getByRole('combobox', { name: 'Search tracked files', exact: true });
  await input.fill('tracked');
  const requestCount = () => page.evaluate(() => (window as any).__fileQueryLease.requests.length);
  await expect.poll(requestCount).toBe(1);
  const changedVisit = await page.evaluate(() => {
    const { git } = (window as any).ng.getComponent(document.querySelector('gk-app'));
    const fixture = (window as any).__fileQueryLease;
    const before = git.activeRepositoryReadScope();
    git.activateRepository('other-search-checkout');
    git.activateRepository(fixture.original.id);
    fixture.requests[0](['obsolete-tracked.txt']);
    return git.activeRepositoryId() === fixture.original.id && git.activeRepositoryReadScope() !== before;
  });
  expect(changedVisit).toBe(true);
  await expect.poll(requestCount).toBe(2);
  await page.evaluate(() => (window as any).__fileQueryLease.requests[1](['current-tracked.txt']));
  await expect(page.getByRole('option', { name: /^File History: current-tracked\.txt/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /obsolete-tracked/ })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__fileQueryLease.published)).toEqual([['current-tracked.txt']]);
});

test('a tracked-file search timeout is announced and a later query can succeed', async ({ page }) => {
  await page.evaluate(() => {
    const { git } = (window as any).ng.getComponent(document.querySelector('gk-app'));
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'tracked file search test' }));
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      if (command === 'search_tracked_files') {
        if (args.query === 'slow') {
          return Promise.reject({ kind: 'trackedFileSearchTimedOut', message: 'fixture' });
        }
        if (args.query === 'matched') {
          return Promise.resolve({ paths: ['current-matched.txt'], truncated: false });
        }
      }
      return Promise.reject(new Error(`Unexpected command ${command}`));
    } };
  });

  await page.keyboard.press('Control+Shift+H');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  const input = palette.getByRole('combobox', { name: 'Search tracked files', exact: true });
  await input.fill('slow');
  await expect(palette.getByRole('alert')).toHaveText('Git took too long to search tracked files. Change the query to retry.');
  await expect(palette.getByText('No matching tracked files')).toHaveCount(0);
  await expect(input).toBeFocused();

  await input.fill('matched');
  await expect(palette.getByRole('option', { name: /^File History: current-matched\.txt/ })).toBeVisible();
  await expect(palette.getByRole('option', { name: /^Blame: current-matched\.txt/ })).toBeVisible();
  await expect(palette.getByRole('alert')).toHaveCount(0);
});
