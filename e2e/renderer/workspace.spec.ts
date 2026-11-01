import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.locator('.commit-row').first()).toBeVisible();
});

async function resolvedCssColor(page: Page, value: string): Promise<string> {
  return page.evaluate((background) => {
    const probe = document.createElement('span');
    probe.style.background = background;
    document.body.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  }, value);
}

async function cssContrastRatio(page: Page, foreground: string, background: string): Promise<number> {
  return page.evaluate(({ foreground, background }) => {
    const probe = document.createElement('span');
    probe.style.color = foreground;
    probe.style.backgroundColor = background;
    document.body.append(probe);
    const style = getComputedStyle(probe);
    const channels = (value: string) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const luminance = (value: string) => {
      const [red, green, blue] = channels(value).map(channel => {
        const normalized = channel / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    };
    const foregroundLuminance = luminance(style.color);
    const backgroundLuminance = luminance(style.backgroundColor);
    probe.remove();
    return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
      / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
  }, { foreground, background });
}

test('uses the Git Khronos identity throughout the application chrome', async ({ page }) => {
  await expect(page).toHaveTitle(/ — Git Khronos$/);
  await expect(page.locator('.app-menu .brand-mark')).toHaveText('GC');
  await page.getByRole('button', { name: 'Main menu' }).click();
  await expect(page.getByRole('menu', { name: 'Git Khronos menu' })).toContainText('Git Khronos');
});

test('summarizes branch sync and working-tree state in the primary branch selector', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const branchSelector = page.getByRole('button', { name: /Switch branch, current main/ });
  const summary = branchSelector.locator('.branch-state-summary');
  await expect(summary).toHaveText('1 ahead · 4 changes');
  await expect.poll(() => summary.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(branchSelector).toHaveAttribute('aria-label', 'Switch branch, current main, 1 ahead · 4 changes');
  await expect(branchSelector).toHaveAttribute('title', 'Switch branch · main · 1 ahead · 4 changes');
});

test('explains the selected remote relationship in the primary repository context', async ({ page }) => {
  const remoteSelector = page.getByRole('button', { name: 'Select remote, current origin, Pull & push' });
  await expect(remoteSelector.locator('small')).toHaveText('Pull & push');
  await expect(remoteSelector).toHaveAttribute('title', 'Select pull and push remote · origin · Pull & push');

  await remoteSelector.click();
  await page.getByRole('menu', { name: 'Select remote for pull and push' })
    .getByRole('menuitemradio', { name: /upstream/ }).click();
  const alternateRemoteSelector = page.getByRole('button', { name: 'Select remote, current upstream, Pull & push' });
  await expect(alternateRemoteSelector.locator('small')).toHaveText('Pull & push');

  await page.goto('/?unpublished-branch&no-remotes');
  const emptyRemoteSelector = page.getByRole('button', { name: 'Select remote, current none, Configure remote' });
  await expect(emptyRemoteSelector.locator('small')).toHaveText('Configure remote');
  await expect(emptyRemoteSelector.locator('strong')).toHaveText('No remotes');
});

test('prioritizes complete repository context names before secondary toolbar labels', async ({ page }) => {
  let remoteSelector = page.getByRole('button', { name: 'Select remote, current origin, Pull & push' });
  let branchSelector = page.getByRole('button', { name: /Switch branch, current main/ });
  for (const width of [1440, 1351]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    remoteSelector = page.getByRole('button', { name: 'Select remote, current origin, Pull & push' });
    branchSelector = page.getByRole('button', { name: /Switch branch, current main/ });
    await expect(remoteSelector.locator('small')).toBeVisible();
    await expect(branchSelector.locator('small')).toBeVisible();
    expect(await remoteSelector.locator('strong').evaluate((label) => label.scrollWidth <= label.clientWidth)).toBe(true);
    const [navigation, actions] = await Promise.all([
      page.locator('.toolbar-navigation').boundingBox(),
      page.locator('.toolbar-actions').boundingBox(),
    ]);
    expect(navigation).not.toBeNull();
    expect(actions).not.toBeNull();
    expect(navigation!.x + navigation!.width).toBeLessThanOrEqual(actions!.x);
  }

  for (const width of [1350, 1200, 1100, 1051, 1050, 820, 700]) {
    await page.setViewportSize({ width, height: 720 });
    await page.goto('/');
    remoteSelector = page.getByRole('button', { name: 'Select remote, current origin, Pull & push' });
    branchSelector = page.getByRole('button', { name: /Switch branch, current main/ });
    await expect(remoteSelector.locator('small')).toBeHidden();
    await expect(branchSelector.locator('small')).toBeHidden();
    await expect(remoteSelector).toHaveAttribute('title', 'Select pull and push remote · origin · Pull & push');
    expect(await remoteSelector.locator('strong').evaluate((label) => label.scrollWidth <= label.clientWidth),
      `remote name should fit at ${width}px`).toBe(true);
    expect(await branchSelector.locator('strong').evaluate((label) => label.scrollWidth <= label.clientWidth),
      `branch name should fit at ${width}px`).toBe(true);
    const [navigation, actions] = await Promise.all([
      page.locator('.toolbar-navigation').boundingBox(),
      page.locator('.toolbar-actions').boundingBox(),
    ]);
    expect(navigation).not.toBeNull();
    expect(actions).not.toBeNull();
    expect(navigation!.x + navigation!.width).toBeLessThanOrEqual(actions!.x);
  }
});

test('cancels eligible Git work, refreshes state, and distinguishes failures', async ({ page }) => {
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    const snapshot = git.repository();
    const testState = {
      attempts: 0,
      rejectFetch: [] as Array<(error: unknown) => void>,
      calls: [] as Array<{ command: string; args: Record<string, unknown> }>,
    };
    (window as any).__cancelOperationTest = { ...testState, git };
    git.systemInfo.set({
      appVersion: 'renderer test',
      gitVersion: '2.50.0',
      gitSupported: true,
      minimumGitVersion: '2.39.0',
    });
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string, args: Record<string, unknown> = {}) => {
        const state = (window as any).__cancelOperationTest;
        state.calls.push({ command, args });
        if (command === 'fetch_repository') {
          state.attempts += 1;
          return new Promise((_, reject) => state.rejectFetch.push(reject));
        }
        if (command === 'cancel_git_operation') return Promise.resolve(true);
        if (command === 'refresh_repository_status') return Promise.resolve(snapshot.status);
        if (command === 'refresh_repository') return Promise.resolve(snapshot);
        return Promise.reject(new Error(`Unexpected command: ${command}`));
      },
    };
    void git.remote('fetch_repository');
  });

  const cancelButton = page.getByRole('button', { name: /Cancel Fetching/ });
  await expect(cancelButton).toBeVisible();
  await cancelButton.click();
  const stoppingButton = page.getByRole('button', { name: /Cancel Fetching/ });
  await expect(stoppingButton).toBeDisabled();
  await expect(stoppingButton).toHaveText('Stopping…');

  await page.evaluate(() => {
    const state = (window as any).__cancelOperationTest;
    state.rejectFetch[0]({ kind: 'operationCancelled', message: 'Canceled for test.' });
  });
  await expect.poll(() => page.evaluate(() => {
    const state = (window as any).__cancelOperationTest;
    return state.git.activityLogs().at(-1)?.status;
  })).toBe('cancelled');
  await expect(page.locator('.cancel-operation')).toHaveCount(0);
  expect(await page.evaluate(() => {
    const state = (window as any).__cancelOperationTest;
    return {
      activity: state.git.activity(),
      error: state.git.error(),
      commands: state.calls
        .map((call: { command: string }) => call.command)
        .filter((command: string) => command !== 'refresh_repository_status'),
      completedStatus: state.calls.some((call: { command: string }) => call.command === 'refresh_repository_status'),
      cancellationMatchesOperation: state.calls[0].args.operationId === state.calls[1].args.operationId,
    };
  })).toEqual({
    activity: 'Operation canceled; repository state refreshed',
    error: null,
    commands: ['fetch_repository', 'cancel_git_operation', 'refresh_repository'],
    completedStatus: true,
    cancellationMatchesOperation: true,
  });

  await page.evaluate(() => {
    void (window as any).__cancelOperationTest.git.remote('fetch_repository');
  });
  await expect(page.getByRole('button', { name: /Cancel Fetching/ })).toBeVisible();
  await page.evaluate(() => {
    const state = (window as any).__cancelOperationTest;
    state.rejectFetch[1]({ kind: 'gitFailure', message: 'Remote rejected the request.' });
  });
  await expect.poll(() => page.evaluate(() => {
    const state = (window as any).__cancelOperationTest;
    return state.git.activityLogs().at(-1)?.status;
  })).toBe('error');
  await expect(page.locator('.cancel-operation')).toHaveCount(0);
  expect(await page.evaluate(() => {
    const git = (window as any).__cancelOperationTest.git;
    return { activity: git.activity(), error: git.error() };
  })).toEqual({
    activity: 'Operation failed',
    error: 'Remote rejected the request.',
  });
});

test('surfaces the primary repository shortcut on the welcome screen', async ({ page }) => {
  await page.goto('/?welcome-preview');
  await page.evaluate(() => {
    localStorage.setItem('git-khronos.recent-repositories.v1', JSON.stringify([
      '/home/maya/projects/atlas-ui',
      '/home/maya/projects/chronos-api',
      '/home/maya/sandboxes/release-candidate',
      '/mnt/work/client-portal',
    ]));
    localStorage.setItem('git-khronos.favorite-repositories.v1', JSON.stringify([
      '/home/maya/projects/atlas-ui',
      '/home/maya/projects/chronos-api',
    ]));
  });
  await page.reload();
  const launcher = page.locator('.welcome-launcher');
  const openRepository = page.getByRole('button', { name: /Open repository/ });
  await expect(page.getByRole('heading', { name: 'Open a repository' })).toBeVisible();
  await expect(launcher).toContainText('Choose a local repository, clone a remote, or start a new one.');
  await expect(page.getByText('Find your way through')).toHaveCount(0);
  await expect(launcher.getByRole('button')).toHaveCount(3);
  await expect(launcher.getByRole('button', { name: /Clone repository/ })).toContainText('Download from a remote URL');
  await expect(launcher.getByRole('button', { name: /Initialize repository/ })).toContainText('Create a repository in a folder');
  await expect(openRepository).toHaveCSS('border-top-width', '0px');
  await expect(launcher).toHaveCSS('max-width', '760px');
  await expect(page.locator('.recents.favorites .welcome-repository-card')).toHaveCount(2);
  await expect(page.locator('.recents:not(.favorites) .welcome-repository-card')).toHaveCount(2);
  await expect(page.locator('.welcome-repository-main').first()).toHaveCSS('border-top-width', '0px');
  const favoriteRepositoryIcon = page.locator('.recents.favorites .repo-icon').first();
  const recentRepositoryIcon = page.locator('.recents:not(.favorites) .repo-icon').first();
  const activeFavoriteControl = page.locator('.recents.favorites .welcome-favorite-toggle.active').first();
  await expect(favoriteRepositoryIcon).toHaveCSS('color', await recentRepositoryIcon.evaluate((element) => getComputedStyle(element).color));
  expect(await activeFavoriteControl.evaluate((element) => getComputedStyle(element).color))
    .not.toBe(await favoriteRepositoryIcon.evaluate((element) => getComputedStyle(element).color));
  const recentFavoriteControl = page.locator('.recents:not(.favorites) .welcome-favorite-toggle').first();
  await recentFavoriteControl.focus();
  await expect(recentFavoriteControl).toHaveCSS('opacity', '1');
  await expect(recentFavoriteControl).toHaveCSS('color', 'rgb(226, 180, 95)');
  await expect(page.locator('.recents:not(.favorites)')).toContainText('2 repositories');
  await expect(page.locator('.recents:not(.favorites)')).not.toContainText('atlas-ui');
  await expect(page.locator('.recents:not(.favorites)')).not.toContainText('chronos-api');
  const repositoryFilter = page.getByRole('searchbox', { name: 'Filter favorites and recent repositories' });
  await repositoryFilter.fill('chronos-api');
  await expect(page.locator('.recents.favorites .welcome-repository-card kbd')).toHaveText('Ctrl Alt 2');
  await repositoryFilter.press('Escape');
  await repositoryFilter.fill('release');
  await expect(page.locator('.recents.favorites')).toHaveCount(0);
  await expect(page.locator('.recents:not(.favorites) .welcome-repository-card')).toHaveCount(1);
  await expect(page.locator('[data-welcome-filter-status]')).toHaveText('1 of 4 shown');
  await repositoryFilter.fill('missing repository');
  const noMatches = page.getByRole('region', { name: 'No matching repositories' });
  await expect(noMatches).toContainText('Try part of a repository name or folder path.');
  await noMatches.getByRole('button', { name: 'Clear filter' }).click();
  await expect(repositoryFilter).toBeFocused();
  await repositoryFilter.fill('missing repository');
  await repositoryFilter.press('Escape');
  await expect(repositoryFilter).toHaveValue('');
  await expect(page.locator('.recents.favorites .welcome-repository-card')).toHaveCount(2);
  await expect(page.locator('.recents:not(.favorites) .welcome-repository-card')).toHaveCount(2);
  await page.setViewportSize({ width: 700, height: 720 });
  const firstFavoriteCard = page.locator('.recents.favorites .welcome-repository-card').first();
  const firstFavoriteMain = firstFavoriteCard.locator('.welcome-repository-main');
  await expect(firstFavoriteMain).toHaveAttribute('title', '/home/maya/projects/atlas-ui');
  await expect(firstFavoriteMain).toHaveAttribute('aria-label', 'Open atlas-ui at /home/maya/projects/atlas-ui');
  await firstFavoriteMain.focus();
  const repositoryPathTooltip = firstFavoriteCard.getByRole('tooltip');
  await expect(repositoryPathTooltip).toBeVisible();
  await expect(repositoryPathTooltip).toHaveText('/home/maya/projects/atlas-ui');
  const [favoriteCardBox, repositoryPathTooltipBox] = await Promise.all([
    firstFavoriteCard.boundingBox(),
    repositoryPathTooltip.boundingBox(),
  ]);
  expect(favoriteCardBox).not.toBeNull();
  expect(repositoryPathTooltipBox).not.toBeNull();
  expect(repositoryPathTooltipBox!.x).toBeGreaterThanOrEqual(0);
  expect(repositoryPathTooltipBox!.x + repositoryPathTooltipBox!.width).toBeLessThanOrEqual(700);
  expect(repositoryPathTooltipBox!.y + repositoryPathTooltipBox!.height).toBeLessThanOrEqual(favoriteCardBox!.y);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Remove atlas-ui from favorites' }).click();
  await expect(page.locator('.recents.favorites .welcome-repository-card')).toHaveCount(1);
  await expect(page.locator('.recents:not(.favorites) .welcome-repository-card')).toHaveCount(3);
  await expect(page.locator('.recents:not(.favorites)')).toContainText('3 repositories');
  await expect(page.locator('.recents:not(.favorites)')).toContainText('atlas-ui');
  const removeRecent = page.getByRole('button', { name: 'Remove release-candidate from recent repositories' });
  await removeRecent.focus();
  await expect(removeRecent).toBeFocused();
  await expect(removeRecent).toHaveCSS('opacity', '1');
  await removeRecent.press('Enter');
  await expect(page.locator('.recents:not(.favorites) .welcome-repository-card')).toHaveCount(2);
  await expect(page.locator('.recents:not(.favorites)')).toContainText('2 repositories');
  await expect(page.locator('.recents:not(.favorites)')).not.toContainText('release-candidate');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('git-khronos.recent-repositories.v1')))
    .toBe('["/home/maya/projects/atlas-ui","/home/maya/projects/chronos-api","/mnt/work/client-portal"]');
  await expect(openRepository).toHaveAttribute('aria-keyshortcuts', 'Control+Shift+O Meta+Shift+O');
  await expect(openRepository).toHaveAttribute('title', 'Open a local repository (Ctrl+Shift+O)');
  await expect(openRepository.locator('kbd')).toHaveText('Ctrl ⇧ O');

  await page.setViewportSize({ width: 550, height: 720 });
  await expect(openRepository).toBeVisible();
  expect(await openRepository.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await launcher.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

  await page.setViewportSize({ width: 420, height: 720 });
  await expect(page.locator('.welcome-nav .version')).toBeHidden();
  await expect(page.locator('.welcome-theme-toggle > span')).toBeHidden();
  const [brandBox, controlsBox] = await Promise.all([
    page.locator('.welcome-nav .brand').boundingBox(),
    page.locator('.welcome-controls').boundingBox(),
  ]);
  expect(brandBox).not.toBeNull();
  expect(controlsBox).not.toBeNull();
  expect(brandBox!.height).toBe(38);
  expect(brandBox!.x + brandBox!.width).toBeLessThanOrEqual(controlsBox!.x);
  expect(controlsBox!.x + controlsBox!.width).toBeLessThanOrEqual(420 - 28);

  const welcome = page.locator('.welcome');
  await welcome.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect.poll(() => welcome.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const [lastRepositoryCard, zoomControl] = await Promise.all([
    page.locator('.welcome-repository-card').last().boundingBox(),
    page.locator('.zoom-control').boundingBox(),
  ]);
  expect(lastRepositoryCard).not.toBeNull();
  expect(zoomControl).not.toBeNull();
  expect(lastRepositoryCard!.y + lastRepositoryCard!.height).toBeLessThanOrEqual(zoomControl!.y - 8);
  await welcome.evaluate((element) => { element.scrollTop = 0; });

  await openRepository.click();
  let manager = page.getByRole('dialog', { name: 'Repository management' });
  await expect(manager).toBeVisible();
  const browseTab = manager.getByRole('tab', { name: 'Browse' });
  await expect(browseTab).toHaveAttribute('aria-selected', 'true');
  await expect(browseTab).toBeFocused();
  const managerFilter = manager.getByRole('searchbox', { name: 'Filter managed repositories' });
  await expect(managerFilter).toBeVisible();
  await managerFilter.fill('client-portal');
  await expect(manager.locator('[data-manager-filter-status]')).toHaveText('1 of 3');
  await expect(manager.locator('.manager-favorites')).toHaveCount(0);
  await expect(manager.locator('.manager-recents .manager-repository-row')).toHaveCount(1);
  await expect(manager.locator('.manager-repository-main')).toHaveAttribute('title', '/mnt/work/client-portal');
  await expect(manager.locator('.manager-repository-main')).toHaveAttribute('aria-label', 'Open client-portal at /mnt/work/client-portal');
  await managerFilter.fill('missing repository');
  const managerNoMatches = manager.getByRole('region', { name: 'No matching repositories' });
  await expect(managerNoMatches).toContainText('Try part of a repository name or folder path.');
  await managerNoMatches.getByRole('button', { name: 'Clear filter' }).click();
  await expect(managerFilter).toBeFocused();
  await managerFilter.fill('client');
  await managerFilter.press('Escape');
  await expect(managerFilter).toHaveValue('');
  const managerFavorite = manager.locator('.manager-favorites .manager-repository-row').first();
  await expect(managerFavorite.locator('.manager-repository-main > gc-icon')).toHaveAttribute('name', 'folder-git');
  await expect(managerFavorite.locator('.manager-favorite-toggle > gc-icon')).toHaveAttribute('name', 'star');
  const managerClose = manager.getByRole('button', { name: 'Close repository management' });
  const managerLastEnabled = manager.locator('button:not(:disabled)').last();
  await managerClose.focus();
  await managerClose.press('Shift+Tab');
  await expect(managerLastEnabled).toBeFocused();
  await managerLastEnabled.press('Tab');
  await expect(managerClose).toBeFocused();
  await expect(manager.getByText('Sample-data preview')).toBeVisible();
  await expect(page.getByText('Git needs attention')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(openRepository).toBeFocused();

  const cloneRepository = launcher.getByRole('button', { name: 'Clone repository' });
  await cloneRepository.click();
  manager = page.getByRole('dialog', { name: 'Repository management' });
  await expect(manager.getByLabel('Repository URL')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(cloneRepository).toBeFocused();

  const initializeRepository = launcher.getByRole('button', { name: 'Initialize repository' });
  await initializeRepository.click();
  manager = page.getByRole('dialog', { name: 'Repository management' });
  await expect(manager.getByRole('button', { name: 'Browse' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(initializeRepository).toBeFocused();
});

test('jumps between shortcut categories in compact windows', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 720 });
  const opener = page.getByTitle('Command palette (Ctrl+P)');
  await opener.focus();
  await page.keyboard.press('Control+/');
  const dialog = page.getByRole('dialog', { name: 'Keyboard Shortcuts' });
  const groups = dialog.locator('.shortcut-groups');
  const tabsAndView = dialog.locator('#shortcut-section-tabs-view');
  const close = dialog.getByRole('button', { name: 'Close keyboard shortcuts' });
  await expect(dialog.locator('header > span gc-icon svg rect')).toHaveAttribute('width', '18');
  await expect(dialog.getByRole('navigation', { name: 'Shortcut sections' })).toBeVisible();
  const search = dialog.getByRole('searchbox', { name: 'Search keyboard shortcuts' });
  await expect(search).toBeFocused();
  await expect(dialog.locator(':scope > footer')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Repository' })).toHaveCSS('font-size', '13px');
  await expect(dialog.getByText('Undo repository action', { exact: true })).toHaveCSS('font-size', '13px');
  await expect(dialog.getByRole('button', { name: 'Repository' })).toHaveAttribute('aria-current', 'location');
  const dialogMetrics = await dialog.evaluate((element) => ({
    bottom: element.getBoundingClientRect().bottom,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(dialogMetrics.bottom).toBeLessThanOrEqual(720);
  expect(dialogMetrics.scrollHeight).toBeLessThanOrEqual(dialogMetrics.clientHeight + 1);

  await close.focus();
  await close.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Tabs and view' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Tabs and view' }).press('Tab');
  await expect(close).toBeFocused();
  await close.press('Tab');
  await expect(search).toBeFocused();
  await search.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Repository' })).toBeFocused();

  await dialog.getByRole('button', { name: 'Tabs and view' }).click();
  await expect(dialog.getByRole('button', { name: 'Tabs and view' })).toHaveAttribute('aria-current', 'location');
  await expect(dialog.getByRole('button', { name: 'Repository' })).not.toHaveAttribute('aria-current', 'location');
  await expect.poll(() => groups.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect.poll(async () => {
    const [groupsBox, tabsBox] = await Promise.all([groups.boundingBox(), tabsAndView.boundingBox()]);
    return !!groupsBox && !!tabsBox
      && tabsBox.y >= groupsBox.y
      && tabsBox.y < groupsBox.y + groupsBox.height;
  }).toBe(true);

  await dialog.getByRole('button', { name: 'Repository', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Repository', exact: true })).toHaveAttribute('aria-current', 'location');
  await expect.poll(() => groups.evaluate((element) => element.scrollTop)).toBe(0);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test('edits the repository-local Git author from the header identity popover', async ({ page }) => {
  await page.getByTitle('Repository Git identity').click();
  const identity = page.locator('.identity-popover');
  await expect(identity).toHaveRole('dialog');
  await expect(identity).toContainText('Maya Chen');
  await identity.getByRole('button', { name: 'Edit identity' }).click();

  await identity.getByLabel('Name').fill('Morgan Lee');
  await identity.getByLabel('Email').fill('morgan@example.test');
  await identity.getByRole('button', { name: 'Save identity' }).click();

  await expect(identity.locator('.identity-form')).toHaveCount(0);
  await expect(identity).toContainText('Morgan Lee');
  await expect(identity).toContainText('morgan@example.test');
  await expect(page.getByTitle('Repository Git identity')).toContainText('Morgan Lee');
});

test('presents the sample repository as a complete Git workspace', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('.repo-tab.active')).toContainText('git-khronos');
  await expect(page.getByLabel('Repository actions', { exact: true })).toBeVisible();
  await expect(page.locator('.toolbar-actions .action-group-divider')).toHaveCount(2);
  await expect(page.locator('.toolbar-actions .action-group-divider').first()).toBeVisible();
  await expect(page.getByLabel('Interface zoom controls')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Activity Logs: Repository preview' })).toBeVisible();
  await expect(page.getByText('Repository preview', { exact: true })).toHaveCount(1);
  await expect(page.locator('.commit-list')).not.toContainText('Loading older commits');
  await expect(page.getByRole('button', { name: 'Load older commits' })).toHaveCount(0);
  await expect(page.locator('.commit-row')).toHaveCount(9);
  await expect(page.locator('.graph-edges path')).not.toHaveCount(0);
  await expect(page.locator('.author-node')).not.toHaveCount(0);
  await expect(page.locator('.graph-columns')).toContainText('AUTHOR');
  await expect(page.locator('.graph-columns')).toContainText('DATE / TIME');
  await expect(page.locator('.commit-row .row-date').first()).toBeVisible();
  await expect(page.locator('#reference-section-local .branch-item').first()).toHaveAttribute('aria-label', /Local branch main, current/);
  await expect(page.getByLabel(/Local branch main, current/)).toBeVisible();
  const remoteSection = page.locator('#reference-section-remote');
  const remoteSectionToggle = remoteSection.getByRole('button', { name: 'Remote 2' });
  await expect(remoteSectionToggle).toBeVisible();
  await expect(remoteSection.locator('.remote-location')).toHaveCount(2);
  await remoteSectionToggle.click();
  await expect(remoteSectionToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(remoteSectionToggle).toHaveAccessibleName('Remote 2');
  await remoteSectionToggle.click();
  await expect(remoteSectionToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByLabel('Local branch feature/partial-staging')).toHaveAttribute('title', /Local branch feature\/partial-staging/);
  const featureWorktree = page.getByLabel(/Worktree feature\/partial-staging, \/home\/maya\/projects\/git-khronos-partial-staging/);
  await expect(featureWorktree).toBeVisible();
  await expect(featureWorktree.locator('xpath=..')).toHaveAttribute('title', 'feature/partial-staging · /home/maya/projects/git-khronos-partial-staging');
  await expect(page.locator('.branch-item.current .branch-tracking')).toHaveText('↑1');
  await expect(page.locator('.branch-item.current .branch-tracking')).toHaveAttribute('title', 'Tracking origin/main: ahead 1');
  await expect(page.locator('.commit-row .ref-pill').filter({ hasText: 'main' }).first().locator('.ref-sync')).toHaveText('↑1');
  await expect(page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"] .ref-pill.current-ref')).toBeVisible();
  const graphReferenceActions = page.locator('.commit-row button.ref-pill, .commit-row .reference-stack-trigger');
  expect(await graphReferenceActions.count()).toBeGreaterThan(0);
  expect(await graphReferenceActions.evaluateAll((controls) => controls.every((control) => {
    const box = control.getBoundingClientRect();
    return box.width >= 24 && box.height >= 24;
  }))).toBe(true);
  expect(await page.locator('.commit-row:not(.wip-row)').evaluateAll((rows) =>
    rows.every((row) => row.getBoundingClientRect().height === 40),
  )).toBe(true);
  expect(await page.locator('.commit-row.wip-row').evaluateAll((rows) =>
    rows.every((row) => row.getBoundingClientRect().height === 44),
  )).toBe(true);
  await expect(page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"] .author-node')).toHaveClass(/head-node/);
  await expect(page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"] .author-node')).toHaveAttribute('title', /^HEAD · /);
  await expect(page.getByRole('button', { name: 'Push 1 commit to origin/main' }).locator('.toolbar-sync-badge')).toHaveText('1');
  await expect(page.getByRole('button', { name: 'Push 1 commit to origin/main' }).locator('.toolbar-sync-badge')).toHaveCSS('font-size', '12px');
  await expect(page.getByRole('button', { name: 'Pull from origin/main' }).locator('.toolbar-sync-badge')).toHaveCount(0);
  await page.getByRole('button', { name: 'Fetch options' }).click();
  await expect(page.getByRole('menuitem', { name: /Fetch all remotes/ })).toContainText('Update every configured remote without changing local work');
  await page.keyboard.press('Escape');
  const currentSidebarBranch = page.locator('#reference-section-local').getByRole('button', { name: /Local branch main, current/ });
  const currentSidebarRow = currentSidebarBranch.locator('xpath=..');
  await expect(currentSidebarRow.locator('.aligned-remote-location')).toHaveCount(2);
  await expect(currentSidebarRow.locator('.aligned-remote-location.tip-diverged')).toHaveCount(2);
  expect(await currentSidebarRow.locator('.aligned-remote-location').evaluateAll((locations) =>
    locations.map((location) => location.getAttribute('aria-label')),
  )).toEqual([
    'Remote branch origin/main',
    'Remote branch upstream/main',
  ]);
  await expect(currentSidebarRow.getByLabel('Remote branch origin/main', { exact: true })).toBeVisible();
  await expect(currentSidebarRow.getByLabel('Remote branch upstream/main', { exact: true })).toBeVisible();
  await expect(page.locator('#reference-section-remote').getByLabel('Remote branch origin/main', { exact: true })).toHaveCount(0);
  await expect(page.locator('#reference-section-remote').getByLabel('Remote branch upstream/main', { exact: true })).toHaveCount(0);
  const remoteOnlyRow = page.locator('.remote-branch-item[aria-label="Remote branch origin/docs"]').locator('xpath=..');
  await expect(page.locator('#reference-section-remote .remote-branch-item')).toHaveCount(1);
  await expect(remoteOnlyRow.locator('.remote-branch-location')).toHaveCount(2);
  await expect(remoteOnlyRow.locator('.remote-branch-location.tip-diverged')).toHaveCount(1);
  expect(await remoteOnlyRow.locator('.remote-branch-location').evaluateAll((locations) =>
    locations.map((location) => location.getAttribute('aria-label')),
  )).toEqual([
    'Remote location origin for branch docs',
    'Remote location upstream for branch docs',
  ]);
  await expect(remoteOnlyRow.getByLabel('Remote location upstream for branch docs', { exact: true })).toBeVisible();
  const alignedSidebarBranch = page.locator('#reference-section-local').getByRole('button', { name: 'Local branch release', exact: true });
  await expect(alignedSidebarBranch).toBeVisible();
  const alignedSidebarRow = alignedSidebarBranch.locator('xpath=..');
  await expect(alignedSidebarRow.locator('.aligned-remote-location')).toHaveCount(2);
  await expect(alignedSidebarRow.locator('.aligned-remote-location.tip-diverged')).toHaveCount(0);
  await expect(alignedSidebarRow.getByLabel('Remote branch origin/release', { exact: true })).toBeVisible();
  await expect(alignedSidebarRow.getByLabel('Remote branch upstream/release', { exact: true })).toBeVisible();
  await expect(page.locator('#reference-section-remote').getByLabel('Remote branch origin/release', { exact: true })).toHaveCount(0);
  await expect(page.locator('#reference-section-remote').getByLabel('Remote branch upstream/release', { exact: true })).toHaveCount(0);
  await page.locator('.workspace').evaluate((workspace) => {
    workspace.style.gridTemplateColumns = '170px minmax(480px, 1fr) 355px';
  });
  for (const name of ['main', 'release']) {
    const row = page.locator('#reference-section-local').getByRole('button', {
      name: new RegExp(`^Local branch ${name}(?:,|$)`),
    }).locator('xpath=..');
    const label = row.locator('.branch-item > span').nth(1);
    await expect(label).toBeVisible();
    expect(await label.evaluate((element) => element.clientWidth)).toBeGreaterThan(0);
    await expect(row.locator('.aligned-branch-locations')).toBeVisible();
    expect(await row.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(29);
  }
  await page.locator('.workspace').evaluate((workspace) => workspace.style.removeProperty('grid-template-columns'));
  await expect(page.locator('.remote-location')).toHaveCount(2);
  const compactReferenceActions = page.locator([
    '.worktree-list-actions',
    '.visibility-toggle',
    '.aligned-remote-location',
    '.remote-collapse',
    '.remote-visibility',
    '.remote-edit',
    '.remote-branch-location',
  ].join(','));
  expect(await compactReferenceActions.count()).toBeGreaterThan(0);
  expect(await compactReferenceActions.evaluateAll((controls) => controls.every((control) => {
    const box = control.getBoundingClientRect();
    return box.width >= 24 && box.height >= 24;
  }))).toBe(true);
  for (const selector of ['.remote-visibility', '.remote-edit']) {
    const control = page.locator(selector).first();
    await control.focus();
    await expect(control).toHaveCSS('opacity', '1');
    await expect(control).toHaveCSS('color', 'rgb(255, 255, 255)');
  }
  await expect(page.locator('.grouped-reference-location.remote gc-icon')).toHaveCount(4);
  const sharedTip = page.locator('[data-commit-oid="83e6d15fb82672899688b93f59251dfc669888a3"] .commit-ref-stack');
  const sharedTipRefs = sharedTip.locator('.grouped-reference-location.remote');
  const sharedTipTrigger = sharedTip.locator('.reference-stack-trigger');
  await expect(sharedTipTrigger.locator('.reference-stack-label')).toHaveText('main');
  await expect(sharedTipTrigger).not.toContainText('origin/main');
  await expect(sharedTipTrigger).not.toContainText('upstream/main');
  await expect(sharedTipTrigger.locator('.reference-stack-locations gc-icon')).toHaveCount(2);
  await expect(sharedTipTrigger.locator('.reference-stack-chevron')).toBeVisible();
  await expect(sharedTipTrigger.locator(':scope > b')).toHaveCount(0);
  await expect(sharedTipTrigger).toHaveAttribute(
    'aria-label',
    'main: remote origin, remote upstream. Show all 2 references.',
  );
  await expect(sharedTipTrigger).toHaveAttribute(
    'title',
    'main: remote origin, remote upstream. Show all 2 references.',
  );
  await expect(sharedTipTrigger).toHaveAttribute('aria-expanded', 'false');
  await expect(sharedTip.locator('.ref-stack-heading')).toBeHidden();
  await expect(sharedTipRefs.first()).toBeHidden();
  await expect(sharedTipRefs.nth(1)).toBeHidden();

  const alignedLocalAndRemotes = page.locator('[data-commit-oid="ca5fa80bf46c95b6c8d4296d47f3fd9e1e77d5c2"] .commit-ref-stack');
  const alignedTrigger = alignedLocalAndRemotes.locator('.reference-stack-trigger');
  await expect(alignedTrigger.locator('.reference-stack-label')).toHaveText('release');
  await expect(alignedTrigger).not.toContainText('origin/release');
  await expect(alignedTrigger).not.toContainText('upstream/release');
  await expect(alignedTrigger.locator('.reference-stack-locations gc-icon')).toHaveCount(3);
  await alignedTrigger.hover();
  await expect(alignedLocalAndRemotes.locator('.grouped-reference-row')).toHaveCount(1);
  await expect(alignedLocalAndRemotes.locator('.grouped-reference-label')).toHaveText('release');
  await expect(alignedLocalAndRemotes.locator('.grouped-reference-location.local')).toHaveCount(1);
  await expect(alignedLocalAndRemotes.locator('.grouped-reference-location.remote')).toHaveCount(2);
  await sharedTipTrigger.hover();
  await expect(sharedTip.locator('.ref-stack-heading')).toHaveText('1 branch · 2 locations');
  await expect(sharedTip.locator('.ref-stack-heading')).toBeVisible();
  await expect(sharedTipRefs).toHaveCount(2);
  await expect(sharedTipRefs.first()).toBeVisible();
  await expect(sharedTipRefs.nth(1)).toBeVisible();
  await expect(sharedTipTrigger).toHaveAttribute('aria-expanded', 'true');
  const [triggerBox, surfaceBox, triggerLabelBox, firstRefBox, groupedLabelBox, secondRefBox] = await Promise.all([
    sharedTipTrigger.boundingBox(),
    sharedTip.locator('.reference-stack-popover').boundingBox(),
    sharedTipTrigger.locator('.reference-stack-label').boundingBox(),
    sharedTipRefs.first().boundingBox(),
    sharedTip.locator('.grouped-reference-label').boundingBox(),
    sharedTipRefs.nth(1).boundingBox(),
  ]);
  expect(triggerBox).not.toBeNull();
  expect(surfaceBox).not.toBeNull();
  expect(triggerLabelBox).not.toBeNull();
  expect(firstRefBox).not.toBeNull();
  expect(groupedLabelBox).not.toBeNull();
  expect(secondRefBox).not.toBeNull();
  expect(Math.abs(surfaceBox!.x - triggerBox!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(groupedLabelBox!.x - triggerLabelBox!.x)).toBeLessThanOrEqual(3);
  await expect(sharedTip.locator('.grouped-reference-row')).toHaveCount(1);
  const groupedReferenceLabel = sharedTip.locator('.grouped-reference-label');
  await expect(groupedReferenceLabel).toHaveText('main');
  await expect(groupedReferenceLabel).toHaveCSS('white-space', 'normal');
  await expect(groupedReferenceLabel).toHaveCSS('overflow-wrap', 'anywhere');
  expect(firstRefBox!.width).toBeGreaterThanOrEqual(18);
  expect(secondRefBox!.width).toBeGreaterThanOrEqual(18);
  expect(secondRefBox!.x).toBeGreaterThanOrEqual(firstRefBox!.x + firstRefBox!.width + 1);
  expect(Math.abs(firstRefBox!.y - secondRefBox!.y)).toBeLessThanOrEqual(1);
  await page.mouse.move(0, 0);
  await expect(sharedTipTrigger).toHaveAttribute('aria-expanded', 'false');
  await sharedTipTrigger.focus();
  await expect(sharedTipTrigger).toBeFocused();
  await expect(sharedTipTrigger).toHaveAttribute('aria-expanded', 'false');
  await sharedTipTrigger.press('Enter');
  await expect(sharedTipTrigger).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('[data-commit-oid="83e6d15fb82672899688b93f59251dfc669888a3"]')).toHaveClass(/branch-highlighted/);
  await expect(page.locator('[data-commit-oid="ca5fa80bf46c95b6c8d4296d47f3fd9e1e77d5c2"]')).toHaveClass(/branch-highlighted/);
  await expect(page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"]')).toHaveClass(/branch-dimmed/);
  await page.keyboard.press('Escape');
  await expect(sharedTipRefs.nth(1)).toBeHidden();
  await expect(sharedTipTrigger).toHaveAttribute('aria-expanded', 'false');
  await expect(sharedTip).not.toBeFocused();
  await expect(page.locator('[data-commit-oid="83e6d15fb82672899688b93f59251dfc669888a3"]')).not.toHaveClass(/branch-highlighted/);
  const remoteSidebarBranch = page.locator('#reference-section-local').getByLabel('Remote branch origin/main', { exact: true });
  await expect(remoteSidebarBranch).toHaveAttribute(
    'title',
    'Remote origin location for main · Different tip from local branch · Click to view its branch tip · Right-click for actions',
  );
  await expect(remoteSidebarBranch).toHaveJSProperty('tagName', 'BUTTON');
  await expect(sharedTip.locator('[aria-label="Remote branch origin/main"]')).toHaveAttribute(
    'title',
    'Remote origin · Double-click to create a local tracking branch',
  );
  expect(await sharedTip.locator('.grouped-reference-label').evaluate((label) =>
    label.scrollWidth <= label.clientWidth,
  )).toBe(true);
  await expect(page.locator('.ref-pill.local').filter({ hasText: 'feature/partial-staging' })).toBeVisible();
  await expect(page.locator('.ref-pill.local').filter({ hasText: 'feature/partial-staging' })).toHaveClass(/lane-color-1/);
  await expect(page.locator('.ref-pill.local').filter({ hasText: 'feature/partial-staging' })).toHaveCSS('background-color', 'rgb(92, 79, 208)');
  await expect(page.locator('.branch-column').first()).toHaveCSS('justify-content', 'flex-end');
  await expect(page.locator('.ref-pill.local').filter({ hasText: 'feature/partial-staging' })).toHaveCSS(
    'clip-path',
    'polygon(0px 0px, calc(100% - 5px) 0px, 100% 50%, calc(100% - 5px) 100%, 0px 100%)',
  );
  const featureReferenceRow = page.locator('[data-commit-oid="7c17b9d37d6a36dc9477e611109136f86477041a"]');
  await expect(featureReferenceRow.locator('.ref-connector')).toHaveCSS('background-color', 'rgb(124, 110, 246)');
  // The second expanded lane is 16 + 40px from the graph origin. Preserve
  // the wider avatar spacing required by the rounded orthogonal routes.
  await expect(featureReferenceRow.locator('.ref-connector')).toHaveCSS('width', '56px');
  const firstWorkingTreePath = page.locator('.file-name-button.path-display').first();
  await expect(firstWorkingTreePath.locator('.file-path-prefix')).toHaveText('apps/desktop/src/app/');
  await expect(firstWorkingTreePath.locator('.file-path-name')).toHaveText('app.component.html');
  const workingTreeFilter = page.getByRole('searchbox', { name: 'Filter changed files' });
  await expect(workingTreeFilter).toHaveCSS('font-size', '13px');
  expect((await workingTreeFilter.boundingBox())!.height).toBeGreaterThanOrEqual(24);
  await workingTreeFilter.fill('interface-notes');
  await expect(page.locator('.file-filter-count')).toHaveText('1');
  const clearFileFilter = page.getByRole('button', { name: 'Clear file filter' });
  const clearFileFilterBox = await clearFileFilter.boundingBox();
  expect(clearFileFilterBox).not.toBeNull();
  expect(clearFileFilterBox!.width).toBeGreaterThanOrEqual(24);
  expect(clearFileFilterBox!.height).toBeGreaterThanOrEqual(24);
  await expect(page.locator('.file-name-button.path-display')).toHaveCount(1);
  await expect(page.locator('.file-name-button.path-display .file-path-name')).toHaveText('interface-notes.md');
  await workingTreeFilter.press('Escape');
  await expect(workingTreeFilter).toHaveValue('');
  await expect(page.locator('.commit-main').filter({ hasText: 'Refine graph lane rendering' })).toContainText(
    'Keep first-parent histories straight through commit nodes.',
  );
  const headMessage = page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"] .commit-main');
  expect(await headMessage.locator('.subject').evaluate((subject) => subject.scrollWidth <= subject.clientWidth)).toBe(true);
  expect(await headMessage.locator('.commit-description').evaluate((description) => {
    const copy = description.parentElement!;
    return description.clientWidth >= Math.floor(copy.clientWidth * .18 - parseFloat(getComputedStyle(copy).columnGap));
  })).toBe(true);
  await expect(headMessage.locator('.subject')).toHaveCSS('font-size', '13px');
  await expect(headMessage.locator('.commit-description')).toHaveCSS('font-size', '12px');
  await expect(page.locator('.branch-item').filter({ hasText: 'feature/partial-staging' }).first()).toHaveCSS('font-size', '13px');
  await expect(page.locator('.file-row').first()).toHaveCSS('font-size', '13px');
  await expect(page.locator('[data-commit-oid="7c17b9d37d6a36dc9477e611109136f86477041a"] .commit-main')).toHaveAttribute(
    'title',
    'Refine graph lane rendering\nKeep first-parent histories straight through commit nodes.',
  );
  const mayaGraphColor = await page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"] .author-node')
    .evaluate((node) => getComputedStyle(node).getPropertyValue('--author-color').trim());
  const mayaIdentityColor = await resolvedCssColor(page, mayaGraphColor);
  expect(mayaIdentityColor).toBe('rgb(140, 115, 50)');
  await expect(page.locator('.identity-chip > span')).toHaveCSS('background-color', mayaIdentityColor);

  const signCommit = page.getByLabel('Sign this commit');
  await expect(page.getByLabel('Push after committing')).toBeVisible();
  await expect(page.getByLabel('Amend previous commit')).toBeVisible();
  await expect(page.getByLabel('Skip verification hooks')).toBeVisible();
  await expect(signCommit).toBeVisible();
  await expect(signCommit).not.toBeChecked();
  await expect(signCommit.locator('..')).toHaveAttribute('title', "Override signing for this commit using Git's configured key and format");
  const commitOptionHeights = await page.locator('.commit-options .commit-option').evaluateAll((options) =>
    options.map((option) => option.getBoundingClientRect().height),
  );
  expect(commitOptionHeights).toHaveLength(4);
  expect(commitOptionHeights.every((height) => height >= 24)).toBe(true);
  await signCommit.focus();
  await expect(signCommit).toBeFocused();
  await expect(signCommit).toHaveCSS('outline-style', 'solid');
  await signCommit.check();
  await expect(signCommit).toBeChecked();

  const stashMessage = page.getByRole('textbox', { name: 'Stash message' });
  expect((await stashMessage.boundingBox())!.height).toBeGreaterThanOrEqual(24);

  const workingTreeActions = page.getByRole('toolbar', { name: 'Working tree actions' });
  await expect(workingTreeActions.locator('.commit-action-heading')).toHaveText('Commit');
  await expect(workingTreeActions.getByRole('button', { name: 'Stash all changes' })).toContainText('Stash');
  await expect(workingTreeActions.getByRole('button', { name: 'Stash all changes' })).toHaveCSS('font-size', '13px');
  await expect(workingTreeActions.getByRole('button', { name: 'Pop latest stash' })).toContainText('Pop');
  await expect(page.getByRole('group', { name: 'File list layout' }).getByRole('button', { name: 'Path' })).toHaveCSS('font-size', '13px');
  await expect(page.getByRole('button', { name: /Unstaged Files/ })).toHaveCSS('font-size', '13px');
  await expect(page.getByLabel('Push after committing').locator('..')).toHaveCSS('font-size', '13px');

  const workingDirectoryOptions = page.getByRole('button', { name: 'Working directory options' });
  await expect(workingDirectoryOptions.locator('gc-icon svg')).toBeVisible();
  await expect(workingDirectoryOptions).toHaveAttribute('aria-haspopup', 'menu');
  await expect(workingDirectoryOptions).toHaveAttribute('aria-expanded', 'false');
  await workingDirectoryOptions.click();
  const workingTreeMenu = page.getByRole('menu', { name: 'Working directory options' });
  const refreshWorkingTree = workingTreeMenu.getByRole('menuitem', { name: /Refresh working directory/ });
  const openFileManager = workingTreeMenu.getByRole('menuitem', { name: /Open in file manager/ });
  const openTerminal = workingTreeMenu.getByRole('menuitem', { name: /Open terminal/ });
  await expect(workingTreeMenu.getByRole('menuitem', { name: /Stash with options/ })).toBeFocused();
  await expect(openFileManager).toBeVisible();
  await expect(openTerminal).toBeVisible();
  await expect(workingDirectoryOptions).toHaveAttribute('aria-expanded', 'true');
  await expect(workingDirectoryOptions).toHaveClass(/menu-open/);
  await page.keyboard.press('ArrowDown');
  await expect(workingTreeMenu.getByRole('menuitem', { name: /Discard all unstaged/ })).toBeFocused();
  await refreshWorkingTree.focus();
  await page.keyboard.press('ArrowDown');
  await expect(openFileManager).toBeFocused();
  await page.keyboard.press('End');
  await expect(openTerminal).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(workingTreeMenu).toBeHidden();
  await expect(workingDirectoryOptions).toHaveAttribute('aria-expanded', 'false');
  await expect(workingDirectoryOptions).toBeFocused();
});

test('does not present a fully disabled split action as interactive on hover', async ({ page }) => {
  const pull = page.getByRole('button', { name: 'Pull from origin/main' });
  const split = pull.locator('xpath=..');
  const idleBackground = await split.evaluate((element) => getComputedStyle(element).backgroundColor);

  await pull.hover();
  await expect(split).not.toHaveCSS('background-color', idleBackground);

  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    app.git.busy.set(true);
  });
  await expect(pull).toBeDisabled();
  await expect(split.getByRole('button', { name: 'Pull options' })).toBeDisabled();

  await pull.hover({ force: true });
  await expect(split).toHaveCSS('background-color', idleBackground);
});

test('keeps compact repository actions available on touch-first desktops', async ({ browser }) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByRole('button', { name: 'Tags 1' }).tap();
  await page.getByRole('button', { name: 'Stashes 1' }).tap();

  for (const selector of [
    '.worktree-list-actions',
    '.submodule-actions',
    '.remote-visibility',
    '.remote-edit',
    '.branch-overflow-action',
    '.remote-branch-overflow-action',
    '.reference-overflow-action',
    '.visibility-toggle',
    '.commit-row-action',
    '.wip-open-action',
  ]) {
    const control = page.locator(selector).first();
    await expect(control).toBeVisible();
    await expect(control).toHaveCSS('opacity', '1');
    const bounds = await control.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeGreaterThanOrEqual(24);
    expect(bounds!.height).toBeGreaterThanOrEqual(24);
  }
  await expect(page.locator('.wip-open-action').first()).toHaveCSS('pointer-events', 'auto');

  const branchActions = page.getByRole('button', { name: 'Branch actions for feature/partial-staging' });
  await branchActions.tap();
  const branchMenu = page.getByRole('menu', { name: 'Actions for branch feature/partial-staging' });
  await expect(branchMenu).toBeVisible();
  await expect(branchMenu.getByRole('menuitem', { name: 'Checkout branch' })).toBeFocused();
  await expect(branchActions).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(branchMenu).toBeHidden();
  await expect(branchActions).toBeFocused();

  await page.getByRole('separator', { name: 'Resize Branch and Tag column', exact: true }).focus();
  await page.keyboard.press('Home');
  const longReference = page.locator('.commit-row .ref-pill.local')
    .filter({ hasText: 'feature/partial-staging' }).first();
  expect(await longReference.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await longReference.tap();
  await expect(longReference).toBeFocused();
  await expect(longReference).toHaveCSS('position', 'relative');
  expect(await longReference.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await context.close();
});

test('gives every visible icon-only action an explicit accessible name', async ({ page }) => {
  await page.goto('/');

  const unnamedActions = await page.locator('button').evaluateAll((buttons) => buttons
    .filter((button) => button.offsetParent !== null && !(button.textContent ?? '').trim())
    .filter((button) => !(button.getAttribute('aria-label') ?? '').trim())
    .map((button) => ({ className: button.className, title: button.getAttribute('title') })));

  expect(unnamedActions).toEqual([]);
  await expect(page.getByRole('button', { name: 'Worktree actions for main' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Worktree actions for feature/partial-staging' })).toBeVisible();
});

test('keeps working-tree file controls compact and easy to target', async ({ page }) => {
  await page.goto('/');

  const stageControls = page.locator('.stage-box');
  expect(await stageControls.count()).toBeGreaterThan(0);
  const controlGeometry = await stageControls.evaluateAll((controls) => controls.map((control) => {
    const target = control.getBoundingClientRect();
    const visual = getComputedStyle(control, '::before');
    return {
      targetWidth: target.width,
      targetHeight: target.height,
      visualWidth: Number.parseFloat(visual.width),
      visualHeight: Number.parseFloat(visual.height),
    };
  }));
  expect(controlGeometry.every(({ targetWidth, targetHeight }) => targetWidth >= 24 && targetHeight >= 24)).toBe(true);
  expect(controlGeometry.every(({ visualWidth, visualHeight }) => visualWidth === 18 && visualHeight === 18)).toBe(true);
  expect(await page.locator('#unstaged-files-list .file-row:has(.stage-box)').evaluateAll((rows) =>
    rows.every((row) => row.getBoundingClientRect().height === 31),
  )).toBe(true);

  await expect(page.locator('#unstaged-files-list .stage-box gc-icon').first()).toBeVisible();
  await expect(page.locator('.stage-box.checked')).toHaveCount(0);
  const modifiedStatus = page.locator('#unstaged-files-list .file-row', { hasText: 'app.component.html' }).locator('.file-status');
  await expect(modifiedStatus).toHaveAttribute('title', 'Modified, not staged yet');
  await expect(page.getByRole('img', { name: 'New file, not tracked by Git yet' })).toBeVisible();
  await expect(page.locator('#staged-files-list .file-status').first()).toHaveAttribute('title', /staged for the next commit$/);
  const stageFile = page.getByRole('button', { name: 'Stage apps/desktop/src/app/app.component.html' });
  await stageFile.focus();
  await expect(stageFile).toBeFocused();
  await expect(stageFile).toHaveCSS('outline-style', 'solid');

  const openFile = page.getByRole('button', { name: 'View changes in apps/desktop/src/app/app.component.html' });
  const openFileTarget = await openFile.boundingBox();
  expect(openFileTarget?.height).toBeGreaterThanOrEqual(24);
  await openFile.focus();
  await expect(openFile).toBeFocused();
  await expect(openFile).toHaveCSS('outline-style', 'solid');
});

test('keeps the changed-file basename readable at the minimum window width', async ({ page }) => {
  await page.setViewportSize({ width: 780, height: 560 });
  await page.goto('/');

  const path = 'apps/desktop/src/app/app.component.html';
  const file = page.getByRole('button', { name: `View changes in ${path}` });
  const directory = file.locator('.file-path-prefix');
  const basename = file.locator('.file-path-name');

  await expect(file).toBeVisible();
  await expect(file).toHaveAttribute('title', `View changes in ${path}`);
  await expect(basename).toHaveText('app.component.html');
  expect(await basename.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await directory.evaluate((element) => element.clientWidth)).toBeGreaterThan(0);
});

test('keeps change-list bulk actions on one line at the minimum window width', async ({ page }) => {
  await page.setViewportSize({ width: 780, height: 560 });
  await page.goto('/');

  const stageAll = page.getByRole('button', { name: 'Stage all changes' });
  const unstageAll = page.getByRole('button', { name: 'Unstage all' });
  for (const action of [stageAll, unstageAll]) {
    await expect(action).toBeVisible();
    await expect(action).toHaveCSS('white-space', 'nowrap');
    const dimensions = await action.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      headerHeight: element.parentElement?.clientHeight ?? 0,
    }));
    expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.clientHeight);
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
    expect(dimensions.clientHeight).toBeLessThan(dimensions.headerHeight);
  }
});

test('keeps the commit composer available at the minimum desktop height', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 560 });
  await page.goto('/');

  const inspector = page.locator('#repository-commit-panel');
  const files = inspector.locator('.working-tree-scroll');
  const composer = inspector.locator('.commit-composer');
  const commitButton = composer.getByRole('button', { name: /Commit changes to/ });

  await expect(inspector).toHaveClass(/working-tree-inspector/);
  await expect(files).toBeVisible();
  await expect(composer).toBeVisible();
  await expect(commitButton).toBeVisible();
  const [inspectorBox, filesBox, composerBox, commitButtonBox] = await Promise.all([
    inspector.boundingBox(),
    files.boundingBox(),
    composer.boundingBox(),
    commitButton.boundingBox(),
  ]);
  expect(inspectorBox).not.toBeNull();
  expect(filesBox).not.toBeNull();
  expect(composerBox).not.toBeNull();
  expect(commitButtonBox).not.toBeNull();
  expect(filesBox!.height).toBeGreaterThanOrEqual(80);
  expect(composerBox!.y).toBeGreaterThanOrEqual(filesBox!.y + filesBox!.height - 1);
  expect(commitButtonBox!.y + commitButtonBox!.height).toBeLessThanOrEqual(inspectorBox!.y + inspectorBox!.height);
});

test('keeps changed files useful beside the composer at compact desktop height', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 640 });
  await page.goto('/');

  const inspector = page.locator('#repository-commit-panel');
  const files = inspector.locator('.working-tree-scroll');
  const composer = inspector.locator('.commit-composer');
  const commitButton = composer.getByRole('button', { name: /Commit changes to/ });
  const [filesBox, composerBox, commitButtonBox] = await Promise.all([
    files.boundingBox(),
    composer.boundingBox(),
    commitButton.boundingBox(),
  ]);

  expect(filesBox).not.toBeNull();
  expect(composerBox).not.toBeNull();
  expect(commitButtonBox).not.toBeNull();
  expect(filesBox!.height).toBeGreaterThanOrEqual(195);
  expect(composerBox!.height).toBeLessThanOrEqual(283);
  expect(commitButtonBox!.y + commitButtonBox!.height).toBeLessThanOrEqual(composerBox!.y + composerBox!.height);
});

test('keeps the first staged file visible above the composer in a short desktop window', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 720 });
  await page.goto('/');

  const inspector = page.locator('#repository-commit-panel');
  const stagedFile = inspector.getByRole('button', { name: 'View staged changes in apps/desktop/src/app/app.component.ts' });
  const composer = inspector.locator('.commit-composer');

  await expect(stagedFile).toBeInViewport();
  const [stagedFileBox, composerBox] = await Promise.all([
    stagedFile.boundingBox(),
    composer.boundingBox(),
  ]);
  expect(stagedFileBox).not.toBeNull();
  expect(composerBox).not.toBeNull();
  expect(stagedFileBox!.y + stagedFileBox!.height).toBeLessThanOrEqual(composerBox!.y);
});

test('uses spare commit composer height for the description without displacing actions', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  const composer = page.locator('.commit-composer');
  const summary = composer.getByLabel('Commit summary');
  const description = composer.getByLabel('Commit description');
  const commitButton = composer.getByRole('button', { name: /Commit changes to/ });
  const [composerBox, summaryBox, descriptionBox, commitButtonBox, statusBarBox] = await Promise.all([
    composer.boundingBox(),
    summary.boundingBox(),
    description.boundingBox(),
    commitButton.boundingBox(),
    page.locator('.statusbar').boundingBox(),
  ]);

  expect(composerBox).not.toBeNull();
  expect(summaryBox).not.toBeNull();
  expect(descriptionBox).not.toBeNull();
  expect(commitButtonBox).not.toBeNull();
  expect(statusBarBox).not.toBeNull();
  expect(descriptionBox!.height).toBeGreaterThan(summaryBox!.height * 2.5);
  expect(descriptionBox!.y + descriptionBox!.height).toBeLessThan(commitButtonBox!.y);
  expect(commitButtonBox!.y + commitButtonBox!.height).toBeLessThanOrEqual(statusBarBox!.y);
  expect(await composer.evaluate((element) => element.scrollWidth)).toBe(await composer.evaluate((element) => element.clientWidth));
});

test('explains commit readiness and updates it with the draft', async ({ page }) => {
  const composer = page.locator('.commit-composer');
  const readiness = composer.locator('#commit-readiness');
  const summary = composer.getByLabel('Commit summary');
  const commitButton = composer.getByRole('button', { name: /Commit changes to/ });

  await expect(readiness).toHaveText('Write a commit summary to continue.');
  await expect(readiness).toHaveAttribute('aria-live', 'polite');
  await expect(readiness).toHaveAttribute('aria-atomic', 'true');
  await expect(readiness).not.toHaveClass(/ready/);
  await expect(commitButton).toHaveAttribute('aria-describedby', 'commit-readiness');
  await expect(commitButton).toHaveAttribute('title', 'Write a commit summary to continue.');
  await expect(commitButton).toBeDisabled();

  await summary.fill('Explain commit readiness');
  await expect(readiness).toHaveText('Ready to commit 1 staged file.');
  await expect(readiness).toHaveClass(/ready/);
  await expect(commitButton).toHaveAttribute('title', 'Ready to commit 1 staged file.');
  await expect(commitButton).toBeEnabled();

  await composer.getByLabel('Push after committing').check();
  await expect(readiness).toHaveText('Ready to commit 1 staged file and push it.');
  await expect(commitButton).toHaveAttribute('title', 'Ready to commit 1 staged file and push it.');
});

test('keeps manual co-author entry labeled and usable in the commit composer', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 720 });

  const composer = page.locator('.commit-composer');
  await composer.getByRole('button', { name: 'Add co-author' }).click();

  const picker = composer.locator('.coauthor-picker');
  const name = picker.getByLabel('Name', { exact: true });
  const email = picker.getByLabel('Email', { exact: true });
  await expect(name).toBeVisible();
  await expect(email).toBeVisible();
  await expect(email).toHaveAttribute('type', 'email');
  await expect(email).toHaveAttribute('inputmode', 'email');
  await expect(email).toHaveAttribute('spellcheck', 'false');

  await picker.getByText('Name', { exact: true }).click();
  await expect(name).toBeFocused();
  await picker.getByText('Email', { exact: true }).click();
  await expect(email).toBeFocused();

  const fields = await picker.locator('.manual-coauthor-field').evaluateAll((elements) => elements.map((element) => {
    const bounds = element.getBoundingClientRect();
    return { x: Math.round(bounds.x), y: Math.round(bounds.y), right: Math.round(bounds.right) };
  }));
  const pickerBox = await picker.boundingBox();
  expect(fields).toHaveLength(2);
  expect(fields[0].y).toBe(fields[1].y);
  expect(fields[1].x).toBeGreaterThan(fields[0].x);
  expect(pickerBox).not.toBeNull();
  expect(fields.every(({ x, right }) => x >= pickerBox!.x && right <= pickerBox!.x + pickerBox!.width)).toBe(true);
});

test('moves files between change lists before Git responds and offers per-file discard', async ({ page }) => {
  const path = 'apps/desktop/src/app/app.component.html';
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    const state = { calls: [] as string[], pending: [] as Array<(value: unknown) => void>, git };
    (window as any).__instantStageTest = state;
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string) => {
        state.calls.push(command);
        if (command === 'stage_path' || command === 'unstage_path') {
          return new Promise((resolve) => state.pending.push(resolve));
        }
        if (command === 'refresh_repository_status') return Promise.resolve(git.repository().status);
        return Promise.reject(new Error(`Unexpected command: ${command}`));
      },
    };
  });
  const unstaged = page.locator('#unstaged-files-list');
  const staged = page.locator('#staged-files-list');
  const untrackedBefore = await page.evaluate(() => (window as any).__instantStageTest.git.repository().status.untracked);

  await page.getByRole('button', { name: `Stage ${path}` }).click();
  await expect(staged.getByRole('button', { name: `Unstage ${path}` })).toBeVisible();
  await expect(unstaged.getByRole('button', { name: `Stage ${path}` })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__instantStageTest.pending.length)).toBe(1);

  await page.evaluate(() => {
    const state = (window as any).__instantStageTest;
    state.pending.shift()(state.git.repository().status);
  });
  await expect(staged.getByRole('button', { name: `Unstage ${path}` })).toBeVisible();

  await staged.getByRole('button', { name: `Unstage ${path}` }).click();
  await expect(unstaged.getByRole('button', { name: `Stage ${path}` })).toBeVisible();
  await page.evaluate(() => {
    const state = (window as any).__instantStageTest;
    state.pending.shift()(state.git.repository().status);
  });
  expect(await page.evaluate(() => (window as any).__instantStageTest.git.repository().status.untracked)).toBe(untrackedBefore);

  const discard = unstaged.getByRole('button', { name: `Discard changes in ${path}` });
  await expect(discard).toHaveCSS('opacity', '0');
  await discard.locator('xpath=..').hover();
  await expect(discard).toHaveCSS('opacity', '1');
  expect((await discard.boundingBox())?.height).toBeGreaterThanOrEqual(24);
  await discard.click();
  const confirmation = page.getByRole('alertdialog');
  await expect(confirmation).toContainText(path);
  await confirmation.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(discard).toBeFocused();
  expect(await page.evaluate(() => (window as any).__instantStageTest.calls
    .filter((command: string) => command !== 'refresh_repository_status'))).toEqual(['stage_path', 'unstage_path']);
});

test('resizes and remembers staged and unstaged file viewports independently', async ({ page }) => {
  const stagedResizer = page.getByRole('separator', { name: 'Resize Staged Files section' });
  const stagedList = page.locator('#staged-files-list');
  await expect(stagedResizer).toHaveAttribute('aria-valuenow', '165');
  await stagedResizer.focus();
  await stagedResizer.press('ArrowDown');
  await expect(stagedResizer).toHaveAttribute('aria-valuenow', '175');
  await expect(stagedList).toHaveCSS('max-height', '175px');

  const resizer = page.getByRole('separator', { name: 'Resize Unstaged Files section' });
  const list = page.locator('#unstaged-files-list');
  await expect(resizer).toBeVisible();
  await expect(resizer).toHaveAttribute('aria-valuenow', '165');
  await expect(resizer).toHaveAttribute('aria-valuemin', '80');
  await expect(resizer).toHaveAttribute('aria-valuemax', '420');

  await resizer.focus();
  await resizer.press('ArrowDown');
  await expect(resizer).toHaveAttribute('aria-valuenow', '175');
  await expect(list).toHaveCSS('max-height', '175px');
  expect(await page.evaluate(() => localStorage.getItem('git-khronos.working-tree.unstaged-file-list-height'))).toBe('175');

  const resizerBox = await resizer.boundingBox();
  expect(resizerBox).not.toBeNull();
  await page.mouse.move(resizerBox!.x + resizerBox!.width / 2, resizerBox!.y + resizerBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(resizerBox!.x + resizerBox!.width / 2, resizerBox!.y + resizerBox!.height / 2 + 60);
  await page.mouse.up();
  await expect(resizer).toHaveAttribute('aria-valuenow', '235');
  await expect(list).toHaveCSS('max-height', '235px');

  await page.reload();
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.getByRole('separator', { name: 'Resize Staged Files section' })).toHaveAttribute('aria-valuenow', '175');
  const restoredResizer = page.getByRole('separator', { name: 'Resize Unstaged Files section' });
  await expect(restoredResizer).toHaveAttribute('aria-valuenow', '235');
  await restoredResizer.focus();
  await restoredResizer.press('End');
  await expect(restoredResizer).toHaveAttribute('aria-valuenow', '420');
  await expect(list).toHaveCSS('max-height', '420px');
  await restoredResizer.press('Home');
  await expect(restoredResizer).toHaveAttribute('aria-valuenow', '80');
  await expect(list).toHaveCSS('max-height', '80px');
  await restoredResizer.dblclick();
  await expect(restoredResizer).toHaveAttribute('aria-valuenow', '165');
  expect(await page.evaluate(() => localStorage.getItem('git-khronos.working-tree.unstaged-file-list-height'))).toBeNull();
});

test('opens branch creation consistently from the primary toolbar action', async ({ page }) => {
  const createBranch = page.getByRole('button', { name: 'Create branch', exact: true }).first();
  await expect(createBranch).toHaveAttribute('aria-keyshortcuts', 'Control+B Meta+B');
  await expect(createBranch).toHaveAttribute('title', 'Create branch (Ctrl+B)');

  await createBranch.click();
  const branchName = page.getByRole('textbox', { name: 'New branch name' });
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Local 3' })).toHaveAttribute('aria-expanded', 'true');
  await expect(branchName).toBeFocused();
  await expect(branchName).toHaveValue('new-branch');
  const branchForm = page.getByRole('form', { name: 'Create branch' });
  await expect(branchForm).toContainText('From main at HEAD');
  const submitBranch = branchForm.getByRole('button', { name: 'Create', exact: true });
  await expect(submitBranch).toBeEnabled();
  await branchName.fill('');
  await expect(submitBranch).toBeDisabled();
  await branchName.fill('new-branch');

  await page.getByRole('button', { name: 'Cancel branch creation' }).click();
  await expect(branchName).toHaveCount(0);

  await page.keyboard.press('Control+B');
  await expect(branchName).toBeFocused();
  await page.getByRole('button', { name: 'Cancel branch creation' }).click();

  await page.getByTitle('Branch options').click();
  await page.locator('.branch-menu').getByRole('menuitem', { name: /Create branch/ }).click();
  await expect(branchName).toBeFocused();
});

test('navigates primary toolbar split menus with the keyboard', async ({ page }) => {
  const fetch = page.getByRole('button', { name: 'Fetch all remotes', exact: true });
  await expect(fetch).toBeVisible();
  await expect(fetch).toHaveAttribute('title', 'Fetch all remotes');
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    const snapshot = git.repository();
    (window as any).__toolbarFetchCalls = [];
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string, args: Record<string, unknown> = {}) => {
        (window as any).__toolbarFetchCalls.push({ command, args });
        if (command === 'refresh_repository_status') return Promise.resolve(snapshot.status);
        if (command === 'fetch_repository' || command === 'refresh_repository') return Promise.resolve(snapshot);
        return Promise.resolve(null);
      },
    };
  });
  await fetch.click();
  await expect.poll(() => page.evaluate(() => (window as any).__toolbarFetchCalls
    .filter((call: { command: string }) => call.command === 'fetch_repository').length)).toBe(1);
  await expect(fetch).toBeEnabled();

  const fetchToggle = page.getByTitle('Fetch options');
  await expect(fetchToggle).toHaveAttribute('aria-haspopup', 'menu');
  await expect(fetchToggle).not.toHaveAttribute('aria-controls', /./);
  await expect(fetchToggle).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(() => fetchToggle.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(24);
  await fetchToggle.click();
  const fetchMenu = page.getByRole('menu', { name: 'Fetch options' });
  await expect(fetchMenu).toHaveAttribute('id', 'fetch-options-menu');
  await expect(fetchToggle).toHaveAttribute('aria-controls', 'fetch-options-menu');
  await expect(fetchToggle).toHaveAttribute('aria-expanded', 'true');
  const fetchAll = fetchMenu.getByRole('menuitem', { name: /Fetch all remotes/ });
  await expect(fetchMenu.locator('.toolbar-menu-context')).toContainText('Remote references2 remotes');
  await expect(fetchAll).toBeFocused();
  await expect(fetchAll).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('ArrowDown');
  await expect(fetchMenu.getByRole('menuitem', { name: /Fetch branches with options/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(fetchMenu).toHaveCount(0);
  await expect(fetchToggle).toBeFocused();

  const pullToggle = page.getByTitle('Pull options');
  await expect(pullToggle).toHaveAttribute('aria-haspopup', 'menu');
  await expect(pullToggle).not.toHaveAttribute('aria-controls', /./);
  await expect(pullToggle).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(() => pullToggle.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(24);
  await pullToggle.click();
  const pullMenu = page.getByRole('menu', { name: 'Pull options' });
  await expect(pullMenu).toHaveAttribute('id', 'pull-options-menu');
  await expect(pullToggle).toHaveAttribute('aria-controls', 'pull-options-menu');
  await expect(pullToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(pullMenu.locator('.toolbar-menu-context')).toContainText('Pull destinationorigin/mainUp to date');
  await expect(pullMenu.locator('.default-strategy-badge')).toHaveText('Default');
  const defaultPull = pullMenu.getByRole('menuitem', { name: /Fast-forward if possible.*Merge/ });
  await expect(defaultPull.locator('strong')).toHaveCSS('font-size', '13px');
  await expect(defaultPull.locator('small')).toHaveCSS('font-size', '12px');
  await expect(defaultPull).toBeFocused();
  await expect(defaultPull).toHaveCSS('outline-style', 'solid');
  await expect(pullMenu.getByRole('menuitem', { name: /Fetch/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(pullMenu).toHaveCount(0);
  await expect(pullToggle).toBeFocused();

  const pushToggle = page.getByTitle('Push options');
  await expect(pushToggle).toHaveAttribute('aria-haspopup', 'menu');
  await expect(pushToggle).not.toHaveAttribute('aria-controls', /./);
  await expect.poll(() => pushToggle.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(24);
  await pushToggle.click();
  const pushMenu = page.getByRole('menu', { name: 'Push options' });
  await expect(pushMenu).toHaveAttribute('id', 'push-options-menu');
  await expect(pushToggle).toHaveAttribute('aria-controls', 'push-options-menu');
  await expect(pushMenu.locator('.toolbar-menu-context')).toContainText('Push destinationorigin/main1 outgoing');
  await expect(pushMenu.getByRole('menuitem', { name: /^Push/ }).first()).toBeFocused();
  await page.keyboard.press('End');
  await expect(pushMenu.getByRole('menuitem', { name: /Force Push with Lease/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(pushToggle).toBeFocused();

  const branchToggle = page.getByTitle('Branch options');
  await expect(branchToggle).toHaveAttribute('aria-haspopup', 'menu');
  await expect(branchToggle).not.toHaveAttribute('aria-controls', /./);
  await expect.poll(() => branchToggle.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(24);
  await branchToggle.click();
  const branchMenu = page.getByRole('menu', { name: 'Branch options' });
  await expect(branchMenu).toHaveAttribute('id', 'branch-options-menu');
  await expect(branchToggle).toHaveAttribute('aria-controls', 'branch-options-menu');
  await expect(branchMenu.locator('.toolbar-menu-context')).toContainText('Current branchmain1 ahead · 4 changes');
  expect(await branchMenu.locator('.toolbar-menu-context b').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(branchMenu.getByRole('menuitem', { name: /Create branch/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(branchMenu.getByRole('menuitem', { name: /main Current branch/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(branchToggle).toBeFocused();

  const stashToggle = page.getByTitle('Stash options');
  await expect(stashToggle).toHaveAttribute('aria-haspopup', 'menu');
  await expect(stashToggle).not.toHaveAttribute('aria-controls', /./);
  await expect.poll(() => stashToggle.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(24);
  await stashToggle.click();
  const stashMenu = page.getByRole('menu', { name: 'Stash options' });
  await expect(stashMenu).toHaveAttribute('id', 'stash-options-menu');
  await expect(stashToggle).toHaveAttribute('aria-controls', 'stash-options-menu');
  await expect(stashMenu.locator('.toolbar-menu-context')).toContainText('Working directorymain4 changes');
  await expect(stashMenu.getByRole('menuitem', { name: /Stash all changes/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(stashMenu.getByRole('menuitem', { name: /Stash with options/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(stashToggle).toBeFocused();
});

test('keeps expanded aligned references clear of the compact inspector', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 720 });
  await page.goto('/');
  const stack = page.locator('[data-commit-oid="83e6d15fb82672899688b93f59251dfc669888a3"] .commit-ref-stack');
  const references = stack.locator('.grouped-reference-location.remote');
  await stack.hover();
  await expect(references).toHaveCount(2);
  await expect(references.nth(1)).toBeVisible();

  const [triggerBox, surfaceBox, inspectorBox] = await Promise.all([
    stack.locator('.reference-stack-trigger').boundingBox(),
    stack.locator('.reference-stack-popover').boundingBox(),
    page.locator('.detail-panel:not(.panel-hidden)').boundingBox(),
  ]);
  expect(triggerBox).not.toBeNull();
  expect(surfaceBox).not.toBeNull();
  expect(inspectorBox).not.toBeNull();
  expect(Math.abs(surfaceBox!.x - triggerBox!.x)).toBeLessThanOrEqual(1);
  expect(surfaceBox!.width).toBeGreaterThanOrEqual(200);
  expect(surfaceBox!.x + surfaceBox!.width).toBeLessThanOrEqual(inspectorBox!.x - 8);
  expect(await stack.locator('.ref-stack-heading').evaluate((element) =>
    element.scrollWidth <= element.clientWidth,
  )).toBe(true);
});

const referenceHoverCases = ['local', 'remote', 'tag'].flatMap(kind =>
  [72, 180, 300].map(width => ({ kind, width })),
);
for (const { kind, width } of referenceHoverCases) {
  test(`keeps a single ${kind} reference anchored on hover and focus at ${width}px`, async ({ page }) => {
    const stack = page.locator('.commit-row .commit-ref-stack.single-ref').first();
    await stack.evaluate((element, width) => { element.style.width = `${width}px`; }, width);
    for (const label of ['tip', 'torvalds/master', 'a-reference-name-long-enough-to-overflow-the-branch-column']) {
      await page.mouse.move(0, 0);
      await stack.evaluate((element, { kind, label }) => {
        // Retain the real row's Angular-scoped attributes and icon styles.
        const button = element.querySelector('button')!;
        const icon = button.querySelector('gc-icon')!.cloneNode(true);
        button.className = `ref-pill ${kind} with-icon interactive-${kind}-ref`;
        const text = document.createElement('span');
        text.textContent = label;
        button.replaceChildren(icon, text);
      }, { kind, label });
      const reference = stack.locator('.ref-pill');
      const before = await reference.boundingBox();
      expect(before).not.toBeNull();
      const pointer = { x: before!.x + before!.width / 2, y: before!.y + before!.height / 2 };
      await page.mouse.move(pointer.x, pointer.y);
      // Compare against the resting position, not just subsequent hover frames:
      // a one-time jump is as disruptive as the original repeated oscillation.
      const positions = await reference.evaluate(element => new Promise<number[]>(resolve => {
        const samples: number[] = [];
        const sample = () => {
          samples.push(element.getBoundingClientRect().x);
          if (samples.length < 30) requestAnimationFrame(sample);
          else resolve(samples);
        };
        requestAnimationFrame(sample);
      }));
      expect(positions.every(x => Math.abs(x - before!.x) <= 1)).toBe(true);
      expect(await reference.locator('span').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.mouse.move(0, 0);
      await expect(reference).toHaveCSS('position', 'static');
      await reference.focus();
      expect(Math.abs((await reference.boundingBox())!.x - before!.x)).toBeLessThanOrEqual(1);
      await reference.blur();
    }
  });
}

test('reveals a clipped single branch name without shifting the compact graph', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await page.getByRole('separator', { name: 'Resize Branch and Tag column', exact: true }).focus();
  await page.keyboard.press('Home');

  const row = page.locator('[data-commit-oid="7c17b9d37d6a36dc9477e611109136f86477041a"]');
  const reference = row.locator('.ref-pill.local');
  const graphColumn = row.locator('.graph-cell');
  await expect(reference).toContainText('feature/partial-staging');
  expect(await reference.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);

  const graphColumnBefore = await graphColumn.boundingBox();
  await reference.hover();
  expect(await reference.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(reference).toHaveCSS('position', 'relative');

  const [referenceBox, branchColumnBox, graphColumnBox] = await Promise.all([
    reference.boundingBox(),
    row.locator('.branch-column').boundingBox(),
    graphColumn.boundingBox(),
  ]);
  expect(referenceBox).not.toBeNull();
  expect(branchColumnBox).not.toBeNull();
  expect(graphColumnBefore).not.toBeNull();
  expect(graphColumnBox).not.toBeNull();
  expect(referenceBox!.x).toBeGreaterThanOrEqual(branchColumnBox!.x);
  expect(referenceBox!.x + referenceBox!.width).toBeLessThanOrEqual(page.viewportSize()!.width - 20);
  expect(graphColumnBox).toEqual(graphColumnBefore);

  await page.mouse.move(700, 80);
  await page.keyboard.press('Tab');
  await reference.focus();
  expect(await reference.evaluate((element) => element.matches(':focus-visible'))).toBe(true);
  expect(await reference.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test('terminates an unmerged branch lane at its tip commit', async ({ page }) => {
  await page.goto('/?unmerged-branch-preview');
  const row = page.locator('[data-commit-oid="d478a94f7c0e2c7708f26c931a17b7a031895b36"]');
  const nodeOffset = Number(await row.locator('.author-node').getAttribute('data-lane-offset'));
  const paths = await row.locator('.graph-edges path').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('d') ?? ''));

  expect(paths.some((path) => path.startsWith(`M ${nodeOffset} 0`))).toBe(false);
  expect(paths.some((path) => path.startsWith(`M ${nodeOffset} 20`))).toBe(true);
});

test('routes cross-lane links from the side-middle of the author node', async ({ page }) => {
  await page.goto('/?unmerged-branch-preview');
  const row = page.locator('[data-commit-oid="83e6d15fb82672899688b93f59251dfc669888a3"]');
  const node = row.locator('.author-node');
  const graph = row.locator('.graph-cell');
  const nodeOffset = Number(await node.getAttribute('data-lane-offset'));
  const [nodeBox, graphBox] = await Promise.all([node.boundingBox(), graph.boundingBox()]);

  expect(nodeBox).not.toBeNull();
  expect(graphBox).not.toBeNull();
  expect(Math.abs(nodeBox!.x + nodeBox!.width / 2 - (graphBox!.x + nodeOffset))).toBeLessThanOrEqual(0.5);

  const paths = await row.locator('.graph-edges path').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('d') ?? ''));
  expect(paths.some((path) => path.startsWith(`M ${nodeOffset + 12} 20 H `))).toBe(true);
});

test('joins a converging branch at the parent avatar right-middle edge', async ({ page }) => {
  await page.goto('/');
  const branchCommit = page.locator('[data-commit-oid="7c17b9d37d6a36dc9477e611109136f86477041a"]');
  const parentCommit = page.locator('[data-commit-oid="ca5fa80bf46c95b6c8d4296d47f3fd9e1e77d5c2"]');
  const branchOffset = Number(await branchCommit.locator('.author-node').getAttribute('data-lane-offset'));
  const parentNode = parentCommit.locator('.author-node');
  const parentOffset = Number(await parentNode.getAttribute('data-lane-offset'));
  const [nodeBox, graphBox] = await Promise.all([
    parentNode.boundingBox(),
    parentCommit.locator('.graph-cell').boundingBox(),
  ]);

  expect(nodeBox).not.toBeNull();
  expect(graphBox).not.toBeNull();
  expect(Math.abs(nodeBox!.x + nodeBox!.width - (graphBox!.x + parentOffset + 12))).toBeLessThanOrEqual(0.5);

  const connection = await parentCommit.locator('.graph-edges path').evaluateAll((elements, targetX) => {
    for (const element of elements) {
      const path = element as SVGPathElement;
      const length = path.getTotalLength();
      const end = path.getPointAtLength(length);
      if (Math.abs(end.x - targetX) > .01 || Math.abs(end.y - 20) > .01) continue;
      const start = path.getPointAtLength(0), beforeEnd = path.getPointAtLength(length - .1);
      const screen = new DOMPoint(end.x, end.y).matrixTransform(path.getScreenCTM()!);
      return { startX: start.x, startY: start.y, x: screen.x, y: screen.y,
        tangentY: Math.abs(end.y - beforeEnd.y) };
    }
    return null;
  }, parentOffset + 12);
  expect(connection).not.toBeNull();
  expect(connection!.startX).toBe((branchOffset + parentOffset) / 2);
  expect(connection!.startY).toBe(0);
  expect(connection!.tangentY).toBeLessThan(.01);
  expect(Math.abs(connection!.x - (nodeBox!.x + nodeBox!.width))).toBeLessThan(.1);
  expect(Math.abs(connection!.y - (nodeBox!.y + nodeBox!.height / 2))).toBeLessThan(.1);
});

test('starts each worktree lane at its own WIP node', async ({ page }) => {
  const rows = page.locator('.wip-row');
  await expect(rows).toHaveCount(2);
  const currentLabel = rows.nth(0).locator('.wip-worktree-label');
  const linkedLabel = rows.nth(1).locator('.wip-worktree-label');
  await expect(currentLabel).toContainText('main');
  await expect(currentLabel).toHaveAttribute('title', 'Current worktree · Branch main');
  await expect(currentLabel.locator('gc-icon')).toHaveCount(1);
  await expect(linkedLabel).toContainText('feature/partial-staging');
  await expect(linkedLabel).toHaveAttribute('title', 'Linked worktree git-khronos-partial-staging · Branch feature/partial-staging');
  await expect(linkedLabel.locator('gc-icon')).toHaveCount(1);
  await expect(currentLabel).not.toHaveCSS('background-color', await linkedLabel.evaluate((element) => getComputedStyle(element).backgroundColor));

  const firstOffset = Number(await rows.nth(0).locator('.wip-node').getAttribute('data-lane-offset'));
  const secondOffset = Number(await rows.nth(1).locator('.wip-node').getAttribute('data-lane-offset'));
  const firstPaths = await rows.nth(0).locator('.wip-edges path').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('d') ?? ''));
  const secondPaths = await rows.nth(1).locator('.wip-edges path').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('d') ?? ''));

  expect(firstOffset).not.toBe(secondOffset);
  expect(firstPaths).toEqual([`M ${firstOffset} 22 L ${firstOffset} 46`]);
  expect(secondPaths).toEqual([
    `M ${firstOffset} -2 L ${firstOffset} 46`,
    `M ${secondOffset} 22 L ${secondOffset} 46`,
  ]);
});

test('keeps aligned references open while the pointer moves into the expanded list', async ({ page }) => {
  const stack = page.locator('[data-commit-oid="83e6d15fb82672899688b93f59251dfc669888a3"] .commit-ref-stack');
  const references = stack.locator('.grouped-reference-location.remote');
  const compactBox = await stack.boundingBox();
  const compactReferenceBox = await stack.locator('.reference-stack-trigger').boundingBox();
  expect(compactBox).not.toBeNull();
  expect(compactReferenceBox).not.toBeNull();

  await page.mouse.move(
    compactReferenceBox!.x + compactReferenceBox!.width / 2,
    compactReferenceBox!.y + compactReferenceBox!.height / 2,
  );
  await expect(stack).toHaveClass(/pointer-expanded/);
  await expect(references.nth(1)).toBeVisible();
  const [expandedAnchorBox, expandedTriggerBox, expandedSurfaceBox] = await Promise.all([
    stack.boundingBox(),
    stack.locator('.reference-stack-trigger').boundingBox(),
    stack.locator('.reference-stack-popover').boundingBox(),
  ]);
  expect(expandedAnchorBox).toEqual(compactBox);
  expect(expandedTriggerBox).toEqual(compactReferenceBox);
  expect(expandedSurfaceBox).not.toBeNull();
  expect(Math.abs(
    expandedSurfaceBox!.y - (expandedTriggerBox!.y + expandedTriggerBox!.height - 1),
  )).toBeLessThanOrEqual(1);

  await page.mouse.move(
    expandedTriggerBox!.x + expandedTriggerBox!.width / 2,
    expandedTriggerBox!.y + expandedTriggerBox!.height + 1,
  );
  await page.waitForTimeout(220);
  await expect(stack, 'the trigger and expanded list should form one continuous pointer target').toHaveClass(/pointer-expanded/);
  await expect(stack.locator('.reference-stack-popover')).toBeVisible();

  const secondReferenceBox = await references.nth(1).boundingBox();
  expect(secondReferenceBox).not.toBeNull();
  await page.mouse.move(
    secondReferenceBox!.x + secondReferenceBox!.width / 2,
    secondReferenceBox!.y + secondReferenceBox!.height / 2,
    { steps: 12 },
  );
  await page.waitForTimeout(220);
  await expect(stack).toHaveClass(/pointer-expanded/);
  await expect(stack.locator('.ref-stack-heading')).toBeVisible();
  await references.nth(1).click({ button: 'right' });
  await expect(page.locator('.context-menu')).toBeVisible();
});

test('keeps an aligned reference menu expanded while it owns keyboard focus', async ({ page }) => {
  const stack = page.locator('[data-commit-oid="83e6d15fb82672899688b93f59251dfc669888a3"] .commit-ref-stack');
  const trigger = stack.locator('.reference-stack-trigger');

  await trigger.hover();
  await trigger.focus();
  await page.mouse.move(700, 80);
  await page.waitForTimeout(220);
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(stack.locator('.reference-stack-popover')).toBeVisible();

  await trigger.evaluate((element) => element.blur());
  await page.waitForTimeout(220);
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(stack.locator('.reference-stack-popover')).toBeHidden();
});

test('toggles aligned references through an explicit disclosure control', async ({ page }) => {
  const stack = page.locator('[data-commit-oid="83e6d15fb82672899688b93f59251dfc669888a3"] .commit-ref-stack');
  const trigger = stack.locator('.reference-stack-trigger');
  const popover = stack.locator('.reference-stack-popover');
  const chevron = trigger.locator('.reference-stack-chevron');

  await trigger.focus();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(popover).toBeHidden();
  await expect(chevron).toHaveCSS('transform', 'none');

  await trigger.press('Space');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(popover).toBeVisible();
  await expect(chevron).not.toHaveCSS('transform', 'none');

  await trigger.press('Space');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(popover).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.evaluate((element) => element.blur());
  await trigger.hover();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await trigger.focus();
  await trigger.press('Enter');
  await page.mouse.move(700, 80);
  await page.waitForTimeout(220);
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(popover).toBeVisible();

  await trigger.press('Enter');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(popover).toBeHidden();
});

test('opens aligned references upward when the history viewport has no room below', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 360 });
  await page.goto('/');

  const stack = page.locator('[data-commit-oid="83e6d15fb82672899688b93f59251dfc669888a3"] .commit-ref-stack');
  await stack.locator('.reference-stack-trigger').hover();
  await expect(stack).toHaveClass(/opens-upward/);

  const [surfaceBox, historyBox] = await Promise.all([
    stack.locator('.reference-stack-popover').boundingBox(),
    page.locator('.commit-list').boundingBox(),
  ]);
  expect(surfaceBox).not.toBeNull();
  expect(historyBox).not.toBeNull();
  expect(surfaceBox!.y).toBeGreaterThanOrEqual(historyBox!.y);
  expect(surfaceBox!.y + surfaceBox!.height).toBeLessThanOrEqual(historyBox!.y + historyBox!.height + 1);
});

test('navigates aligned references as one keyboard menu', async ({ page }) => {
  const stack = page.locator('[data-commit-oid="83e6d15fb82672899688b93f59251dfc669888a3"] .commit-ref-stack');
  const trigger = stack.locator('.reference-stack-trigger');
  const references = stack.getByRole('menuitem');

  await trigger.focus();
  await trigger.press('ArrowDown');
  await expect(references.first()).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');

  await page.keyboard.press('ArrowDown');
  await expect(references.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(references.first()).toBeFocused();
  await page.keyboard.press('End');
  await expect(references.nth(1)).toBeFocused();
  await page.keyboard.press('Home');
  await expect(references.first()).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(references.first()).toBeHidden();

  await trigger.press('ArrowUp');
  await expect(references.nth(1)).toBeFocused();
  await page.keyboard.press('Tab');
  await page.waitForTimeout(220);
  await expect(references.first()).toBeHidden();
  await expect(trigger).not.toBeFocused();

  await trigger.focus();
  await trigger.press('Shift+F10');
  await expect(references.first()).toBeFocused();
  await expect(page.locator('.context-menu')).toBeHidden();
  await page.keyboard.press('Escape');
  await trigger.click({ button: 'right' });
  await expect(references.first()).toBeFocused();
  await expect(page.locator('.context-menu')).toBeHidden();
});

test('keeps ordinary commit selection reachable beside the compact inspector', async ({ page }) => {
  for (const width of [820, 780]) {
    await page.setViewportSize({ width, height: 720 });
    await page.goto('/');
    const row = page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"]');
    const inspector = page.locator('.detail-panel:not(.panel-hidden)');
    await expect(row).toBeVisible();
    await expect(inspector).toBeVisible();

    const [rowBox, inspectorBox] = await Promise.all([row.boundingBox(), inspector.boundingBox()]);
    expect(rowBox).not.toBeNull();
    expect(inspectorBox).not.toBeNull();
    expect(rowBox!.x + rowBox!.width / 2).toBeLessThan(inspectorBox!.x);

    await row.click();
    await expect(page.locator('.commit-panel')).toContainText('Polish repository activity drawer');
  }
});

for (const width of [700, 360]) {
test(`reopens commit details after compact users dismiss the inspector to browse at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 720 });
  await page.goto('/');

  const inspector = page.locator('.commit-panel');
  await expect(inspector).toBeVisible();
  await page.getByRole('button', { name: 'Close commit panel' }).click();
  await expect(inspector).toBeHidden();

  const row = page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"]');
  await expect(row).toBeVisible();
  const rowBox = await row.boundingBox();
  expect(rowBox).not.toBeNull();
  expect(rowBox!.x).toBeGreaterThanOrEqual(0);
  // Rows may be wider than a compact window; the commit list clips and scrolls them.
  const listBox = await page.locator('.commit-list').boundingBox();
  expect(listBox!.x + listBox!.width).toBeLessThanOrEqual(width);

  await row.click();
  await expect(inspector).toBeVisible();
  await expect(inspector).toContainText('Polish repository activity drawer');
  await expect(page.getByRole('button', { name: 'Close commit panel' })).toBeVisible();
});
}

test('keeps commit descriptions visible when the message column becomes compact', async ({ page }) => {
  await page.setViewportSize({ width: 780, height: 560 });
  await page.goto('/');

  const row = page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"]');
  const message = row.locator('.commit-main');
  const subject = message.locator('.subject');
  const description = message.locator('.commit-description');
  await expect(subject).toHaveText('Polish repository activity drawer');
  await expect(description).toHaveText('Make operation history easier to scan and diagnose.');
  await expect(description).toBeVisible();

  const [rowBox, subjectBox, descriptionBox] = await Promise.all([
    row.boundingBox(),
    subject.boundingBox(),
    description.boundingBox(),
  ]);
  expect(rowBox).not.toBeNull();
  expect(subjectBox).not.toBeNull();
  expect(descriptionBox).not.toBeNull();
  expect(descriptionBox!.y).toBeGreaterThanOrEqual(subjectBox!.y + subjectBox!.height);
  expect(descriptionBox!.y + descriptionBox!.height).toBeLessThanOrEqual(rowBox!.y + rowBox!.height);
  expect(await message.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(message).toHaveAttribute('title', 'Polish repository activity drawer\nMake operation history easier to scan and diagnose.');

  const wipRows = page.locator('.commit-row.wip-row');
  await expect(wipRows).toHaveCount(2);
  for (const wipRow of await wipRows.all()) {
    const headline = wipRow.locator('.wip-message-field, .wip-subject');
    const summary = wipRow.locator('.commit-description');
    await expect(summary).toBeVisible();
    const [wipBox, headlineBox, summaryBox] = await Promise.all([
      wipRow.boundingBox(),
      headline.boundingBox(),
      summary.boundingBox(),
    ]);
    expect(wipBox).not.toBeNull();
    expect(headlineBox).not.toBeNull();
    expect(summaryBox).not.toBeNull();
    expect(summaryBox!.y).toBeGreaterThanOrEqual(headlineBox!.y + headlineBox!.height);
    expect(summaryBox!.y + summaryBox!.height).toBeLessThanOrEqual(wipBox!.y + wipBox!.height);
  }
});

test('preserves readable commit messages with both panels on medium desktops', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.goto('/');

  const row = page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"]');
  await row.click();
  const [sidebarBox, historyBox, inspectorBox] = await Promise.all([
    page.locator('.sidebar:not(.panel-hidden)').boundingBox(),
    page.locator('.history-panel').boundingBox(),
    page.locator('.detail-panel:not(.panel-hidden)').boundingBox(),
  ]);
  expect(sidebarBox).not.toBeNull();
  expect(historyBox).not.toBeNull();
  expect(inspectorBox).not.toBeNull();
  expect(Math.round(sidebarBox!.width)).toBe(205);
  expect(Math.round(inspectorBox!.width)).toBe(310);
  expect(historyBox!.width).toBeGreaterThanOrEqual(580);

  const subject = row.locator('.subject');
  expect(await subject.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  // The right gutter keeps the scroll-marker rail clear of row actions, leaving the description a bit less room.
  expect(await row.locator('.commit-description').evaluate((element) => element.clientWidth)).toBeGreaterThan(48);
  await expect(page.locator('.commit-panel .commit-body')).toHaveCSS('font-size', '13px');
  await expect(page.locator('.commit-panel .author-card > span:last-child')).toHaveCSS('font-size', '13px');
  await expect(page.locator('.commit-panel gc-commit-signature strong')).toHaveCSS('font-size', '13px');
  const signatureDetail = page.locator('.commit-panel gc-commit-signature small');
  await expect(signatureDetail).toHaveCSS('white-space', 'normal');
  expect(await signatureDetail.evaluate((element) => ({
    horizontal: element.scrollWidth <= element.clientWidth + 1,
    vertical: element.scrollHeight <= element.clientHeight + 1,
  }))).toEqual({ horizontal: true, vertical: true });
  await expect(page.locator('.commit-panel .commit-file-path').first()).toHaveCSS('font-size', '13px');
});

test('stacks changed-file controls before the compact inspector crushes search', async ({ page }) => {
  await page.setViewportSize({ width: 780, height: 560 });
  await page.goto('/');
  await page
    .locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"] .commit-main')
    .click();

  const inspector = page.locator('.commit-panel');
  await expect(inspector.locator('.commit-inspector-copy b')).toHaveText('Commit details');
  const toolbar = inspector.locator('.commit-file-view-toolbar');
  const filter = inspector.getByRole('searchbox', { name: 'Filter changed files' });
  await expect(toolbar).toBeVisible();
  await expect(filter).toBeVisible();
  const firstChangedFile = inspector.getByRole('button', { name: 'Open diff for apps/desktop/src/app/app.component.html' });
  await expect(firstChangedFile).toHaveAttribute('title', 'Open diff for apps/desktop/src/app/app.component.html');
  await expect(firstChangedFile.locator('.commit-file-open')).toBeVisible();

  const [toolbarBox, filterBox, layoutBox] = await Promise.all([
    toolbar.boundingBox(),
    filter.locator('..').boundingBox(),
    inspector.getByRole('group', { name: 'Changed files layout' }).boundingBox(),
  ]);
  expect(toolbarBox).not.toBeNull();
  expect(filterBox).not.toBeNull();
  expect(layoutBox).not.toBeNull();
  expect(toolbarBox!.height).toBeGreaterThanOrEqual(60);
  expect(filterBox!.width).toBeGreaterThanOrEqual(240);
  expect(layoutBox!.y).toBeGreaterThanOrEqual(filterBox!.y + filterBox!.height);
  expect(filterBox!.x + filterBox!.width).toBeLessThanOrEqual(toolbarBox!.x + toolbarBox!.width);

  await filter.fill('interface-notes');
  await expect(inspector.locator('.commit-file-path .current-path strong')).toHaveText('interface-notes.md');
});

test('keeps commit context visible while the inspector scrolls and groups author metadata', async ({ page }) => {
  await page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"]').click();
  const inspector = page.locator('.commit-panel');
  const title = inspector.locator('.commit-panel-title');
  const titleBefore = await title.boundingBox();
  expect(titleBefore).not.toBeNull();
  await expect(title.locator('.commit-inspector-copy b')).toHaveText('Commit details');
  await expect(title.locator('.commit-inspector-revision')).toHaveText('f19b263a');
  await expect(title.locator('.commit-inspector-revision')).toHaveAttribute('aria-label', 'Commit f19b263a');
  const contextMark = title.locator('.commit-inspector-mark');
  await expect(contextMark).toBeVisible();
  expect(await contextMark.evaluate((element) => getComputedStyle(element).getPropertyValue('--graph-lane-color').trim())).not.toBe('');
  await expect(page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"]')).toHaveAttribute('aria-controls', 'repository-commit-panel');
  const close = inspector.getByRole('button', { name: 'Close commit panel', exact: true });
  await expect(close).toBeVisible();
  expect(await close.evaluate((button) => {
    const bounds = button.getBoundingClientRect();
    return bounds.width >= 24 && bounds.height >= 24;
  })).toBe(true);

  const sha = inspector.locator('.commit-inspector-revision');
  await expect(sha).toHaveText('f19b263a');
  await expect(sha).toHaveAttribute('title', 'Commit f19b263a8af31408d5f665caf7a5508e108c0fd1');
  const copy = inspector.locator('.commit-sha-copy');
  await expect(copy).toHaveAccessibleName('Copy commit SHA');
  expect(await copy.evaluate((button) => {
    const bounds = button.getBoundingClientRect();
    return bounds.width >= 24 && bounds.height >= 24;
  })).toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: async (value: string) => { (window as any).__copiedCommitOid = value; },
    });
  });
  await copy.click();
  await expect(copy).toHaveAccessibleName('Commit SHA copied');
  await expect(copy).toContainText('Copied');
  expect(await page.evaluate(() => (window as any).__copiedCommitOid)).toBe('f19b263a8af31408d5f665caf7a5508e108c0fd1');
  await expect(inspector.getByRole('status')).toHaveText('Full commit SHA copied to clipboard.');
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: async () => { throw new Error('Clipboard unavailable'); },
    });
  });
  await copy.click();
  await expect(copy).toHaveAccessibleName('Copy failed, retry commit SHA');
  await expect(copy).toContainText('Retry');
  await expect(inspector.getByRole('status')).toHaveText('Could not copy the commit SHA. Try again.');

  const author = inspector.locator('.commit-author-card');
  const overview = inspector.getByRole('region', { name: 'Commit summary' });
  await expect(overview).toContainText('Polish repository activity drawer');
  await expect(overview).toContainText('Make operation history easier to scan and diagnose.');
  await expect(overview.locator('.commit-author-card')).toBeVisible();
  await expect(author.locator('.author-details > strong')).toHaveText('Maya Chen');
  await expect(author.locator('.author-meta small')).toHaveText('maya@example.test');
  await expect(author.locator('time')).toHaveAttribute('datetime', /.+/);
  expect(await inspector.locator('.commit-relations dt').allTextContents()).not.toContain('Authored');
  const parentSubject = inspector.locator('.related-commit-link > span').first();
  await expect(parentSubject.locator('..')).toHaveCSS('display', 'grid');
  await expect(parentSubject).toHaveText('Merge feature/partial-staging');
  await expect(parentSubject).toHaveCSS('white-space', 'normal');
  await expect(parentSubject).toHaveCSS('text-align', 'left');
  expect(await parentSubject.evaluate((element) => getComputedStyle(element).webkitLineClamp)).toBe('2');
  expect(await parentSubject.evaluate((element) => ({
    horizontal: element.scrollWidth <= element.clientWidth + 1,
    vertical: element.scrollHeight <= element.clientHeight + 1,
  }))).toEqual({ horizontal: true, vertical: true });

  await inspector.evaluate((panel) => { panel.scrollTop = panel.scrollHeight; });
  const titleAfter = await title.boundingBox();
  expect(titleAfter).not.toBeNull();
  expect(Math.abs(titleAfter!.y - titleBefore!.y)).toBeLessThanOrEqual(1);
  await expect(inspector.getByRole('navigation', { name: 'Navigate commit history' })).toBeVisible();
  await expect(title.locator('.commit-inspector-copy b')).toHaveText('Commit details');
  await expect(inspector.locator('.commit-overview h2')).toHaveText('Polish repository activity drawer');
  await expect(close).toBeVisible();

  await close.click();
  await expect(inspector).toBeHidden();
  await expect(page.getByRole('button', { name: 'Show Commit Panel', exact: true })).toBeFocused();
});

test('moves the commit inspector into overlay mode before three columns clip', async ({ page }) => {
  await page.setViewportSize({ width: 1051, height: 720 });
  await page.goto('/');
  await page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"]').click();
  let inspector = page.locator('.detail-panel:not(.panel-hidden)');
  await expect(inspector).not.toHaveCSS('position', 'fixed');
  await expect(page.locator('.sidebar:not(.panel-hidden)')).toBeVisible();

  for (const width of [1050, 1024, 960, 900, 861]) {
    await page.setViewportSize({ width, height: 720 });
    await page.goto('/');
    await page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"]').click();
    inspector = page.locator('.detail-panel:not(.panel-hidden)');
    await expect(inspector).toHaveCSS('position', 'fixed');
    await expect(inspector).toHaveCSS('transform', 'none');

    const [historyBox, inspectorBox] = await Promise.all([
      page.locator('.history-panel').boundingBox(),
      inspector.boundingBox(),
    ]);
    expect(historyBox).not.toBeNull();
    expect(inspectorBox).not.toBeNull();
    expect(inspectorBox!.x + inspectorBox!.width).toBeLessThanOrEqual(width);
    expect(historyBox!.x + historyBox!.width).toBeLessThanOrEqual(width);
    if (width <= 1050) {
      await expect(page.locator('.sidebar')).toBeHidden();
      const sidebarLauncher = page.getByRole('button', { name: 'Open left panel' });
      await expect(sidebarLauncher).toBeVisible();
      await expect(sidebarLauncher).toHaveAttribute('title', 'Show repository references (Ctrl+J)');
      await expect(sidebarLauncher.locator('span')).toBeVisible();
      await expect(sidebarLauncher.locator('span')).toHaveText('Refs');
      const [launcherBox, branchHeadingBox] = await Promise.all([
        sidebarLauncher.boundingBox(),
        page.locator('.graph-columns > .leading-branch-column .column-heading-label').boundingBox(),
      ]);
      expect(launcherBox).not.toBeNull();
      expect(branchHeadingBox).not.toBeNull();
      expect(launcherBox!.x).toBeGreaterThanOrEqual(4);
      expect(launcherBox!.width).toBeGreaterThanOrEqual(48);
      expect(launcherBox!.height).toBeGreaterThanOrEqual(24);
      expect(launcherBox!.x + launcherBox!.width).toBeLessThanOrEqual(branchHeadingBox!.x);
      expect(await page.locator('.graph-columns > .leading-branch-column .column-heading-label').evaluate((element) =>
        element.scrollWidth <= element.clientWidth,
      )).toBe(true);
    }

    if (width === 900) {
      const selectedSubject = page.locator(
        '[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"] .subject',
      );
      expect(await selectedSubject.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    }

    const [toolbarActionsBox, toolbarUtilitiesBox] = await Promise.all([
      page.locator('.toolbar-actions').boundingBox(),
      page.locator('.toolbar-utilities').boundingBox(),
    ]);
    const toolbarNavigation = page.locator('.toolbar-navigation');
    const toolbarNavigationBox = await toolbarNavigation.boundingBox();
    expect(toolbarActionsBox).not.toBeNull();
    expect(toolbarUtilitiesBox).not.toBeNull();
    expect(toolbarNavigationBox).not.toBeNull();
    expect(Math.abs(toolbarActionsBox!.x + toolbarActionsBox!.width / 2 - width / 2)).toBeLessThanOrEqual(1);
    expect(toolbarNavigationBox!.x + toolbarNavigationBox!.width).toBeLessThanOrEqual(toolbarActionsBox!.x);
    expect(toolbarActionsBox!.x + toolbarActionsBox!.width).toBeLessThanOrEqual(toolbarUtilitiesBox!.x);
    await expect(toolbarNavigation.getByRole('button', { name: 'Select remote, current origin' })).toBeVisible();
    await expect(toolbarNavigation.getByRole('button', { name: 'Switch branch, current main' })).toBeVisible();
    if (width === 1024) {
      const terminalDivider = page.locator('.toolbar-overflow-control + .action-group-divider');
      const moreActions = page.getByRole('button', { name: 'More repository actions' });
      const terminal = page.locator('.toolbar-terminal-direct');
      await expect(terminalDivider).toBeVisible();
      await expect(terminal).toBeVisible();
      const [moreBox, dividerBox, terminalBox] = await Promise.all([
        moreActions.boundingBox(),
        terminalDivider.boundingBox(),
        terminal.boundingBox(),
      ]);
      expect(moreBox).not.toBeNull();
      expect(dividerBox).not.toBeNull();
      expect(terminalBox).not.toBeNull();
      expect(moreBox!.x + moreBox!.width).toBeLessThan(dividerBox!.x);
      expect(dividerBox!.x + dividerBox!.width).toBeLessThan(terminalBox!.x);
    }
  }

  await page.setViewportSize({ width: 1050, height: 720 });
  await page.goto('/');
  const openSidebar = page.getByRole('button', { name: 'Open left panel' });
  await expect(openSidebar).toBeVisible();
  await openSidebar.click();
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('.sidebar')).toHaveCSS('position', 'fixed');
  await expect(page.getByRole('searchbox', { name: 'Filter references' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect(openSidebar).toBeFocused();
});

test('keeps the smallest toolbar collision-free and expands commit search on demand', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1100, height: 720 });
  const deliberateCompactSearch = page.locator('.graph-search');
  await expect(deliberateCompactSearch.locator('kbd')).toBeHidden();
  await expect(deliberateCompactSearch.locator('input')).toHaveAttribute('placeholder', 'Search commits');
  expect((await deliberateCompactSearch.locator('input').boundingBox())!.width).toBeGreaterThanOrEqual(100);

  await page.setViewportSize({ width: 820, height: 720 });
  const compactNavigation = page.locator('.toolbar-navigation');
  await expect(compactNavigation).toBeVisible();
  const compactRemote = compactNavigation.getByRole('button', { name: 'Select remote, current origin' });
  const compactBranch = compactNavigation.getByRole('button', { name: 'Switch branch, current main' });
  await expect(compactRemote).toBeVisible();
  await expect(compactBranch).toBeVisible();
  await expect(compactRemote.locator('small')).toBeHidden();
  await expect(compactBranch.locator('small')).toBeHidden();
  expect(await compactNavigation.locator('.toolbar-nav-button strong').evaluateAll((labels) =>
    labels.every((label) => label.scrollWidth <= label.clientWidth),
  )).toBe(true);
  await expect(page.getByRole('button', { name: 'Fetch all remotes', exact: true })).toBeVisible();
  await expect(page.locator('.toolbar-actions .tool-button small').filter({ hasText: 'Pull' })).toBeVisible();
  await expect(page.locator('.toolbar-actions .tool-button small').filter({ hasText: 'Terminal' })).toBeHidden();
  await expect(page.locator('.toolbar-secondary-direct').first()).toBeHidden();
  await expect(page.getByRole('button', { name: 'More repository actions' })).toBeVisible();
  const [compactActionsBox, compactUtilitiesBox] = await Promise.all([
    page.locator('.toolbar-actions').boundingBox(),
    page.locator('.toolbar-utilities').boundingBox(),
  ]);
  expect(compactActionsBox).not.toBeNull();
  expect(compactUtilitiesBox).not.toBeNull();
  expect(Math.abs(compactActionsBox!.x + compactActionsBox!.width / 2 - 410)).toBeLessThanOrEqual(1);
  const compactNavigationBox = await compactNavigation.boundingBox();
  expect(compactNavigationBox).not.toBeNull();
  expect(compactNavigationBox!.x + compactNavigationBox!.width).toBeLessThanOrEqual(compactActionsBox!.x);
  expect(compactActionsBox!.x + compactActionsBox!.width).toBeLessThanOrEqual(compactUtilitiesBox!.x);

  await compactRemote.click();
  const compactRemoteMenu = page.getByRole('menu', { name: 'Select remote for pull and push' });
  await expect(compactRemoteMenu).toBeVisible();
  const compactRemoteMenuBox = await compactRemoteMenu.boundingBox();
  expect(compactRemoteMenuBox).not.toBeNull();
  expect(compactRemoteMenuBox!.x).toBeGreaterThanOrEqual(0);
  expect(compactRemoteMenuBox!.x + compactRemoteMenuBox!.width).toBeLessThanOrEqual(820);
  await page.keyboard.press('Escape');
  await expect(compactRemote).toBeFocused();

  await compactBranch.click();
  const compactBranchMenu = page.getByRole('dialog', { name: 'Switch branch' });
  await expect(compactBranchMenu.getByRole('searchbox', { name: 'Filter branches' })).toBeVisible();
  const compactBranchMenuBox = await compactBranchMenu.boundingBox();
  expect(compactBranchMenuBox).not.toBeNull();
  expect(compactBranchMenuBox!.x + compactBranchMenuBox!.width).toBeLessThanOrEqual(820);
  await page.keyboard.press('Escape');
  await expect(compactBranch).toBeFocused();

  for (const width of [860, 760]) {
    await page.setViewportSize({ width, height: 720 });
    await page.goto('/');
    const [navigationBox, actionsBox] = await Promise.all([
      page.locator('.toolbar-navigation').boundingBox(),
      page.locator('.toolbar-actions').boundingBox(),
    ]);
    expect(navigationBox).not.toBeNull();
    expect(actionsBox).not.toBeNull();
    expect(navigationBox!.x + navigationBox!.width).toBeLessThanOrEqual(actionsBox!.x);
    expect(await page.locator('.toolbar-navigation .toolbar-nav-button strong').evaluateAll((labels) =>
      labels.every((label) => label.scrollWidth <= label.clientWidth),
    )).toBe(true);
  }

  await page.setViewportSize({ width: 900, height: 720 });
  const compactSearch = page.locator('.graph-search');
  await expect(compactSearch.locator('kbd')).toBeHidden();
  expect((await compactSearch.locator('input').boundingBox())!.width).toBeGreaterThanOrEqual(110);

  await page.setViewportSize({ width: 700, height: 720 });
  await expect(compactNavigation).toBeVisible();
  await expect(compactRemote).toBeVisible();
  await expect(compactBranch).toBeVisible();
  await expect(compactRemote.locator('small')).toBeHidden();
  await expect(compactBranch.locator(':scope > span')).toBeVisible();
  await expect(compactBranch.locator('small')).toBeHidden();
  await expect(compactBranch.locator('strong')).toHaveText('main');
  expect(await compactBranch.locator('strong').evaluate((label) => label.scrollWidth <= label.clientWidth)).toBe(true);
  const [narrowNavigationBox, narrowActionsBox, narrowUtilitiesBox] = await Promise.all([
    compactNavigation.boundingBox(),
    page.locator('.toolbar-actions').boundingBox(),
    page.locator('.toolbar-utilities').boundingBox(),
  ]);
  expect(narrowNavigationBox).not.toBeNull();
  expect(narrowActionsBox).not.toBeNull();
  expect(narrowUtilitiesBox).not.toBeNull();
  expect(narrowNavigationBox!.x + narrowNavigationBox!.width).toBeLessThanOrEqual(narrowActionsBox!.x);
  expect(narrowActionsBox!.x + narrowActionsBox!.width).toBeLessThanOrEqual(narrowUtilitiesBox!.x);
  expect(Math.abs(narrowActionsBox!.x + narrowActionsBox!.width / 2 - 350)).toBeLessThanOrEqual(1);
  expect((await page.locator('.graph-search').boundingBox())!.width).toBeLessThanOrEqual(30);
  await compactBranch.click();
  await expect(page.getByRole('dialog', { name: 'Switch branch' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(compactBranch).toBeFocused();
  await expect(page.locator('.toolbar-actions .tool-button small').filter({ hasText: 'Pull' })).toBeVisible();
  await expect(page.locator('.toolbar-actions .tool-button small').filter({ hasText: 'Terminal' })).toBeHidden();
  await expect(page.locator('.toolbar-secondary-direct').first()).toBeHidden();
  const moreActions = page.getByRole('button', { name: 'More repository actions' });
  await expect(moreActions).toBeVisible();
  await moreActions.click();
  const compactActionMenu = page.getByRole('menu', { name: 'More repository actions' });
  const compactActionContext = compactActionMenu.locator('.toolbar-menu-context');
  await expect(compactActionContext.locator('small')).toHaveText('git-khronos');
  await expect(compactActionContext.locator('strong')).toHaveText('main');
  await expect(compactActionContext.locator('strong')).toHaveAttribute('title', 'Current branch: main');
  await expect(compactActionContext.locator('b')).toHaveText('origin/main');
  await expect(compactActionContext.locator('b')).toHaveAttribute('title', 'Pull and push: origin/main');
  await expect(compactActionMenu.getByRole('separator', { name: 'Repository tools' })).toBeVisible();
  const [contextCopyBox, contextRemoteBox] = await Promise.all([
    compactActionContext.locator(':scope > span').boundingBox(),
    compactActionContext.locator(':scope > b').boundingBox(),
  ]);
  expect(contextCopyBox).not.toBeNull();
  expect(contextRemoteBox).not.toBeNull();
  expect(contextRemoteBox!.y).toBeGreaterThanOrEqual(contextCopyBox!.y + contextCopyBox!.height);
  let compactActionMenuBox = await compactActionMenu.boundingBox();
  expect(compactActionMenuBox).not.toBeNull();
  expect(compactActionMenuBox!.x).toBeGreaterThanOrEqual(0);
  expect(compactActionMenuBox!.x + compactActionMenuBox!.width).toBeLessThanOrEqual(700);
  await expect(compactActionMenu.getByRole('menuitem', { name: /Fetch all remotes/ })).toBeHidden();
  await expect(compactActionMenu.getByRole('menuitem', { name: /Fetch branches with options/ })).toBeFocused();
  const compactTerminal = compactActionMenu.getByRole('menuitem', { name: /Open repository terminal/ });
  await expect(compactTerminal).toBeVisible();
  await expect(compactTerminal).toHaveAttribute('aria-keyshortcuts', 'Alt+T Control+` Meta+`');
  await expect(compactActionMenu.getByRole('menuitem', { name: /Stash changes/ })).toBeVisible();
  await expect(compactActionMenu.getByRole('menuitem', { name: /Stash with options/ })).toBeVisible();
  await expect(compactActionMenu.getByRole('menuitem', { name: /Pop latest stash/ })).toBeVisible();
  await expect(compactActionMenu.locator('.compact-menu-caption:visible')).toHaveText(['Repository tools', 'Operation history', 'Working directory']);
  await expect(compactActionMenu.getByRole('separator', { name: 'Operation history' })).toBeVisible();
  await expect(compactActionMenu.getByRole('separator', { name: 'Working directory' })).toBeVisible();
  const compactUndo = compactActionMenu.getByRole('menuitem', { name: /^Undo/ });
  await expect(compactUndo).toContainText('Ctrl Z');
  const [compactUndoBox, compactUndoCopyBox, compactUndoShortcutBox] = await Promise.all([
    compactUndo.boundingBox(),
    compactUndo.locator(':scope > span').boundingBox(),
    compactUndo.locator(':scope > kbd').boundingBox(),
  ]);
  expect(compactUndoBox).not.toBeNull();
  expect(compactUndoCopyBox).not.toBeNull();
  expect(compactUndoShortcutBox).not.toBeNull();
  expect(compactUndoBox!.height).toBeLessThan(70);
  expect(compactUndoShortcutBox!.x).toBeGreaterThanOrEqual(compactUndoCopyBox!.x + compactUndoCopyBox!.width);
  expect(compactUndoShortcutBox!.y).toBeGreaterThanOrEqual(compactUndoBox!.y);
  expect(compactUndoShortcutBox!.y + compactUndoShortcutBox!.height).toBeLessThanOrEqual(compactUndoBox!.y + compactUndoBox!.height);
  await expect(compactActionMenu.getByRole('menuitem', { name: /^Redo/ })).toContainText('Ctrl Y');
  await page.setViewportSize({ width: 700, height: 640 });
  const [shortMenuBox, shortStatusBox] = await Promise.all([
    compactActionMenu.boundingBox(),
    page.locator('.statusbar').boundingBox(),
  ]);
  expect(shortMenuBox).not.toBeNull();
  expect(shortStatusBox).not.toBeNull();
  expect(shortMenuBox!.y + shortMenuBox!.height).toBeLessThanOrEqual(shortStatusBox!.y);
  await expect(compactActionMenu).toHaveCSS('scrollbar-width', 'thin');
  expect(await compactActionMenu.evaluate((menu) => menu.scrollHeight > menu.clientHeight)).toBe(true);
  await page.keyboard.press('End');
  const compactLastAction = compactActionMenu.getByRole('menuitem', { name: /Pop latest stash/ });
  await expect(compactLastAction).toBeFocused();
  const [scrolledMenuBox, compactLastActionBox] = await Promise.all([
    compactActionMenu.boundingBox(),
    compactLastAction.boundingBox(),
  ]);
  expect(scrolledMenuBox).not.toBeNull();
  expect(compactLastActionBox).not.toBeNull();
  expect(compactLastActionBox!.y).toBeGreaterThanOrEqual(scrolledMenuBox!.y);
  expect(compactLastActionBox!.y + compactLastActionBox!.height).toBeLessThanOrEqual(scrolledMenuBox!.y + scrolledMenuBox!.height);
  await page.setViewportSize({ width: 700, height: 720 });
  await page.keyboard.press('Escape');
  await expect(compactActionMenu).toBeHidden();
  await expect(moreActions).toBeFocused();

  for (const width of [759, 651]) {
    await page.setViewportSize({ width, height: 720 });
    await page.goto('/');
    const [navigationBox, actionsBox, utilitiesBox] = await Promise.all([
      page.locator('.toolbar-navigation').boundingBox(),
      page.locator('.toolbar-actions').boundingBox(),
      page.locator('.toolbar-utilities').boundingBox(),
    ]);
    expect(navigationBox).not.toBeNull();
    expect(actionsBox).not.toBeNull();
    expect(utilitiesBox).not.toBeNull();
    expect(navigationBox!.x + navigationBox!.width).toBeLessThanOrEqual(actionsBox!.x);
    expect(actionsBox!.x + actionsBox!.width).toBeLessThanOrEqual(utilitiesBox!.x);
    expect(Math.abs(actionsBox!.x + actionsBox!.width / 2 - width / 2)).toBeLessThanOrEqual(1);
    const minimumBranch = page.getByRole('button', { name: 'Switch branch, current main' });
    const minimumRemote = page.getByRole('button', { name: 'Select remote, current origin' });
    await expect(minimumBranch).toBeVisible();
    await expect(minimumRemote).toBeVisible();
    expect(await minimumBranch.locator('strong').evaluate((label) => label.scrollWidth <= label.clientWidth)).toBe(true);
    expect(await minimumRemote.locator('strong').evaluate((label) => label.scrollWidth <= label.clientWidth)).toBe(true);
  }

  for (const width of [650, 550, 500, 420, 360]) {
    await page.setViewportSize({ width, height: 720 });
    await page.goto('/');
    const [actionsBox, utilitiesBox] = await Promise.all([
      page.locator('.toolbar-actions').boundingBox(),
      page.locator('.toolbar-utilities').boundingBox(),
    ]);
    expect(actionsBox).not.toBeNull();
    expect(utilitiesBox).not.toBeNull();
    expect(actionsBox!.x + actionsBox!.width).toBeLessThanOrEqual(utilitiesBox!.x);
    await expect(page.getByRole('button', { name: 'Fetch all remotes', exact: true })).toBeVisible();
    await expect(page.locator('.toolbar-terminal-direct')).toBeHidden();
    await expect(page.locator('.toolbar-utilities .toolbar-panel-button')).toBeVisible();
    const pullLabel = page.locator('.toolbar-actions .tool-button small').filter({ hasText: 'Pull' });
    if (width > 520) await expect(pullLabel).toBeVisible();
    else await expect(pullLabel).toBeHidden();
    if (width <= 550) {
      expect((await page.locator('.graph-search').boundingBox())!.width).toBeLessThanOrEqual(30);
    }
  }

  await moreActions.click();
  compactActionMenuBox = await compactActionMenu.boundingBox();
  expect(compactActionMenuBox).not.toBeNull();
  expect(compactActionMenuBox!.x).toBeGreaterThanOrEqual(9);
  expect(compactActionMenuBox!.x + compactActionMenuBox!.width).toBeLessThanOrEqual(351);
  const currentRemoteOption = compactActionMenu.getByRole('menuitemradio', { name: /origin Current pull and push remote/ });
  const alternateRemoteOption = compactActionMenu.getByRole('menuitemradio', { name: /upstream Use for pull and push/ });
  const compactBranchSwitcher = compactActionMenu.getByRole('menuitem', { name: /Switch branch/ });
  await expect(compactBranchSwitcher).toBeFocused();
  await expect(currentRemoteOption).toBeVisible();
  await expect(currentRemoteOption).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(currentRemoteOption).toBeFocused();
  await expect(alternateRemoteOption).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(alternateRemoteOption).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(compactActionMenu).toBeHidden();
  await moreActions.click();
  await expect(compactActionMenu.getByRole('menuitemradio', { name: /upstream Current pull and push remote/ })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(moreActions).toBeFocused();

  await page.setViewportSize({ width: 500, height: 720 });
  await page.goto('/');
  const sidebar = page.locator('#repository-reference-panel');
  await expect(sidebar).toBeHidden();
  const openSidebar = page.getByRole('button', { name: 'Open left panel' });
  await expect(openSidebar).toBeVisible();
  const [sidebarLauncherBox, graphColumnsBox, firstGraphRowBox] = await Promise.all([
    openSidebar.boundingBox(),
    page.locator('.graph-columns').boundingBox(),
    page.locator('[data-graph-row]').first().boundingBox(),
  ]);
  expect(sidebarLauncherBox).not.toBeNull();
  expect(graphColumnsBox).not.toBeNull();
  expect(firstGraphRowBox).not.toBeNull();
  await expect(openSidebar.locator('span')).toBeHidden();
  expect(sidebarLauncherBox!.width).toBeLessThanOrEqual(30);
  expect(sidebarLauncherBox!.y).toBeGreaterThanOrEqual(graphColumnsBox!.y);
  expect(sidebarLauncherBox!.y + sidebarLauncherBox!.height).toBeLessThanOrEqual(
    graphColumnsBox!.y + graphColumnsBox!.height,
  );
  expect(firstGraphRowBox!.y).toBeGreaterThanOrEqual(sidebarLauncherBox!.y + sidebarLauncherBox!.height);
  expect(await page.locator('.graph-columns > .leading-branch-column').evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).paddingLeft),
  )).toBeGreaterThanOrEqual(sidebarLauncherBox!.width);
  await openSidebar.click();
  await expect(sidebar).toBeVisible();
  await expect(sidebar).toHaveCSS('position', 'fixed');
  await expect.poll(async () => Math.round((await sidebar.boundingBox())?.x ?? -1)).toBe(0);
  const sidebarBox = await sidebar.boundingBox();
  const historyBox = await page.locator('.history-panel').boundingBox();
  expect(sidebarBox).not.toBeNull();
  expect(historyBox).not.toBeNull();
  expect(sidebarBox!.x).toBe(0);
  expect(historyBox!.x).toBe(0);

  const closeSidebar = page.getByRole('button', { name: 'Close left panel' });
  await closeSidebar.click();
  await expect(sidebar).toBeHidden();
  await expect(openSidebar).toBeVisible();
  await expect(openSidebar).toBeFocused();
  await openSidebar.click();
  await expect(sidebar).toBeVisible();
  await expect(closeSidebar).toBeVisible();

  const search = page.getByLabel('Search loaded commits by message, SHA, or author');
  const searchToggle = page.getByRole('button', { name: 'Focus commit search' });
  const advancedSearch = page.getByRole('button', { name: 'Search all repository history' });
  await expect.poll(() => searchToggle.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return Math.min(box.width, box.height);
  })).toBeGreaterThanOrEqual(24);
  await expect(searchToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(search).toBeHidden();
  await expect(advancedSearch).toBeHidden();
  await searchToggle.click();
  await expect(searchToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(search).toBeVisible();
  await expect(advancedSearch).toBeVisible();
  await expect(search).toBeFocused();
  await advancedSearch.click();
  const historyDialog = page.getByRole('dialog', { name: 'Search repository history' });
  await expect(historyDialog.getByLabel('Message contains')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(searchToggle).toBeFocused();
  await expect(searchToggle).toHaveAttribute('aria-expanded', 'false');
  await searchToggle.click();
  await expect(search).toBeFocused();
  await expect(search).toHaveAttribute('placeholder', 'Search commits');
  await expect(search).toHaveAttribute('title', 'Search loaded commits by message, SHA, or author');
  expect((await search.boundingBox())!.height).toBeGreaterThanOrEqual(24);
  await expect.poll(async () => (await page.locator('.graph-search').boundingBox())!.width).toBeGreaterThan(200);
  await search.fill('lane rendering');
  await expect(page.locator('.search-result-count')).toHaveText('1 / 1');
  await page.getByRole('button', { name: 'Clear commit search' }).click();
  await page.keyboard.press('Escape');
  await expect(searchToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(search).toBeHidden();
  await expect(advancedSearch).toBeHidden();
  await expect.poll(async () => (await page.locator('.graph-search').boundingBox())!.width).toBeLessThanOrEqual(30);

  await searchToggle.click();
  await expect(search).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(searchToggle).toBeFocused();
  await expect(searchToggle).toHaveAttribute('aria-expanded', 'false');
});

test('keeps collapsed compact commit search out of keyboard navigation', async ({ page }) => {
  await page.setViewportSize({ width: 500, height: 720 });
  await page.goto('/');

  const search = page.getByLabel('Search loaded commits by message, SHA, or author');
  const searchToggle = page.getByRole('button', { name: 'Focus commit search' });
  const advancedSearch = page.locator('.graph-search-advanced');

  await expect(searchToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(search).toBeHidden();
  await expect(advancedSearch).toBeHidden();

  await searchToggle.click();
  await expect(searchToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(search).toBeVisible();
  await expect(advancedSearch).toBeVisible();
  await expect(search).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(searchToggle).toBeFocused();
  await expect(searchToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(search).toBeHidden();
  await expect(advancedSearch).toBeHidden();
  await page.keyboard.press('Tab');
  expect(await search.evaluate((element) => element === document.activeElement)).toBe(false);
  expect(await advancedSearch.evaluate((element) => element === document.activeElement)).toBe(false);
  expect(await page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (!element || element === document.body) return false;
    const bounds = element.getBoundingClientRect();
    return getComputedStyle(element).visibility !== 'hidden' && bounds.width > 0 && bounds.height > 0;
  })).toBe(true);
});

test('keeps hidden history actions in the compact toolbar overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.goto('/');

  await expect(page.locator('.history-actions')).toBeHidden();
  const moreActions = page.getByRole('button', { name: 'More repository actions' });
  await expect(moreActions).toBeVisible();
  await moreActions.click();

  const menu = page.getByRole('menu', { name: 'More repository actions' });
  const undo = menu.getByRole('menuitem', { name: /^Undo/ });
  const redo = menu.getByRole('menuitem', { name: /^Redo/ });
  await expect(undo).toBeVisible();
  await expect(redo).toBeVisible();
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();
  await expect(undo).toContainText('Ctrl Z');
  await expect(redo).toContainText('Ctrl Y');
  await expect(menu.getByRole('menuitem', { name: /Stash changes/ })).toBeFocused();
  await expect(menu.getByRole('separator', { name: 'Repository tools' })).toBeHidden();
  const bounds = await menu.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(720);
});

test('prioritizes commit subjects when the message column becomes narrow', async ({ page }) => {
  const selectedRow = page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"]');
  await selectedRow.click();
  await expect(selectedRow.locator('.commit-description')).toBeVisible();

  await page.setViewportSize({ width: 780, height: 640 });
  await expect(page.locator('.commit-panel')).toBeVisible();
  await expect(selectedRow.locator('.commit-description')).toBeVisible();
  const [subjectBox, descriptionBox] = await Promise.all([
    selectedRow.locator('.subject').boundingBox(), selectedRow.locator('.commit-description').boundingBox(),
  ]);
  expect(descriptionBox!.y).toBeGreaterThanOrEqual(subjectBox!.y + subjectBox!.height - 1);
  expect(await selectedRow.locator('.subject').evaluate((element) =>
    element.scrollWidth <= element.clientWidth,
  )).toBe(true);
  await expect(selectedRow.locator('.commit-main')).toHaveAttribute(
    'title',
    'Polish repository activity drawer\nMake operation history easier to scan and diagnose.',
  );
});

test('keeps fetch primary before moving secondary repository actions into overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.goto('/');

  await expect(page.locator('.toolbar-primary-fetch')).toBeVisible();
  await expect(page.locator('.toolbar-secondary-direct').first()).toBeHidden();
  const moreActions = page.getByRole('button', { name: 'More repository actions' });
  await expect(moreActions).toBeVisible();
  await moreActions.click();

  const menu = page.getByRole('menu', { name: 'More repository actions' });
  const overflowFetchActions = menu.locator('.toolbar-fetch-overflow');
  await expect(overflowFetchActions).toHaveCount(2);
  await expect(overflowFetchActions.first()).toBeHidden();
  await expect(overflowFetchActions.last()).toBeHidden();
  const stash = menu.getByRole('menuitem', { name: /Stash changes/ });
  const stashOptions = menu.getByRole('menuitem', { name: /Stash with options/ });
  const pop = menu.getByRole('menuitem', { name: /Pop latest stash/ });
  await expect(stash).toBeFocused();
  await expect(pop).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(stashOptions).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(pop).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(stash).toBeFocused();
});

test('keeps Path and Tree modes fully visible in a narrow commit inspector', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 720 });
  await page.goto('/');

  const inspector = page.locator('.detail-panel:not(.panel-hidden)');
  const toolbar = inspector.locator('.working-tree-view-toolbar');
  const path = toolbar.getByRole('button', { name: 'Path', exact: true });
  const tree = toolbar.getByRole('button', { name: 'Tree', exact: true });
  const [inspectorBox, toolbarBox, pathBox, treeBox] = await Promise.all([
    inspector.boundingBox(),
    toolbar.boundingBox(),
    path.boundingBox(),
    tree.boundingBox(),
  ]);
  expect(inspectorBox).not.toBeNull();
  expect(toolbarBox).not.toBeNull();
  expect(pathBox).not.toBeNull();
  expect(treeBox).not.toBeNull();
  expect(toolbarBox!.height).toBeGreaterThanOrEqual(Math.max(pathBox!.height, treeBox!.height));
  expect(pathBox!.x).toBeGreaterThanOrEqual(inspectorBox!.x);
  expect(treeBox!.x + treeBox!.width).toBeLessThanOrEqual(inspectorBox!.x + inspectorBox!.width);

  await tree.click();
  await expect(tree).toHaveAttribute('aria-pressed', 'true');
  await path.click();
  await expect(path).toHaveAttribute('aria-pressed', 'true');
});

test('navigates the virtualized commit history with standard list keys', async ({ page }) => {
  const commits = page.locator('.commit-row[data-commit-oid]');
  const first = commits.first();
  const second = commits.nth(1);
  const last = commits.last();

  await first.focus();
  await expect(first).toHaveCSS('outline-width', '2px');
  await first.press('ArrowDown');
  await expect(second).toBeFocused();
  await expect(second).toHaveAttribute('aria-pressed', 'true');
  expect(await second.evaluate((row) => getComputedStyle(row).boxShadow)).toContain('inset');

  await second.press('Shift+ArrowDown');
  await expect(commits.nth(2)).toBeFocused();
  await expect(page.locator('.commit-row.range-selected')).toHaveCount(2);
  await expect(page.locator('.commit-panel').getByLabel('Selected commit range')).toBeVisible();

  await commits.nth(2).press('ArrowUp');
  await expect(second).toBeFocused();
  await expect(page.locator('.commit-row.range-selected')).toHaveCount(0);

  await second.press('End');
  await expect(last).toBeFocused();
  await expect(last).toHaveClass(/selected/);

  await last.press('Home');
  await expect(first).toBeFocused();
  await expect(first).toHaveAttribute('aria-pressed', 'true');

  await first.press('PageDown');
  await expect(commits.nth(6)).toBeFocused();
  await commits.nth(6).press('PageUp');
  await expect(first).toBeFocused();
});

test('browses adjacent commits from the inspector title bar', async ({ page }) => {
  const refine = page.locator('[data-commit-oid="7c17b9d37d6a36dc9477e611109136f86477041a"]');
  await refine.click();

  const inspector = page.locator('.commit-panel');
  const position = inspector.locator('.inspector-commit-position');
  const newer = inspector.getByRole('button', { name: 'Select newer commit' });
  const older = inspector.getByRole('button', { name: 'Select older commit' });
  const initialPosition = Number.parseInt((await position.textContent()) ?? '', 10);
  await expect(inspector.getByRole('navigation', { name: /Navigate commit history, commit \d+ of \d+/ })).toBeVisible();
  expect(initialPosition).toBeGreaterThan(0);
  await expect(newer).toBeEnabled();
  await expect(older).toBeEnabled();
  await expect(newer).toHaveAttribute('aria-keyshortcuts', 'ArrowUp K');
  await expect(older).toHaveAttribute('aria-keyshortcuts', 'ArrowDown J');

  await older.click();
  await expect(inspector).toContainText('Persist graph column preferences');
  await expect(inspector.locator('.commit-overview h2')).toHaveText('Persist graph column preferences');
  await expect(position).toHaveText(new RegExp(`^${initialPosition + 1}\\s*/\\s*\\d+$`));
  await expect(page.locator('.commit-row.selected')).toContainText('Persist graph column preferences');
  await newer.click();
  await expect(inspector).toContainText('Refine graph lane rendering');
  await expect(inspector.locator('.commit-overview h2')).toHaveText('Refine graph lane rendering');
  await expect(refine).toHaveClass(/selected/);

  const root = page.locator('.commit-row[data-commit-oid]').last();
  await root.click();
  await expect(older).toBeDisabled();

  const sharedTip = page.locator('[data-commit-oid="83e6d15fb82672899688b93f59251dfc669888a3"]');
  await sharedTip.click();
  let detailReferences = inspector.locator('.commit-detail-ref-stack');
  let detailTrigger = detailReferences.locator('.detail-reference-stack-trigger');
  await detailTrigger.focus();
  await page.keyboard.press('Enter');
  await expect(detailTrigger).toHaveAttribute('aria-expanded', 'true');
  await older.click();
  await newer.click();
  detailReferences = inspector.locator('.commit-detail-ref-stack');
  detailTrigger = detailReferences.locator('.detail-reference-stack-trigger');
  await expect(detailTrigger).toHaveAttribute('aria-expanded', 'false');
  await expect(detailReferences.locator('.detail-reference-popover')).toBeHidden();
});

test('opens and navigates commit actions with standard context-menu keys', async ({ page }) => {
  const row = page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"]');
  await row.focus();
  await page.keyboard.press('Shift+F10');

  const menu = page.getByRole('menu', { name: 'Actions for commit Polish repository activity drawer' });
  await expect(menu).toBeVisible();
  expect(await menu.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
  expect((await menu.boundingBox())!.width).toBeGreaterThanOrEqual(270);
  await expect(menu.locator('.context-heading strong')).toHaveAttribute('title', 'Polish repository activity drawer');
  expect(await menu.locator(':scope > button').evaluateAll((actions) => actions.every((action) =>
    action.scrollWidth <= action.clientWidth,
  ))).toBe(true);
  await expect(menu.getByRole('menuitem', { name: 'Checkout this commit' })).toBeFocused();

  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Copy commit SHA' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(menu.getByRole('menuitem', { name: 'Create tag here…' })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(menu.getByRole('menuitem', { name: 'Checkout this commit' })).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(row).toBeFocused();

  const stashRow = page.locator('.commit-row.stash-row');
  await stashRow.focus();
  await page.keyboard.press('ContextMenu');
  const stashMenu = page.getByRole('menu', { name: 'Stash actions' });
  await expect(stashMenu).toBeVisible();
  await expect(stashMenu.getByRole('menuitem', { name: 'Apply Stash' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(stashMenu).toHaveCount(0);
  await expect(stashRow).toBeFocused();
});

test('opens working-tree and historical file actions from the keyboard', async ({ page }) => {
  const workingFile = page.getByTitle('View changes in apps/desktop/src/app/app.component.html');
  await workingFile.focus();
  await page.keyboard.press('Shift+F10');

  let menu = page.locator('.file-context-menu[role="menu"]');
  await expect(menu.getByRole('menuitem', { name: 'View changes' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Preview file content', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Stage file' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(workingFile).toBeFocused();

  const viewport = page.viewportSize()!;
  await workingFile.evaluate((element, point) => element.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    button: 2,
    clientX: point.x,
    clientY: point.y,
  })), { x: viewport.width - 1, y: viewport.height - 1 });
  await expect.poll(async () => {
    const bounds = await menu.boundingBox();
    return bounds ? {
      right: Math.round(bounds.x + bounds.width),
      bottom: Math.round(bounds.y + bounds.height),
    } : null;
  }).toEqual({ right: viewport.width - 8, bottom: viewport.height - 8 });
  await page.keyboard.press('Escape');

  await page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"]').click();
  const historicalFile = page.locator('.commit-panel .commit-file').first();
  await expect(historicalFile).toBeVisible();
  await historicalFile.focus();
  await page.keyboard.press('ContextMenu');

  menu = page.locator('.commit-file-context-menu[role="menu"]');
  await expect(menu.getByRole('menuitem', { name: 'View changes' })).toBeFocused();
  await page.keyboard.press('End');
  const restore = menu.getByRole('menuitem', { name: /Restore file from this commit/ });
  await expect(restore).toBeFocused();
  await restore.press('Enter');
  const confirmation = page.getByRole('alertdialog', { name: /app\.component\.html/ });
  const cancel = confirmation.getByRole('button', { name: 'Cancel' });
  const confirm = confirmation.getByRole('button', { name: /Restore and stage/ });
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(confirm).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirmation).toHaveCount(0);
  await expect(historicalFile).toBeFocused();
});

test('persists an independent icon choice for each remote location', async ({ page }) => {
  await page.getByLabel('Edit remote origin').click();
  let dialog = page.getByRole('dialog', { name: 'Edit Remote' });
  await expect(dialog.getByLabel('Remote location icon').locator('option:checked')).toHaveText('Cloud');
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await page.getByLabel('Edit remote upstream').click();
  dialog = page.getByRole('dialog', { name: 'Edit Remote' });
  const upstreamIcon = dialog.getByLabel('Remote location icon');
  await expect(upstreamIcon.locator('option:checked')).toHaveText('Server');
  await upstreamIcon.selectOption('globe');
  await dialog.getByRole('button', { name: 'Save Remote' }).click();
  await page.reload();
  await page.getByLabel('Edit remote upstream').click();
  dialog = page.getByRole('dialog', { name: 'Edit Remote' });
  await expect(dialog.getByLabel('Remote location icon').locator('option:checked')).toHaveText('Globe');
});

test('keeps the active branch name readable beside multiple remote locations', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 720 });
  await page.getByRole('button', { name: 'Open left panel' }).click();
  const mainBranch = page.getByRole('button', { name: /Local branch main, current/ });
  const mainLabel = mainBranch.locator('> span').nth(1);

  await expect(mainBranch).toBeVisible();
  await expect(mainBranch.locator('xpath=..').locator('.aligned-remote-location')).toHaveCount(2);
  await expect.poll(() => mainLabel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(mainBranch).toHaveAttribute('title', /Tracking origin\/main · ahead 1/);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(mainBranch.locator('.branch-tracking')).toBeVisible();
  await expect(mainBranch.locator('.current-check gc-icon')).toBeVisible();
});

test('collapses individual remote locations and persists their disclosure state', async ({ page }) => {
  let origin = page.getByRole('region', { name: 'Remote origin' });
  await expect(origin.getByRole('button', { name: 'Remote branch origin/docs' })).toBeVisible();

  await origin.getByRole('button', { name: 'Collapse remote origin' }).click();
  await expect(origin.getByRole('button', { name: 'Expand remote origin' })).toHaveAttribute('aria-expanded', 'false');
  await expect(origin.getByRole('button', { name: 'Remote branch origin/docs' })).toHaveCount(0);

  await page.reload();
  origin = page.getByRole('region', { name: 'Remote origin' });
  const expand = origin.getByRole('button', { name: 'Expand remote origin' });
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
  await expand.click();
  await expect(origin.getByRole('button', { name: 'Remote branch origin/docs' })).toBeVisible();
});

test('persists Left Panel disclosures and opens hosted pull requests', async ({ page }) => {
  let toggle = page.getByRole('button', { name: 'Pull Requests', exact: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const hostedLink = page.getByRole('button', { name: 'Open pull requests', exact: true });
  await expect(hostedLink).toBeVisible();
  await expect(hostedLink).toContainText('origin · GitHub');
  await page.evaluate(() => {
    window.open = ((url?: string | URL) => {
      sessionStorage.setItem('opened-external-url', String(url));
      return null;
    }) as typeof window.open;
  });
  await hostedLink.click();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('opened-external-url')))
    .toBe('https://github.com/example/git-khronos/pulls');

  await page.reload();
  toggle = page.getByRole('button', { name: 'Pull Requests', exact: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: 'Open pull requests', exact: true })).toBeVisible();

  await toggle.click();
  await expect(page.getByRole('button', { name: 'Open pull requests', exact: true })).toHaveCount(0);

  let tags = page.getByRole('button', { name: 'Tags 1' });
  await expect(tags).toHaveAttribute('aria-expanded', 'false');
  await tags.click();
  await page.reload();
  tags = page.getByRole('button', { name: 'Tags 1' });
  await expect(tags).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.tag-item').filter({ hasText: 'v0.1.0' })).toBeVisible();
});

test('uses provider-specific hosted review terminology and destinations', async ({ page }) => {
  for (const provider of [
    {
      preview: 'gitlab',
      section: 'Merge Requests',
      action: 'Open merge requests',
      detail: 'origin · GitLab',
      url: 'https://gitlab.com/example/platform/git-khronos/-/merge_requests',
    },
    {
      preview: 'bitbucket',
      section: 'Pull Requests',
      action: 'Open pull requests',
      detail: 'origin · Bitbucket',
      url: 'https://bitbucket.org/example/git-khronos/pull-requests',
    },
  ]) {
    await page.goto(`/?hosting-preview=${provider.preview}`);
    const sectionToggle = page.getByRole('button', { name: provider.section, exact: true });
    if (await sectionToggle.getAttribute('aria-expanded') === 'false') await sectionToggle.click();
    const hostedLink = page.getByRole('button', { name: provider.action, exact: true });
    await expect(hostedLink).toContainText(provider.detail);
    await page.evaluate(() => {
      window.open = ((url?: string | URL) => {
        sessionStorage.setItem('opened-external-url', String(url));
        return null;
      }) as typeof window.open;
    });
    await hostedLink.click();
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('opened-external-url')))
      .toBe(provider.url);
  }
});

test('resizes reference sections with accessible keyboard splitters', async ({ page }) => {
  const section = page.locator('.reference-section.worktree-section');
  const splitter = page.getByRole('separator', { name: 'Resize Worktrees section' });

  await expect(splitter).toHaveAttribute('aria-controls', 'reference-section-worktrees');
  await expect(splitter).toHaveAttribute('aria-orientation', 'horizontal');
  await expect(splitter).toHaveAttribute('aria-valuemin', '70');
  await expect(splitter).toHaveAttribute('aria-valuemax', '420');
  expect((await splitter.boundingBox())!.height).toBeGreaterThanOrEqual(12);
  await splitter.focus();
  expect(await splitter.evaluate((element) => getComputedStyle(element, '::after').height)).toBe('3px');

  await page.keyboard.press('Home');
  await expect(splitter).toHaveAttribute('aria-valuenow', '70');
  await page.keyboard.press('ArrowDown');
  await expect(splitter).toHaveAttribute('aria-valuenow', '80');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(splitter).toHaveAttribute('aria-valuenow', '112');
  await page.keyboard.press('End');
  await expect(splitter).toHaveAttribute('aria-valuenow', '420');
  await expect.poll(() => page.evaluate(() =>
    localStorage.getItem('git-khronos.sidebar.section.worktrees.height'),
  )).toBe('420');
  await expect(section).toHaveClass(/resized/);

  await splitter.dblclick();
  await expect.poll(() => page.evaluate(() =>
    localStorage.getItem('git-khronos.sidebar.section.worktrees.height'),
  )).toBeNull();
  await expect(section).not.toHaveClass(/resized/);
  await expect.poll(() => section.evaluate((element) => (element as HTMLElement).style.height)).toBe('');
});

test('navigates worktree and submodule action menus from the keyboard', async ({ page }) => {
  const worktreeActions = page.locator('.worktree-list-actions').nth(1);
  await expect(worktreeActions).toHaveAttribute('aria-haspopup', 'menu');
  await worktreeActions.focus();
  await expect(worktreeActions).toBeFocused();
  await expect(worktreeActions).toHaveCSS('opacity', '1');
  await worktreeActions.press('Enter');
  let menu = page.locator('.worktree-card-menu.list-menu').filter({ hasText: 'feature/partial-staging' });
  await expect(menu.getByRole('menuitem', { name: 'Open worktree in a new tab' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Copy worktree path' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(worktreeActions).toBeFocused();

  await worktreeActions.click();
  menu = page.locator('.worktree-card-menu.list-menu').filter({ hasText: 'feature/partial-staging' });
  await menu.getByRole('menuitem', { name: 'Remove this worktree', exact: true }).click();
  const removal = page.getByRole('alertdialog', { name: 'feature/partial-staging' });
  const removalCancel = removal.getByRole('button', { name: 'Cancel' });
  const forceRemoval = removal.getByRole('checkbox', { name: /Force removal/ });
  await expect(removalCancel).toBeFocused();
  await forceRemoval.focus();
  await forceRemoval.press('Shift+Tab');
  await expect(removalCancel).toBeFocused();
  await removalCancel.press('Tab');
  await expect(forceRemoval).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(removal).toBeHidden();
  await expect(worktreeActions).toBeFocused();

  await expect(page.getByRole('button', { name: 'Submodules 2' })).toHaveAttribute('aria-expanded', 'true');
  const manageSubmodules = page.getByRole('button', { name: 'Manage submodules' });
  await expect(manageSubmodules).toBeVisible();
  await expect(manageSubmodules).toHaveAttribute(
    'title',
    'Manage submodules · Review state, sync, check out, deinitialize, or remove',
  );

  const submoduleActions = page.locator('.submodule-actions').first();
  await expect(submoduleActions).toHaveAttribute('aria-haspopup', 'menu');
  await submoduleActions.focus();
  await expect(submoduleActions).toBeFocused();
  await expect(submoduleActions).toHaveCSS('opacity', '1');
  await submoduleActions.press('Enter');
  menu = page.locator('.submodule-menu');
  await expect(menu.getByRole('menuitem', { name: 'Open submodule' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(menu.getByRole('menuitem', { name: 'Copy submodule path' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(submoduleActions).toBeFocused();
});

test('navigates pane and remote-group context menus from the keyboard', async ({ page }) => {
  const paneTrigger = page.locator('.sidebar-heading .heading-toggle').first();
  await paneTrigger.click({ button: 'right' });
  let menu = page.getByRole('menu', { name: 'Left Panel panes' });
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Worktrees' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Remote' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(paneTrigger).toBeFocused();

  const remote = page.getByRole('region', { name: 'Remote origin' });
  const remoteTrigger = remote.getByRole('button', { name: 'Collapse remote origin' });
  await remoteTrigger.click({ button: 'right' });
  menu = page.getByRole('menu', { name: 'Remote origin graph actions' });
  await expect(menu.getByRole('menuitem', { name: 'Solo remote' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Hide remote from graph' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(remoteTrigger).toBeFocused();

  const viewport = page.viewportSize()!;
  await remote.locator('.remote-location-heading').evaluate((element, point) => element.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: point.x,
      clientY: point.y,
    }),
  ), { x: viewport.width - 1, y: viewport.height - 1 });
  menu = page.getByRole('menu', { name: 'Remote origin graph actions' });
  await expect.poll(async () => {
    const bounds = await menu.boundingBox();
    return bounds ? {
      right: Math.round(bounds.x + bounds.width),
      bottom: Math.round(bounds.y + bounds.height),
    } : null;
  }).toEqual({ right: viewport.width - 8, bottom: viewport.height - 8 });
});

test('filters every reference type and clears without closing the Left Panel', async ({ page }) => {
  const sidebar = page.locator('.sidebar');
  const filter = sidebar.getByRole('searchbox', { name: 'Filter references' });
  expect((await filter.boundingBox())!.height).toBeGreaterThanOrEqual(24);
  await filter.focus();
  await expect(filter).toBeFocused();
  await filter.fill('v0.1.0');
  await expect(sidebar.getByRole('button', { name: 'Local 0' })).toBeVisible();
  await expect(sidebar.getByRole('button', { name: 'Remote 0' })).toBeVisible();
  const tags = sidebar.getByRole('button', { name: 'Tags 1' });
  await tags.click();
  await expect(page.locator('.tag-item').filter({ hasText: 'v0.1.0' })).toBeVisible();

  const clearFilter = sidebar.getByRole('button', { name: 'Clear reference filter' });
  const clearFilterBox = await clearFilter.boundingBox();
  expect(clearFilterBox).not.toBeNull();
  expect(clearFilterBox!.width).toBeGreaterThanOrEqual(24);
  expect(clearFilterBox!.height).toBeGreaterThanOrEqual(24);
  await clearFilter.click();
  await expect(filter).toHaveValue('');
  await expect(sidebar.getByRole('button', { name: 'Local 3' })).toBeVisible();
  await expect(sidebar.getByRole('button', { name: 'Remote 2' })).toBeVisible();

  await filter.fill('upstream/release');
  const alignedRelease = sidebar.getByRole('button', { name: 'Local branch release', exact: true });
  await expect(alignedRelease).toBeVisible();
  await expect(alignedRelease.locator('xpath=..').getByLabel('Remote branch upstream/release', { exact: true })).toBeVisible();
  await expect(page.locator('#reference-section-remote').getByLabel('Remote branch upstream/release', { exact: true })).toHaveCount(0);

  await filter.fill('upstream/main');
  const filteredLocalRow = sidebar.getByRole('button', { name: /Local branch main, current/ }).locator('xpath=..');
  await expect(filteredLocalRow.getByLabel('Remote branch upstream/main', { exact: true })).toBeVisible();
  await filter.press('Escape');
  await expect(filter).toHaveValue('');
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByRole('button', { name: 'Remote branch origin/main' })).toBeVisible();
});

test('keeps local branch selection and graph visibility as separate controls', async ({ page }) => {
  const row = page.locator('.branch-list-row').filter({ hasText: 'feature/partial-staging' }).first();
  const branch = row.getByRole('button', { name: 'Local branch feature/partial-staging' });
  const actions = row.getByRole('button', { name: 'Branch actions for feature/partial-staging' });
  const visibility = row.getByRole('button', { name: 'Hide feature/partial-staging from graph' });
  const alignedRow = page.locator('.branch-list-row').filter({ has: page.getByRole('button', { name: /Local branch main, current/ }) });
  const remoteLocations = alignedRow.locator('.aligned-branch-locations');
  const alignedName = alignedRow.locator('.branch-item > span').nth(1);
  const alignedActions = alignedRow.getByRole('button', { name: 'Branch actions for main' });
  const alignedVisibility = alignedRow.getByRole('button', { name: 'Hide main from graph' });

  await expect(branch.locator('button')).toHaveCount(0);
  await expect(remoteLocations).toBeVisible();
  expect(await alignedName.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  const [remoteLocationBounds, alignedActionBounds, alignedVisibilityBounds] = await Promise.all([
    remoteLocations.boundingBox(),
    alignedActions.boundingBox(),
    alignedVisibility.boundingBox(),
  ]);
  expect(remoteLocationBounds).not.toBeNull();
  expect(alignedActionBounds).not.toBeNull();
  expect(alignedVisibilityBounds).not.toBeNull();
  expect(alignedActionBounds!.x + alignedActionBounds!.width).toBeLessThanOrEqual(remoteLocationBounds!.x);
  expect(alignedVisibilityBounds!.x + alignedVisibilityBounds!.width).toBeLessThanOrEqual(remoteLocationBounds!.x);
  await expect(remoteLocations).toHaveCSS('opacity', '1');
  await expect(alignedActions).toHaveCSS('opacity', '0');
  await expect(alignedActions).toHaveCSS('pointer-events', 'none');
  await expect(alignedVisibility).toHaveCSS('opacity', '0');
  await alignedActions.focus();
  await expect(remoteLocations).toHaveCSS('opacity', '1');
  await expect(alignedActions).toHaveCSS('opacity', '1');
  await expect(alignedVisibility).toHaveCSS('opacity', '1');
  await expect(actions).toHaveCSS('opacity', '0');
  await actions.focus();
  await expect(actions).toHaveCSS('opacity', '1');
  await actions.press('Enter');
  const menu = page.getByRole('menu', { name: 'Actions for branch feature/partial-staging' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Checkout branch' })).toBeFocused();
  await expect(actions).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(actions).toBeFocused();
  await expect(actions).toHaveAttribute('aria-expanded', 'false');
  await expect(visibility).toHaveCSS('opacity', '1');
  await visibility.focus();
  await expect(visibility).toBeFocused();
  await expect(visibility).toHaveCSS('opacity', '1');

  await visibility.press('Enter');
  await expect(branch).toHaveClass(/reference-hidden/);
  await expect(row.getByRole('button', { name: 'Show feature/partial-staging in graph' })).toBeFocused();
  await expect(page.locator('.wip-row.selected').first()).toBeVisible();
  await expect(branch).not.toHaveClass(/tip-selected/);
});

test('keeps aligned branch locations on one line at compact desktop widths', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.goto('/');

  const row = page.locator('.branch-list-row').filter({ has: page.getByRole('button', { name: /Local branch main, current/ }) });
  const branch = row.getByRole('button', { name: /Local branch main, current/ });
  const name = branch.locator(':scope > span').nth(1);
  const locations = row.locator('.aligned-branch-locations');
  const [branchBounds, locationBounds, rowBounds] = await Promise.all([
    branch.boundingBox(), locations.boundingBox(), row.boundingBox(),
  ]);

  expect(branchBounds).not.toBeNull();
  expect(locationBounds).not.toBeNull();
  expect(rowBounds).not.toBeNull();
  expect(Math.abs(
    branchBounds!.y + branchBounds!.height / 2 - (locationBounds!.y + locationBounds!.height / 2),
  )).toBeLessThanOrEqual(1);
  expect(rowBounds!.height).toBeLessThanOrEqual(32);
  expect(await name.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

  const releaseName = page.getByRole('button', { name: 'Local branch release' }).locator(':scope > span').nth(1);
  expect(await releaseName.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test('exposes remote branch actions without a context-menu gesture', async ({ page }) => {
  const row = page.locator('.remote-branch-row').filter({ has: page.getByRole('button', { name: 'Remote branch origin/docs' }) });
  const branch = row.getByRole('button', { name: 'Remote branch origin/docs' });
  const actions = row.getByRole('button', { name: 'Remote branch actions for origin/docs' });
  const remoteLocations = row.locator('.aligned-remote-only-locations');

  await expect(branch.locator('button')).toHaveCount(0);
  await expect(remoteLocations).toBeVisible();
  await expect(remoteLocations).toHaveCSS('opacity', '1');
  await expect(actions).toHaveCSS('opacity', '0');
  await actions.focus();
  await expect(remoteLocations).toHaveCSS('opacity', '0');
  await expect(actions).toBeFocused();
  await expect(actions).toHaveCSS('opacity', '1');
  await actions.press('Enter');

  const menu = page.getByRole('menu', { name: 'Actions for remote branch origin/docs' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Create local tracking branch' })).toBeFocused();
  await expect(actions).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(actions).toBeFocused();
  await expect(actions).toHaveAttribute('aria-expanded', 'false');
});

test('groups local branch actions into scannable workflow sections', async ({ page }) => {
  await page.getByRole('button', { name: 'Local branch feature/partial-staging' }).click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Actions for branch feature/partial-staging' });
  await expect(menu.locator('.context-section-label')).toHaveText([
    'Switch and inspect',
    'Tracking and worktrees',
    'Graph visibility',
    'History and integration',
    'Integrate into main',
    'Manage branch',
    'Create reference at branch tip',
  ]);
  await expect(menu.getByRole('menuitem', { name: 'Checkout branch' })).toBeFocused();
  await expect(menu).toHaveCSS('width', '312px');
  expect(await menu.getByRole('menuitem').evaluateAll((items) => items.every((item) =>
    item.getBoundingClientRect().width <= item.parentElement!.getBoundingClientRect().width,
  ))).toBe(true);
});

test('exposes tag and stash actions through direct controls', async ({ page }) => {
  await page.getByRole('button', { name: 'Tags 1' }).click();
  const tagRow = page.locator('.tag-list-row').filter({ has: page.getByRole('button', { name: 'Tag v0.1.0' }) });
  const tag = tagRow.getByRole('button', { name: 'Tag v0.1.0' });
  const tagActions = tagRow.getByRole('button', { name: 'Tag actions for v0.1.0' });
  await expect(tag.locator('button')).toHaveCount(0);
  await expect(tagActions).toHaveCSS('opacity', '0');
  await tagActions.focus();
  await expect(tagActions).toHaveCSS('opacity', '1');
  await tagActions.press('Enter');
  const tagMenu = page.getByRole('menu', { name: 'Actions for tag v0.1.0' });
  await expect(tagMenu.getByRole('menuitem', { name: 'View tagged commit' })).toBeFocused();
  await expect(tagActions).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(tagMenu).toBeHidden();
  await expect(tagActions).toBeFocused();
  await expect(tagActions).toHaveAttribute('aria-expanded', 'false');

  await page.getByRole('button', { name: 'Stashes 1' }).click();
  const stashRow = page.locator('.stash-list-row').first();
  const stash = stashRow.getByRole('button', { name: 'Stash stash@{0}, WIP on graph polish' });
  const stashActions = stashRow.getByRole('button', { name: 'Stash actions for stash@{0}' });
  await expect(stash.locator('button')).toHaveCount(0);
  await expect(stashActions).toHaveCSS('opacity', '0');
  await stashActions.focus();
  await expect(stashActions).toHaveCSS('opacity', '1');
  await stashActions.press('Enter');
  const stashMenu = page.getByRole('menu', { name: 'Stash actions' });
  await expect(stashMenu.getByRole('menuitem', { name: 'Apply Stash' })).toBeFocused();
  await expect(stashActions).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(stashMenu).toBeHidden();
  await expect(stashActions).toBeFocused();
  await expect(stashActions).toHaveAttribute('aria-expanded', 'false');
});

test('uses one roving Tab stop across WIP and commit graph rows', async ({ page }) => {
  const currentWip = page.locator('.wip-row').first();
  const linkedWip = page.locator('.wip-row').nth(1);

  await expect(currentWip).toHaveAttribute('aria-label', 'Working directory, branch main, 4 changed files');
  await expect(currentWip).toHaveAttribute('aria-controls', 'repository-commit-panel');
  await expect(currentWip).toHaveAttribute('aria-pressed', 'true');
  await expect(linkedWip).toHaveAttribute('aria-label', 'Linked worktree git-khronos-partial-staging, branch feature/partial-staging, 2 changed files');
  await expect(linkedWip).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-graph-row][tabindex="0"]')).toHaveCount(1);
  await expect(currentWip).toHaveAttribute('tabindex', '0');
  await currentWip.focus();
  await currentWip.press('ArrowDown');
  await expect(linkedWip).toBeFocused();
  await expect(linkedWip).toHaveAttribute('tabindex', '0');
  await expect(linkedWip).toHaveAttribute('aria-pressed', 'true');
  await expect(currentWip).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-graph-row][tabindex="0"]')).toHaveCount(1);

  await linkedWip.press('End');
  const lastCommit = page.locator('.commit-row[data-commit-oid]').last();
  await expect(lastCommit).toBeFocused();
  await expect(lastCommit).toHaveAttribute('tabindex', '0');
  await expect(page.locator('[data-graph-row][tabindex="0"]')).toHaveCount(1);

  await lastCommit.press('Home');
  const firstCommit = page.locator('.commit-row[data-commit-oid]').first();
  await expect(firstCommit).toBeFocused();
  await firstCommit.press('ArrowUp');
  await expect(linkedWip).toBeFocused();
  await expect(linkedWip).toHaveAttribute('tabindex', '0');
  await expect(page.locator('[data-graph-row][tabindex="0"]')).toHaveCount(1);
});

test('shows effective signing configuration and applies its commit default', async ({ page }) => {
  await page.goto('/?signing-preview');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await expect(page.getByLabel('Sign this commit')).toBeChecked();

  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  const preferences = page.getByRole('dialog', { name: 'Preferences' });
  await preferences.getByRole('tab', { name: /Git Features/ }).click();
  const signing = preferences.locator('.signing-preferences');
  await expect(signing).toBeVisible();
  await expect(signing.locator('.signing-state strong')).toHaveCSS('font-size', '13px');
  const checkSigner = signing.getByRole('button', { name: 'Check Signer' });
  const signingHelp = signing.getByRole('button', { name: 'Learn about signing and verification…' });
  await expect(checkSigner).toHaveCSS('font-size', '13px');
  await expect(signingHelp).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(signingHelp).toHaveCSS('color', 'rgb(84, 214, 173)');
  await expect(signingHelp).toHaveCSS('justify-content', 'flex-start');
  expect(await checkSigner.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  await expect(signing).toContainText('Automatic signing enabled');
  await expect(signing).toContainText('SSH');
  await expect(signing).toContainText('~/.ssh/id_ed25519.pub');
  await checkSigner.click();
  await expect(signing.locator('.signing-diagnostic')).toContainText('Signer available');
  await expect(signing.locator('.signing-diagnostic')).toContainText('ssh-keygen');
  await expect(signing.locator('.signing-diagnostic strong')).toHaveCSS('font-size', '13px');
  await expect(signing.locator('.signing-diagnostic small')).toHaveCSS('font-size', '12px');
  await expect(signing.locator('.signing-diagnostic code')).toHaveCSS('font-size', '12px');

  await preferences.getByRole('button', { name: 'Close preferences' }).click();
  await page.getByLabel('Sign this commit').uncheck();
  await expect(page.getByLabel('Sign this commit')).not.toBeChecked();
});

test('reports a missing configured commit signer before commit time', async ({ page }) => {
  await page.goto('/?signing-preview&signer-missing');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  const preferences = page.getByRole('dialog', { name: 'Preferences' });
  await preferences.getByRole('tab', { name: /Git Features/ }).click();
  const signing = preferences.locator('.signing-preferences');
  await signing.getByRole('button', { name: 'Check Signer' }).click();

  await expect(signing.locator('.signing-diagnostic')).toContainText('Signer unavailable');
  await expect(signing.locator('.signing-diagnostic')).toContainText('not found');
});

test('keeps every preference category discoverable in compact windows', async ({ page }) => {
  for (const width of [700, 520, 360]) {
    await page.setViewportSize({ width, height: 720 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Preferences', exact: true }).click();
    const preferences = page.getByRole('dialog', { name: 'Preferences' });
    const navigation = preferences.getByRole('tablist', { name: 'Preference categories' });
    const tabs = navigation.getByRole('tab');
    await expect(tabs).toHaveCount(5);
    await expect(tabs.first().locator('small')).toBeHidden();

    const navigationBox = await navigation.boundingBox();
    expect(navigationBox).not.toBeNull();
    for (let index = 0; index < 5; index += 1) {
      const tab = tabs.nth(index);
      await expect(tab).toBeVisible();
      const tabBox = await tab.boundingBox();
      expect(tabBox).not.toBeNull();
      expect(tabBox!.x).toBeGreaterThanOrEqual(navigationBox!.x);
      expect(tabBox!.x + tabBox!.width).toBeLessThanOrEqual(navigationBox!.x + navigationBox!.width);
    }

    await preferences.getByRole('tab', { name: /Terminal/ }).click();
    await expect(preferences.getByLabel('Terminal font', { exact: true })).toBeVisible();
    const zoomBox = await page.getByLabel('Interface zoom controls').boundingBox();
    expect(zoomBox).not.toBeNull();
    expect(await page.evaluate(({ x, y }) =>
      !!document.elementFromPoint(x, y)?.closest('.zoom-control'), {
      x: zoomBox!.x + zoomBox!.width / 2,
      y: zoomBox!.y + zoomBox!.height / 2,
    })).toBe(false);
    await preferences.getByRole('button', { name: 'Close preferences' }).click();
  }
});

test('finds settings without requiring category knowledge', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  const preferences = page.getByRole('dialog', { name: 'Preferences' });
  const search = preferences.getByRole('searchbox', { name: 'Find a setting' });

  await search.fill('fetch');
  await expect(preferences.getByText('1 match', { exact: true })).toBeVisible();
  await preferences.getByRole('button', { name: /Automatic remote fetch/ }).click();
  const fetchInterval = preferences.getByLabel('Automatic fetch interval');
  await expect(fetchInterval).toBeVisible();
  await expect(fetchInterval).toBeFocused();
  await expect(search).toHaveValue('');
  await expect(preferences.getByRole('tablist', { name: 'Preference categories' })).toBeVisible();

  await search.fill('restore defaults');
  await preferences.getByRole('button', { name: /Restore interface defaults/ }).click();
  await expect(preferences.getByRole('button', { name: 'Restore Defaults', exact: true })).toBeFocused();

  await search.fill('something impossible');
  await expect(preferences.getByText('No matching settings', { exact: true })).toBeVisible();
  await expect(preferences.getByText(/Try “theme”, “fetch”, “diff”, or “terminal”/)).toBeVisible();

  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(preferences.getByRole('tablist', { name: 'Preference categories' })).toBeVisible();
});

test('keeps preference descriptions readable in a desktop dialog', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  const navigation = page.getByRole('dialog', { name: 'Preferences' })
    .getByRole('tablist', { name: 'Preference categories' });

  await expect(navigation.getByText('Appearance and layout', { exact: true })).toBeVisible();
  await expect(navigation.getByText('Sync, sparse checkout, LFS', { exact: true })).toBeVisible();
  expect(await navigation.locator('small').evaluateAll(elements => elements.every(element =>
    element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight,
  ))).toBe(true);
});

test('groups panel visibility with the panel it controls', async ({ page }) => {
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  const preferences = page.getByRole('dialog', { name: 'Preferences' });
  const leftPanelGroup = preferences.locator('.preference-group').filter({
    has: page.getByText('Left Panel', { exact: true }),
  });
  const commitPanelGroup = preferences.locator('.preference-group').filter({
    has: page.getByText('Commit Panel', { exact: true }),
  });

  await expect(leftPanelGroup.getByText('Show Left Panel', { exact: true })).toBeVisible();
  await expect(leftPanelGroup.getByText('Show Commit Panel', { exact: true })).toHaveCount(0);
  await expect(commitPanelGroup.getByText('Show Commit Panel', { exact: true })).toBeVisible();
  await expect(commitPanelGroup.getByLabel('Commit Panel file layout')).toBeVisible();
  await expect(commitPanelGroup.locator('label').filter({ hasText: 'Show Commit Panel' })).toHaveCSS('justify-content', 'normal');
  await expect(commitPanelGroup.locator('.commit-panel-layout')).toHaveCSS('justify-content', 'space-between');
});

test('keeps preference hierarchy legible in every application theme', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  for (const theme of ['chronos', 'midnight']) {
    await page.evaluate((value) => localStorage.setItem('git-khronos.ui.theme', value), theme);
    await page.reload();
    await page.getByRole('button', { name: 'Preferences', exact: true }).click();
    const preferences = page.getByRole('dialog', { name: 'Preferences' });
    await expect(preferences).toBeVisible();

    for (const selector of ['.preferences-navigation button.active small', '.preference-group > span']) {
      const ratio = await preferences.locator(selector).first().evaluate((element) => {
        const channels = (value: string) => {
          const parsed = (value.match(/[\d.]+/g) ?? []).map(Number);
          return value.startsWith('color(srgb')
            ? [(parsed[0] ?? 0) * 255, (parsed[1] ?? 0) * 255, (parsed[2] ?? 0) * 255, parsed[3] ?? 1]
            : [parsed[0] ?? 0, parsed[1] ?? 0, parsed[2] ?? 0, parsed[3] ?? 1];
        };
        const luminance = ([red, green, blue]: number[]) => {
          const linear = [red, green, blue].map((channel) => {
            const normalized = channel / 255;
            return normalized <= .04045 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4;
          });
          return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
        };
        const foreground = channels(getComputedStyle(element).color);
        let ancestor: Element | null = element;
        let background = [0, 0, 0, 0];
        while (ancestor && (background[3] ?? 0) === 0) {
          background = channels(getComputedStyle(ancestor).backgroundColor);
          ancestor = ancestor.parentElement;
        }
        const foregroundLuminance = luminance(foreground);
        const backgroundLuminance = luminance(background);
        return (Math.max(foregroundLuminance, backgroundLuminance) + .05)
          / (Math.min(foregroundLuminance, backgroundLuminance) + .05);
      });
      expect(ratio, `${selector} should meet WCAG AA contrast in ${theme}`).toBeGreaterThanOrEqual(4.5);
    }
    await preferences.getByRole('button', { name: 'Close preferences' }).click();
  }
});

test('navigates preference categories as a standard tab list', async ({ page }) => {
  const opener = page.getByRole('button', { name: 'Preferences', exact: true });
  await opener.focus();
  await opener.click();
  const preferences = page.getByRole('dialog', { name: 'Preferences' });
  const navigation = preferences.getByRole('tablist', { name: 'Preference categories' });
  const general = navigation.getByRole('tab', { name: /General/ });
  const graph = navigation.getByRole('tab', { name: /Commit Graph/ });
  const terminal = navigation.getByRole('tab', { name: /Terminal/ });
  const close = preferences.getByRole('button', { name: 'Close preferences' });
  const search = preferences.getByRole('searchbox', { name: 'Find a setting' });

  await expect(preferences.locator('header strong')).toHaveCSS('font-size', '13px');
  await expect(preferences.locator('header small')).toHaveCSS('font-size', '12px');
  await expect(general.locator('strong')).toHaveCSS('font-size', '13px');
  await expect(general.locator('small')).toHaveCSS('font-size', '12px');
  await expect(preferences.getByRole('radio', { name: /Chronos Dark/ }).locator('strong')).toHaveCSS('font-size', '13px');
  await expect(preferences.locator('.preference-group label').filter({ hasText: 'Show toolbar icon labels' })).toHaveCSS('font-size', '13px');
  await expect(preferences.getByLabel('Commit Panel file layout')).toHaveCSS('font-size', '13px');
  await expect(close).toHaveCSS('border-top-style', 'solid');
  expect(await close.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  expect(await close.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return Math.min(box.width, box.height);
  })).toBeGreaterThanOrEqual(24);

  await expect(close).toBeFocused();
  await close.press('Shift+Tab');
  await expect(preferences.getByRole('button', { name: 'Restore Defaults' })).toBeFocused();
  await preferences.getByRole('button', { name: 'Restore Defaults' }).press('Tab');
  await expect(close).toBeFocused();
  await close.press('Tab');
  await expect(search).toBeFocused();
  await search.press('Tab');
  await expect(general).toBeFocused();

  await general.focus();
  await general.press('ArrowDown');
  await expect(graph).toBeFocused();
  await expect(graph).toHaveAttribute('aria-selected', 'true');
  await expect(preferences.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'preferences-tab-graph');

  await graph.press('End');
  await expect(terminal).toBeFocused();
  await expect(terminal).toHaveAttribute('aria-selected', 'true');
  await expect(preferences.getByLabel('Terminal font', { exact: true })).toBeVisible();

  await terminal.press('Home');
  await expect(general).toBeFocused();
  await expect(general).toHaveAttribute('tabindex', '0');
  await expect(terminal).toHaveAttribute('tabindex', '-1');

  await page.keyboard.press('Escape');
  await expect(preferences).toBeHidden();
  await expect(opener).toBeFocused();
});

test('navigates and persists application themes as a standard radio group', async ({ page }) => {
  const chrome = page.locator('.chrome');
  const activeRepositoryTab = page.locator('.repo-tab.active');
  const toolbar = page.locator('.toolbar');
  const graphSearch = page.locator('.graph-search');
  const graphHeader = page.locator('.graph-columns');
  const statusbar = page.locator('.statusbar');
  const zoomControl = page.locator('.zoom-control');
  const commitDescription = page.locator('.commit-description').first();
  const sidebarHeading = page.locator('.sidebar-heading').first();
  const currentWorktree = page.locator('.worktree-list-item.current').first();
  const referenceFilter = page.locator('.branch-search-control');
  const fileToolbar = page.locator('.working-tree-view-toolbar');
  const fileFilter = page.locator('.file-filter');
  const commitSummary = page.locator('.commit-form input[name="summary"]');
  const selectedCommit = page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"]');
  const selectedAuthorNode = selectedCommit.locator('.author-node');
  const commitMessageCard = page.locator('.commit-panel .commit-overview');
  const commitSignature = page.locator('gc-commit-signature .commit-signature');
  await expect(chrome).toHaveCSS('background-color', 'rgb(24, 24, 36)');
  await expect(activeRepositoryTab).toHaveCSS('background-color', 'rgb(36, 36, 55)');
  await expect(toolbar).toHaveCSS('background-color', 'rgb(36, 36, 55)');
  await expect(graphSearch).toHaveCSS('background-color', 'rgb(25, 25, 37)');
  await expect(graphHeader).toHaveCSS('background-color', 'rgb(32, 32, 49)');
  await expect(statusbar).toHaveCSS('background-color', 'rgb(32, 32, 49)');
  await expect(zoomControl).toHaveCSS('background-color', 'rgb(24, 24, 36)');
  await expect(fileToolbar).toHaveCSS('background-color', 'rgb(32, 32, 47)');
  await expect(fileFilter).toHaveCSS('background-color', 'rgb(23, 23, 34)');
  await expect(commitSummary).toHaveCSS('background-color', 'rgb(23, 23, 34)');
  await selectedCommit.focus();
  await selectedCommit.press('Enter');
  await expect(commitDescription).toHaveCSS('color', 'rgb(146, 145, 165)');
  await expect(sidebarHeading).toHaveCSS('color', 'rgb(146, 145, 165)');
  await expect(currentWorktree).toHaveCSS('background-color', 'rgb(36, 36, 56)');
  await expect(referenceFilter).toHaveCSS('background-color', 'rgb(20, 20, 31)');
  await expect(selectedCommit).toHaveCSS('background-color', 'rgb(48, 47, 74)');
  await expect(selectedCommit).toHaveCSS('border-bottom-color', 'rgb(36, 36, 53)');
  expect(await selectedAuthorNode.evaluate((node) => getComputedStyle(node).boxShadow)).toContain('rgb(48, 47, 74)');
  await expect(commitMessageCard).toHaveCSS('background-color', 'rgb(32, 32, 47)');
  await expect(commitMessageCard).toHaveCSS('border-color', 'rgb(55, 54, 75)');
  await expect(commitSignature).toHaveCSS('background-color', 'rgb(32, 51, 47)');
  await expect(commitSignature).toHaveCSS('border-color', 'rgb(53, 110, 97)');
  expect(await cssContrastRatio(page, 'var(--inspector-muted)', 'var(--panel-raised)')).toBeGreaterThanOrEqual(4.5);

  await page.locator('button.chrome-icon[title="Preferences"]').click();
  let preferences = page.getByRole('dialog', { name: 'Preferences' });
  await expect(preferences).toHaveCSS('background-color', 'rgb(36, 35, 53)');
  await expect(preferences).toHaveCSS('border-color', 'rgb(74, 73, 98)');
  const themes = preferences.getByRole('radiogroup', { name: 'Application theme' });
  const chronos = themes.getByRole('radio', { name: /Chronos Dark/ });
  const midnight = themes.getByRole('radio', { name: /Midnight Contrast/ });

  await expect(chronos).toHaveAttribute('aria-checked', 'true');
  await expect(chronos).toHaveAttribute('tabindex', '0');
  await expect(midnight).toHaveAttribute('tabindex', '-1');
  await chronos.focus();
  await chronos.press('ArrowRight');
  await expect(midnight).toBeFocused();
  await expect(midnight).toHaveAttribute('aria-checked', 'true');
  await expect(midnight).toHaveAttribute('tabindex', '0');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'midnight');
  await expect(chrome).toHaveCSS('background-color', 'rgb(15, 22, 33)');
  await expect(activeRepositoryTab).toHaveCSS('background-color', 'rgb(26, 36, 51)');
  await expect(toolbar).toHaveCSS('background-color', 'rgb(26, 36, 51)');
  await expect(graphSearch).toHaveCSS('background-color', 'rgb(12, 19, 30)');
  await expect(graphHeader).toHaveCSS('background-color', 'rgb(18, 27, 41)');
  await expect(statusbar).toHaveCSS('background-color', 'rgb(18, 27, 41)');
  await expect(zoomControl).toHaveCSS('background-color', 'rgb(12, 19, 30)');
  await expect(preferences).toHaveCSS('background-color', 'rgb(26, 36, 51)');
  await expect(preferences).toHaveCSS('border-color', 'rgb(53, 68, 91)');
  await expect(commitDescription).toHaveCSS('color', 'rgb(154, 168, 187)');
  await expect(sidebarHeading).toHaveCSS('color', 'rgb(154, 168, 187)');
  await expect(currentWorktree).toHaveCSS('background-color', 'rgb(26, 36, 51)');
  await expect(referenceFilter).toHaveCSS('background-color', 'rgb(15, 22, 33)');
  await expect(selectedCommit).toHaveCSS('background-color', 'rgb(38, 40, 70)');
  await expect(selectedCommit).toHaveCSS('border-bottom-color', 'rgb(27, 39, 56)');
  expect(await selectedAuthorNode.evaluate((node) => getComputedStyle(node).boxShadow)).toContain('rgb(38, 40, 70)');
  await expect(commitMessageCard).toHaveCSS('background-color', 'rgb(21, 31, 46)');
  await expect(commitMessageCard).toHaveCSS('border-color', 'rgb(53, 68, 91)');
  await expect(commitSignature).toHaveCSS('background-color', 'rgb(20, 42, 37)');
  await expect(commitSignature).toHaveCSS('border-color', 'rgb(63, 128, 111)');
  expect(await cssContrastRatio(page, 'var(--inspector-muted)', 'var(--panel-raised)')).toBeGreaterThanOrEqual(4.5);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('git-khronos.ui.theme'))).toBe('midnight');

  await preferences.getByRole('button', { name: 'Close preferences' }).click();
  await page.getByRole('button', { name: /Switch branch, current/ }).click();
  const branchMenu = page.getByRole('dialog', { name: 'Switch branch' });
  await expect(branchMenu).toHaveCSS('background-color', 'rgb(26, 36, 51)');
  await expect(branchMenu.locator('button.current').first()).toHaveCSS('background-color', 'rgb(42, 57, 80)');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Show all open repositories' }).click();
  const repositoryMenu = page.getByRole('menu', { name: 'Open repositories' });
  await expect(repositoryMenu).toHaveCSS('background-color', 'rgb(26, 36, 51)');
  await expect(repositoryMenu.locator('button.active')).toHaveCSS('background-color', 'rgb(38, 54, 77)');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Configure graph columns' }).click();
  const graphSettings = page.getByRole('dialog', { name: 'Graph settings' });
  await expect(graphSettings).toHaveCSS('background-color', 'rgb(26, 36, 51)');
  await expect(graphSettings).toHaveCSS('border-color', 'rgb(69, 86, 111)');
  await page.keyboard.press('Escape');

  await page.locator('.wip-nav').click();
  await expect(fileToolbar).toHaveCSS('background-color', 'rgb(18, 27, 41)');
  await expect(fileFilter).toHaveCSS('background-color', 'rgb(12, 19, 30)');
  await expect(commitSummary).toHaveCSS('background-color', 'rgb(12, 19, 30)');

  await page.getByTitle('Open repository terminal (Alt+T or Ctrl+`)').click();
  const terminalPanel = page.getByLabel('Repository terminals');
  await expect(terminalPanel).toHaveCSS('background-color', 'rgb(8, 13, 20)');
  await expect(terminalPanel.locator('header')).toHaveCSS('background-color', 'rgb(16, 24, 38)');

  await page.reload();
  await page.locator('button.chrome-icon[title="Preferences"]').click();
  preferences = page.getByRole('dialog', { name: 'Preferences' });
  await expect(preferences.getByRole('radio', { name: /Midnight Contrast/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'midnight');
});

test('guides a bisect search from a known-good commit and restores the branch', async ({ page }) => {
  await page.goto('/?clean-preview');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  const knownGood = page.locator('[data-commit-oid="7c17b9d37d6a36dc9477e611109136f86477041a"]');
  await knownGood.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Start bisect from here…' }).click();

  const confirmation = page.getByRole('alertdialog', { name: 'Find the commit that introduced a problem' });
  await expect(confirmation).toContainText('KNOWN GOOD');
  await expect(confirmation).toContainText('KNOWN BAD');
  await expect(confirmation.locator('.bisect-endpoints small').first()).toHaveCSS('font-size', '12px');
  await expect(confirmation.locator('.bisect-endpoints code').first()).toHaveCSS('font-size', '12px');
  await expect(confirmation.locator('.bisect-note')).toHaveCSS('font-size', '12px');
  await confirmation.getByRole('button', { name: 'Start Bisect' }).click();

  const progress = page.getByRole('status', { name: 'Git bisect in progress' });
  await expect(progress).toBeVisible();
  await expect(progress).toContainText('Test commit');
  await progress.getByRole('button', { name: 'Good' }).click();
  await expect(progress).toBeVisible();
  await progress.getByRole('button', { name: 'Reset' }).click();

  await expect(progress).toHaveCount(0);
  await expect(page.getByText('main', { exact: true }).last()).toBeVisible();
});

test('hides and solos an entire remote from its Left Panel heading', async ({ page }) => {
  const origin = page.getByRole('region', { name: 'Remote origin' });
  const alignedOrigin = page.locator('#reference-section-local').getByLabel('Remote branch origin/release', { exact: true });
  await origin.locator('.remote-location-heading').click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Remote origin graph actions' });
  await menu.getByRole('menuitem', { name: 'Hide remote from graph' }).click();
  await expect(origin).toHaveClass(/reference-hidden/);
  await expect(alignedOrigin).toHaveClass(/reference-hidden/);
  await expect(page.locator('.ref-pill.remote').filter({ hasText: 'origin/main' })).toHaveCount(0);

  await origin.locator('.remote-location-heading').click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Show remote in graph' }).click();
  await expect(origin).not.toHaveClass(/reference-hidden/);
  await expect(alignedOrigin).not.toHaveClass(/reference-hidden/);

  await origin.locator('.remote-location-heading').click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Solo remote' }).click();
  await expect(origin).toHaveClass(/reference-soloed/);
  await expect(alignedOrigin).toHaveClass(/reference-soloed/);
  await expect(page.locator('.reference-filter-bar')).toContainText('SOLO MODE');
  await expect(page.locator('.ref-pill.remote').filter({ hasText: 'upstream/main' })).toHaveCount(0);
  await page.locator('.reference-filter-bar').getByRole('button', { name: 'Show all' }).click();
});

test('favorites repositories and opens them with the familiar numeric shortcut', async ({ page }) => {
  const currentPath = '/home/maya/projects/git-khronos';
  const linkedPath = '/home/maya/projects/git-khronos-partial-staging';
  await page.evaluate(({ currentPath, linkedPath }) => {
    localStorage.setItem('git-khronos.recent-repositories.v1', JSON.stringify([currentPath, linkedPath]));
  }, { currentPath, linkedPath });
  await page.goto('/?worktree-tabs');

  await page.keyboard.press('Control+t');
  const manager = page.getByRole('dialog', { name: 'Repository management' });
  await manager.getByRole('button', { name: 'Add git-khronos-partial-staging to favorites' }).click();
  await expect(manager.getByText('Favorites')).toBeVisible();
  await expect(manager.getByRole('button', { name: /git-khronos-partial-staging/ }).first()).toContainText('Ctrl Alt 1');

  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Alt+1');
  await expect(page.locator('.repo-tab.active')).toContainText('git-khronos-partial-staging');

  await page.reload();
  await page.keyboard.press('Control+t');
  await expect(page.getByRole('dialog', { name: 'Repository management' }).getByText('Favorites')).toBeVisible();
});

test('reorders repository tabs with a persisted drag destination', async ({ page }) => {
  await page.goto('/?worktree-tabs');
  const tabs = page.locator('.repo-tab');
  await expect(tabs).toHaveCount(2);
  await expect(tabs.first()).toHaveCSS('font-size', '13px');
  await expect(tabs.nth(0)).toContainText('git-khronos');
  await expect(tabs.nth(1)).toContainText('git-khronos-partial-staging');
  await expect(tabs.nth(0)).toHaveClass(/has-changes/);
  await expect(tabs.nth(0).getByRole('tab')).toHaveAttribute('aria-label', /4 uncommitted changes/);
  await expect(tabs.nth(0).locator('i')).toHaveAttribute('title', '4 uncommitted changes');
  await expect(tabs.nth(0)).toHaveCSS('box-shadow', /inset/);
  const inactiveClose = tabs.nth(1).getByRole('button', { name: /Close/ });
  await expect(inactiveClose).toHaveCSS('opacity', '0');
  await tabs.nth(1).hover();
  await expect(inactiveClose).toHaveCSS('opacity', '1');
  expect(await inactiveClose.evaluate((button) => button.getBoundingClientRect().width >= 24)).toBe(true);

  await tabs.nth(0).dragTo(tabs.nth(1));
  await expect(tabs.nth(0)).toContainText('git-khronos-partial-staging');
  await expect(tabs.nth(1)).toContainText('git-khronos');
  await expect.poll(() => page.evaluate(() => JSON.parse(
    localStorage.getItem('git-khronos.open-repositories.v1') ?? '[]',
  ))).toEqual([
    '/home/maya/projects/git-khronos-partial-staging',
    '/home/maya/projects/git-khronos',
  ]);
});

test('reorders repository tabs from the keyboard and preserves focused selection', async ({ page }) => {
  await page.goto('/?worktree-tabs');
  const tabs = page.locator('.repo-tab');
  const current = tabs.nth(0).getByRole('tab');
  await current.focus();
  await expect(current).toHaveAttribute('aria-keyshortcuts', /Control\+Shift\+PageDown/);

  await page.keyboard.press('Control+Shift+PageDown');
  await expect(tabs.nth(0)).toContainText('git-khronos-partial-staging');
  await expect(tabs.nth(1)).toContainText('git-khronos');
  const moved = tabs.nth(1).getByRole('tab');
  await expect(moved).toBeFocused();
  await expect(moved).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-repository-tab-order-status]')).toHaveText('git-khronos moved to position 2 of 2.');
  await expect.poll(() => page.evaluate(() => JSON.parse(
    localStorage.getItem('git-khronos.open-repositories.v1') ?? '[]',
  ))).toEqual([
    '/home/maya/projects/git-khronos-partial-staging',
    '/home/maya/projects/git-khronos',
  ]);

  await page.keyboard.press('Control+Shift+PageUp');
  await expect(tabs.nth(0)).toContainText('git-khronos');
  await expect(tabs.nth(0).getByRole('tab')).toBeFocused();
  await expect(page.locator('[data-repository-tab-order-status]')).toHaveText('git-khronos moved to position 1 of 2.');
});

test('offers repository tab utilities and batch closing from the tab menu', async ({ page }) => {
  await page.goto('/?worktree-tabs');
  const tabs = page.locator('.repo-tab');
  await expect(tabs).toHaveCount(2);

  await tabs.first().click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Repository actions for git-khronos' });
  await expect(menu).toContainText('/home/maya/projects/git-khronos');
  await expect(menu.locator('.tab-context-heading strong')).toHaveCSS('font-size', '13px');
  await expect(menu.locator('.tab-context-heading small')).toHaveCSS('font-size', '12px');
  await expect(menu.locator('.tab-menu-action').first()).toHaveCSS('font-size', '13px');
  await expect(menu.locator('.tab-menu-action > small').first()).toHaveCSS('font-size', '12px');
  await expect(menu.getByRole('menuitem', { name: 'Open terminal' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Open in file manager' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Move tab left/ })).toBeDisabled();
  const moveRight = menu.getByRole('menuitem', { name: /Move tab right/ });
  await expect(moveRight).toBeEnabled();
  await expect(moveRight).toContainText('Ctrl Shift Page Down');
  const favorite = menu.getByRole('menuitemcheckbox', { name: 'Add to favorites' });
  await expect(favorite).toHaveAttribute('aria-checked', 'false');
  await favorite.click();
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Remove from favorites' })).toHaveAttribute('aria-checked', 'true');
  await expect(menu.getByRole('menuitem', { name: 'Close repositories to the right 1' })).toBeEnabled();

  await moveRight.click();
  await expect(tabs.nth(0)).toContainText('git-khronos-partial-staging');
  await expect(tabs.nth(1)).toContainText('git-khronos');
  await expect(page.locator('[data-repository-tab-order-status]')).toHaveText('git-khronos moved to position 2 of 2.');

  await tabs.nth(1).click({ button: 'right' });
  const movedMenu = page.getByRole('menu', { name: 'Repository actions for git-khronos' });
  await expect(movedMenu.getByRole('menuitem', { name: /Move tab right/ })).toBeDisabled();
  await movedMenu.getByRole('menuitem', { name: /Move tab left/ }).click();
  await expect(tabs.nth(0)).toContainText('git-khronos');
  await expect(tabs.nth(1)).toContainText('git-khronos-partial-staging');

  await tabs.first().click({ button: 'right' });
  const restoredMenu = page.getByRole('menu', { name: 'Repository actions for git-khronos' });

  await restoredMenu.getByRole('menuitem', { name: 'Close repositories to the right 1' }).click();
  await expect(tabs).toHaveCount(1);
  await expect(tabs.first()).toContainText('git-khronos');

  await page.keyboard.press('Control+Shift+T');
  await expect(tabs).toHaveCount(2);
  await tabs.nth(1).click({ button: 'right' });
  const linkedMenu = page.getByRole('menu', { name: 'Repository actions for git-khronos-partial-staging' });
  await linkedMenu.getByRole('menuitem', { name: 'Close other repositories 1' }).click();
  await expect(tabs).toHaveCount(1);
  await expect(tabs.first()).toContainText('git-khronos-partial-staging');
  await expect(tabs.first()).toHaveClass(/active/);
});

test('opens and navigates repository tab actions from the keyboard', async ({ page }) => {
  await page.goto('/?worktree-tabs');
  const tabButton = page.locator('.repo-tab').first().locator('.repo-tab-main');
  await tabButton.focus();
  await page.keyboard.press('Shift+F10');

  const menu = page.getByRole('menu', { name: 'Repository actions for git-khronos' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Open terminal' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Open in file manager' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(menu.getByRole('menuitem', { name: 'Close repository', exact: true })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(menu.getByRole('menuitem', { name: 'Open terminal' })).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(tabButton).toBeFocused();
});

test('reveals repository display-name editing only when requested', async ({ page }) => {
  await page.goto('/?worktree-tabs');
  const tab = page.locator('.repo-tab').first();
  await tab.click({ button: 'right' });

  const menu = page.getByRole('menu', { name: 'Repository actions for git-khronos' });
  await expect(menu.getByRole('textbox')).toHaveCount(0);
  await menu.getByRole('menuitem', { name: 'Edit display name…' }).click();

  const editor = page.getByRole('dialog', { name: 'Edit display name for git-khronos' });
  const input = editor.getByRole('textbox', { name: 'Repository display name' });
  await expect(input).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(editor.getByRole('button', { name: 'Save' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(input).toBeFocused();
  await input.fill('Chronos Core');
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(tab).toContainText('Chronos Core');

  await tab.click({ button: 'right' });
  const renamedMenu = page.getByRole('menu', { name: 'Repository actions for Chronos Core' });
  await renamedMenu.getByRole('menuitem', { name: 'Edit display name…' }).click();
  const renamedEditor = page.getByRole('dialog', { name: 'Edit display name for Chronos Core' });
  const renamedInput = renamedEditor.getByRole('textbox', { name: 'Repository display name' });
  await expect(renamedInput).toHaveValue('Chronos Core');
  await renamedInput.fill('Discard this draft');
  await page.keyboard.press('Escape');
  await expect(renamedMenu.getByRole('menuitem', { name: 'Edit display name…' })).toBeFocused();
  await renamedMenu.getByRole('menuitem', { name: 'Edit display name…' }).click();
  await expect(page.getByRole('dialog', { name: 'Edit display name for Chronos Core' })
    .getByRole('textbox', { name: 'Repository display name' })).toHaveValue('Chronos Core');
});

test('switches repository tabs with standard tablist keys and restores focus after close', async ({ page }) => {
  await page.goto('/?worktree-tabs');
  const tablist = page.getByRole('tablist', { name: 'Open repositories' });
  const first = tablist.getByRole('tab', { name: /git-khronos/ }).first();
  const second = tablist.getByRole('tab', { name: /git-khronos-partial-staging/ });
  const firstClose = page.getByRole('button', { name: 'Close git-khronos', exact: true });
  const secondClose = page.getByRole('button', { name: 'Close git-khronos-partial-staging', exact: true });

  await expect(first).toHaveAttribute('aria-selected', 'true');
  await expect(first).toHaveAttribute('tabindex', '0');
  await expect(second).toHaveAttribute('tabindex', '-1');
  await expect(firstClose).toHaveAttribute('tabindex', '0');
  await expect(secondClose).toHaveAttribute('tabindex', '-1');
  await first.focus();
  await first.press('ArrowRight');
  await expect(second).toBeFocused();
  await expect(second).toHaveAttribute('aria-selected', 'true');
  await expect(second).toHaveAttribute('tabindex', '0');
  await expect(first).toHaveAttribute('tabindex', '-1');
  await expect(firstClose).toHaveAttribute('tabindex', '-1');
  await expect(secondClose).toHaveAttribute('tabindex', '0');

  await second.press('Home');
  await expect(first).toBeFocused();
  await expect(first).toHaveAttribute('aria-selected', 'true');
  await first.press('ArrowLeft');
  await expect(second).toBeFocused();
  await expect(second).toHaveAttribute('aria-selected', 'true');

  await page.locator('.repo-tab.active').getByRole('button', { name: /Close/ }).click();
  await expect(tablist.getByRole('tab')).toHaveCount(1);
  await expect(first).toBeFocused();
  await expect(first).toHaveAttribute('aria-selected', 'true');
});

test('cycles repository tabs with Ctrl+Tab and exposes the commands', async ({ page }) => {
  await page.goto('/?worktree-tabs');
  const tablist = page.getByRole('tablist', { name: 'Open repositories' });
  const first = tablist.getByRole('tab', { name: /git-khronos/ }).first();
  const second = tablist.getByRole('tab', { name: /git-khronos-partial-staging/ });

  await expect(first).toHaveAttribute('aria-selected', 'true');
  await expect(first).toHaveAttribute('aria-keyshortcuts', /Control\+Tab/);
  await page.keyboard.press('Control+Tab');
  await expect(second).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Control+Shift+Tab');
  await expect(first).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('Control+p');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByRole('combobox').fill('repository tab');
  await expect(palette.getByRole('option', { name: /Next Repository Tab/ })).toContainText('Ctrl Tab');
  await expect(palette.getByRole('option', { name: /Previous Repository Tab/ })).toContainText('Ctrl Shift Tab');
  await palette.getByRole('option', { name: /Next Repository Tab/ }).click();
  await expect(second).toHaveAttribute('aria-selected', 'true');
});

test('keeps the window title aligned with the active repository state', async ({ page }) => {
  await expect(page).toHaveTitle('git-khronos — main • 4 changes — Git Khronos');

  await page.goto('/?worktree-tabs');
  const linked = page.getByRole('tab', { name: /git-khronos-partial-staging/ });
  await linked.click();
  await expect(page).toHaveTitle('git-khronos-partial-staging — feature/partial-staging • 4 changes — Git Khronos');

  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    const repository = git.repository();
    git.repositories.update((items: any[]) => items.map((item) => item.id === repository.id ? {
      ...item,
      status: { ...item.status, entryCount: 0, branch: null },
      branches: item.branches.map((branch: any) => ({ ...branch, current: false })),
    } : item));
  });
  await expect(page).toHaveTitle(/git-khronos-partial-staging — Detached [0-9a-f]{8} — Git Khronos/);

  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    const repository = git.repository();
    git.repositories.update((items: any[]) => items.map((item) => item.id === repository.id ? {
      ...item,
      headOid: null,
      commits: [],
    } : item));
  });
  await expect(page).toHaveTitle('git-khronos-partial-staging — No commits — Git Khronos');

  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    git.repositories.set([]);
    git.activeRepositoryId.set(null);
  });
  await expect(page).toHaveTitle('Git Khronos');
});

test('keeps the open-repositories menu inside compact windows', async ({ page }) => {
  await page.setViewportSize({ width: 780, height: 560 });
  await page.goto('/?worktree-tabs');
  await expect(page.locator('.app-shell')).toBeVisible();

  await page.getByRole('button', { name: 'Show all open repositories' }).click();
  const menu = page.getByRole('menu', { name: 'Open repositories' });
  await expect(menu).toBeVisible();
  await expect(menu.locator('strong').first()).toHaveCSS('font-size', '13px');
  await expect(menu.locator('small').first()).toHaveCSS('font-size', '12px');
  await expect(menu.locator('kbd').first()).toHaveCSS('white-space', 'nowrap');
  expect((await menu.locator('kbd').first().boundingBox())!.height).toBeLessThan(20);
  const bounds = await menu.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewportHeight);
  await expect(menu.locator('kbd').first()).toBeVisible();
});

test('uses branch-aware labels for grouped worktree tabs at every width', async ({ page }) => {
  for (const width of [1440, 550]) {
    await page.setViewportSize({ width, height: 700 });
    await page.goto('/?worktree-tabs');

    const tablist = page.getByRole('tablist', { name: 'Open repositories' });
    const main = tablist.getByRole('tab', { name: 'git-khronos, branch main' });
    const feature = tablist.getByRole('tab', { name: 'git-khronos-partial-staging, branch feature/partial-staging' });
    await expect(main).toBeVisible();
    await expect(feature).toBeVisible();
    await expect(main.locator('.repo-tab-full-label')).toBeHidden();
    await expect(feature.locator('.repo-tab-full-label')).toBeHidden();
    await expect(main.locator('.repo-tab-compact-label')).toHaveText('main');
    await expect(feature.locator('.repo-tab-compact-label')).toHaveText('feature/partial-staging');
    await expect(main.locator('.repo-tab-compact-label')).toBeVisible();
    await expect(feature.locator('.repo-tab-compact-label')).toBeVisible();
    await expect(main).toHaveAttribute('title', / — main — /);
    await expect(feature).toHaveAttribute('title', / — feature\/partial-staging — /);

    if (width === 1440) {
      await page.getByRole('button', { name: 'Show all open repositories' }).click();
      const menuBranches = page.getByRole('menu', { name: 'Open repositories' }).locator('.tab-list-branch');
      await expect(menuBranches).toHaveText(['main', 'feature/partial-staging']);
      await expect(menuBranches.nth(0)).toHaveAttribute('title', 'main');
      await expect(menuBranches.nth(1)).toHaveAttribute('title', 'feature/partial-staging');
      expect(await menuBranches.nth(0).evaluate((label) => label.scrollWidth <= label.clientWidth)).toBe(true);
      await page.keyboard.press('Escape');
    }
  }
});

test('reveals the complete active worktree tab and its close control at compact width', async ({ page }) => {
  await page.setViewportSize({ width: 550, height: 700 });
  await page.goto('/?worktree-tabs');

  const tablist = page.getByRole('tablist', { name: 'Open repositories' });
  const feature = tablist.getByRole('tab', { name: 'git-khronos-partial-staging, branch feature/partial-staging' });
  await page.keyboard.press('Control+Tab');
  await expect(feature).toHaveAttribute('aria-selected', 'true');
  const activeTab = page.locator('.repo-tab.active');

  await expect.poll(async () => {
    const [viewport, tab, close] = await Promise.all([
      tablist.boundingBox(),
      activeTab.boundingBox(),
      activeTab.getByRole('button', { name: 'Close git-khronos-partial-staging' }).boundingBox(),
    ]);
    return !!viewport && !!tab && !!close
      && tab.x >= viewport.x - 1
      && tab.x + tab.width <= viewport.x + viewport.width + 1
      && close.x + close.width <= viewport.x + viewport.width + 1;
  }).toBe(true);
});

test('prioritizes the repository name over the workspace name in the compact tab bar', async ({ page }) => {
  await page.setViewportSize({ width: 500, height: 700 });
  await page.goto('/');

  const workspace = page.getByRole('button', { name: 'Workspace: Default' });
  const repository = page.getByRole('tab', { name: /git-khronos/i });
  await expect(workspace).toBeVisible();
  await expect(workspace).toHaveAttribute('title', 'Workspace: Default — switch workspace');
  await expect(workspace.locator('span')).toBeHidden();
  await expect(repository.locator('.repo-tab-full-label')).toBeVisible();
  await expect(repository.locator('.repo-tab-full-label')).toHaveText('git-khronos');

  const visibleLabelWidth = await repository.locator('strong').evaluate((element) => element.getBoundingClientRect().width);
  expect(visibleLabelWidth).toBeGreaterThanOrEqual(48);
});

test('keeps the workspace switcher inside narrow application windows', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });

  const assertSwitcherFits = async () => {
    const menu = page.getByRole('menu', { name: 'Workspaces' });
    await expect(menu).toBeVisible();
    const bounds = await menu.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(8);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(312);
  };

  await page.getByRole('button', { name: 'Workspace: Default' }).click();
  await assertSwitcherFits();
  await page.keyboard.press('Escape');

  await page.goto('/?welcome-preview');
  await expect(page.locator('.welcome')).toBeVisible();
  await expect(page.locator('.welcome-nav .brand > span:last-child')).toBeHidden();
  await page.getByRole('button', { name: 'Workspace: Default' }).click();
  await assertSwitcherFits();
});

test('reveals the active repository tab when the tab strip overflows', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 720 });
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    const base = git.repositories()[0];
    const repositories = Array.from({ length: 9 }, (_, index) => {
      const suffix = String(index + 1).padStart(2, '0');
      const path = `/home/maya/projects/repository-${suffix}`;
      return {
        ...base,
        id: `overflow-${index}`,
        name: `repository-${suffix}`,
        path,
        gitDir: `${path}/.git`,
        worktrees: base.worktrees.map((worktree: any, worktreeIndex: number) => ({
          ...worktree,
          path: worktreeIndex ? `${path}-worktree-${worktreeIndex}` : path,
        })),
      };
    });
    git.repositories.set(repositories);
    git.activeRepositoryId.set(repositories[0].id);
  });

  const tablist = page.getByRole('tablist', { name: 'Open repositories' });
  await expect(tablist.getByRole('tab')).toHaveCount(9);
  expect(await page.locator('.repo-tab').evaluateAll((tabs) => tabs.every((tab) => tab.getBoundingClientRect().width >= 88))).toBe(true);
  expect(await tablist.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  const scrollBack = page.getByRole('button', { name: 'Scroll repository tabs left' });
  const scrollForward = page.getByRole('button', { name: 'Scroll repository tabs right' });
  await expect(scrollBack).toBeVisible();
  await expect(scrollForward).toBeVisible();
  await expect(scrollBack).toBeDisabled();
  await expect(scrollForward).toBeEnabled();
  await scrollForward.click();
  await expect.poll(() => tablist.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await expect(scrollBack).toBeEnabled();

  await page.getByRole('button', { name: 'Show all open repositories' }).click();
  const repositoryMenu = page.getByRole('menu', { name: 'Open repositories' });
  const repositoryMenuHeading = repositoryMenu.locator('.tab-list-heading');
  const repositoryMenuScroll = repositoryMenu.locator('.tab-list-scroll');
  const headingTop = (await repositoryMenuHeading.boundingBox())!.y;
  await expect(repositoryMenu.getByRole('menuitemradio', { name: /repository-01/ }))
    .toHaveAttribute('aria-keyshortcuts', 'Control+1 Meta+1');
  await expect(repositoryMenu.getByRole('menuitemradio', { name: /repository-01/ }))
    .toHaveAttribute('title', 'repository-01 — main — /home/maya/projects/repository-01');
  expect(await repositoryMenuScroll.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await repositoryMenuScroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(repositoryMenu.getByRole('menuitemradio', { name: /repository-09/ })).toBeVisible();
  expect((await repositoryMenuHeading.boundingBox())!.y).toBe(headingTop);
  await repositoryMenu.getByRole('menuitemradio', { name: /repository-09/ }).click();

  const lastTab = tablist.locator('[data-repository-tab-id="overflow-8"]');
  await expect(lastTab).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => tablist.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  const [tablistBounds, lastTabBounds] = await Promise.all([tablist.boundingBox(), lastTab.boundingBox()]);
  expect(tablistBounds).not.toBeNull();
  expect(lastTabBounds).not.toBeNull();
  expect(lastTabBounds!.x).toBeGreaterThanOrEqual(tablistBounds!.x - 1);
  expect(lastTabBounds!.x + lastTabBounds!.width).toBeLessThanOrEqual(tablistBounds!.x + tablistBounds!.width + 1);

  await page.setViewportSize({ width: 700, height: 720 });
  await expect.poll(async () => {
    const [container, tab] = await Promise.all([tablist.boundingBox(), lastTab.boundingBox()]);
    return !!container && !!tab
      && tab.x >= container.x - 1
      && tab.x + tab.width <= container.x + container.width + 1;
  }).toBe(true);

  await lastTab.focus();
  await lastTab.press('Home');
  const firstTab = tablist.locator('[data-repository-tab-id="overflow-0"]');
  await expect(firstTab).toBeFocused();
  await expect(firstTab).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => tablist.evaluate((element) => element.scrollLeft)).toBe(0);
});

test('reopens the most recently closed repository tab', async ({ page }) => {
  await page.goto('/?worktree-tabs');
  const tabs = page.locator('.repo-tab');
  await expect(tabs).toHaveCount(2);

  await tabs.nth(1).hover();
  await tabs.nth(1).getByRole('button', { name: /Close/ }).click();
  await expect(tabs).toHaveCount(1);

  await page.keyboard.press('Control+Shift+T');
  await expect(tabs).toHaveCount(2);
  await expect(page.locator('.repo-tab.active')).toContainText('git-khronos-partial-staging');

  await page.locator('.repo-tab.active').getByRole('button', { name: /Close/ }).click();
  await tabs.first().getByRole('button', { name: /Close/ }).click();
  const reopenFromWelcome = page.getByRole('button', { name: 'Reopen git-khronos' });
  await expect(reopenFromWelcome).toBeVisible();
  await reopenFromWelcome.click();
  await expect(page.locator('.repo-tab.active')).toContainText('git-khronos');

  await page.keyboard.press('Control+Shift+T');
  await expect(tabs).toHaveCount(2);
  await expect(page.locator('.repo-tab.active')).toContainText('git-khronos-partial-staging');
});

test('offers a terminal handoff for new worktrees', async ({ page }) => {
  await page.goto('/?worktree-dialog');
  const dialog = page.getByRole('dialog', { name: 'Create Worktree' });
  const handoff = dialog.getByRole('combobox', { name: 'After creating' });
  const branchName = dialog.getByRole('textbox', { name: 'Branch name' });
  const close = dialog.getByRole('button', { name: 'Close worktree setup' });

  await expect(dialog).toBeVisible();
  await expect(branchName).toBeFocused();
  await expect(handoff.locator('option')).toHaveCount(2);
  await expect(handoff.locator('option:disabled')).toHaveCount(0);
  await expect(handoff.locator('option:checked')).toHaveText('Open the worktree');
  await expect(dialog).toContainText('The terminal starts in the new worktree.');

  await handoff.selectOption('terminal');
  await expect(handoff.locator('option:checked')).toHaveText('Open the worktree and a terminal');

  await close.focus();
  await close.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Create worktree' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Create worktree' }).press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('chooses a pull mode independently from the persisted default', async ({ page }) => {
  await page.getByRole('button', { name: 'Pull options' }).click();
  const menu = page.locator('.pull-menu');
  await menu.getByRole('menuitemradio', { name: 'Make Rebase the default pull strategy' }).click();
  await expect(menu.getByRole('menuitemradio', { name: 'Rebase is the default pull strategy' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('button', { name: /Pull from origin\/main/ })).toHaveAttribute('title', /Rebase/);

  await page.reload();
  await page.getByRole('button', { name: 'Pull options' }).click();
  await expect(page.locator('.pull-menu').getByRole('menuitemradio', { name: 'Rebase is the default pull strategy' })).toHaveAttribute('aria-checked', 'true');
});

test('confirms rewritten history before force pushing with a lease', async ({ page }) => {
  await page.getByRole('button', { name: 'Push options' }).click();
  const pushMenu = page.locator('.push-menu');
  await expect(pushMenu.getByRole('menuitem', { name: /Force Push with Lease/ })).toBeEnabled();
  await pushMenu.getByRole('menuitem', { name: /Force Push with Lease/ }).click();

  const confirmation = page.getByRole('alertdialog', { name: 'Force push main' });
  await expect(confirmation).toContainText('origin/main');
  await expect(confirmation).toContainText('--force-with-lease');
  await expect(confirmation).toContainText('Git rejects the operation');
  await confirmation.getByRole('button', { name: 'Force Push with Lease' }).click();

  await expect(confirmation).toHaveCount(0);
  await expect(page.locator('.activity-status')).toContainText('Force push with lease complete');
});

test('keeps conflicted merge recovery visible until it is completed or aborted', async ({ page }) => {
  await page.goto('/?merge-preview');
  await expect(page.locator('.commit-row').first()).toBeVisible();

  const progress = page.getByRole('status', { name: 'Git merge in progress' });
  await expect(progress).toContainText('1 conflicted file(s) need resolution');
  await expect(progress.getByRole('button', { name: 'Continue' })).toBeDisabled();
  await expect(page.getByText('Conflicted Files (1)')).toBeVisible();
  await expect(page.locator('.wip-nav > b')).toHaveText('4');
  await expect(page.getByRole('button', { name: 'Staged Files (0)' })).toBeVisible();
  await expect(page.getByText('No staged files', { exact: true })).toBeVisible();
  await progress.getByRole('button', { name: 'Abort' }).click();

  await expect(progress).toHaveCount(0);
  await expect(page.locator('.activity-status')).toContainText('Merge aborted');
});

test('keeps an interrupted cherry-pick recoverable from the history workspace', async ({ page }) => {
  await page.goto('/?history-preview=cherry-pick');
  await expect(page.locator('.commit-row').first()).toBeVisible();

  const progress = page.getByRole('status', { name: 'Git cherry-pick in progress' });
  await expect(progress).toContainText('CHERRY-PICK IN PROGRESS');
  await expect(progress).toContainText('1 conflicted file(s) need resolution');
  await expect(progress.getByRole('button', { name: 'Continue' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Unstaged Files (3)' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Staged Files (0)' })).toBeVisible();
  await expect(page.getByText('No staged files', { exact: true })).toBeVisible();
  await progress.getByRole('button', { name: 'Abort' }).click();

  await expect(progress).toHaveCount(0);
  await expect(page.locator('.activity-status')).toContainText('Cherry-pick aborted');
});

test('shows Git LFS actions only for repositories that enable LFS', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Git LFS options' })).toHaveCount(0);

  await page.goto('/?lfs-preview');
  await expect(page.locator('.app-shell')).toBeVisible();
  const lfsOptions = page.getByRole('button', { name: 'Git LFS options' });
  await lfsOptions.click();
  await expect(page.locator('.lfs-menu-status')).toContainText('git-lfs/3.7.1');
  await expect(page.locator('.lfs-menu-status')).toContainText('12 tracked files');
  await expect(page.getByRole('menuitem', { name: /Clean LFS storage/ })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(lfsOptions).toBeFocused();

  await page.locator('.file-row').filter({ hasText: 'app.component.html' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Configure Git LFS for this file type…' }).click();
  await expect(page.getByRole('dialog', { name: 'Preferences' })).toBeVisible();
  await expect(page.getByLabel('Git LFS tracking pattern')).toHaveValue('*.html');
  await expect(page.getByRole('button', { name: 'Track Pattern' })).toBeEnabled();
});

test('configures an enabled sparse checkout from the toolbar and command palette', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Sparse checkout options' })).toHaveCount(0);

  await page.goto('/?sparse-preview');
  await expect(page.locator('.app-shell')).toBeVisible();
  const sparseOptions = page.getByRole('button', { name: 'Sparse checkout options' });
  await sparseOptions.click();
  await expect(page.locator('.sparse-menu')).toContainText('2 selected directories');
  await expect(page.locator('.sparse-menu')).toContainText('sparse index');
  await page.getByRole('menuitem', { name: /Edit directories/ }).click();
  await expect(page.getByRole('dialog', { name: 'Preferences' })).toBeVisible();
  await expect(page.getByLabel('Sparse checkout directories')).toHaveValue('apps/desktop\ncrates/git-core');
  await expect(page.getByRole('button', { name: 'Update Directories' })).toBeEnabled();
  await page.getByRole('button', { name: 'Close preferences' }).click();

  await sparseOptions.click();
  await page.getByRole('menuitem', { name: /Disable sparse checkout/ }).click();
  let sparseConfirmation = page.getByRole('alertdialog', { name: 'Restore the complete working tree?' });
  await expect(sparseConfirmation.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(sparseConfirmation).toBeHidden();
  await expect(sparseOptions).toBeFocused();

  await sparseOptions.focus();
  await page.keyboard.press('Control+P');
  await page.getByLabel('Search commands').fill('disable sparse');
  await page.getByRole('option', { name: /Disable Sparse Checkout/ }).click();
  sparseConfirmation = page.getByRole('alertdialog', { name: 'Restore the complete working tree?' });
  await expect(sparseConfirmation.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await expect(sparseConfirmation).toContainText('substantial disk space');
  await page.keyboard.press('Escape');
  await expect(sparseConfirmation).toBeHidden();
  await expect(sparseOptions).toBeFocused();
});

test('manages repository remotes from the reference panel', async ({ page }) => {
  const addRemote = page.getByRole('button', { name: 'Add remote' });
  await addRemote.focus();
  await addRemote.click();
  const addDialog = page.getByRole('dialog', { name: 'Add Remote' });
  await expect(addDialog.getByLabel('Name')).toHaveValue('');
  await expect(addDialog.getByLabel('Name')).toBeFocused();
  await expect(addDialog.getByLabel('Fetch URL')).toHaveAttribute('placeholder', 'https://host/owner/repository.git');
  await expect(addDialog.getByRole('button', { name: 'Add Remote' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(addDialog).toBeHidden();
  await expect(addRemote).toBeFocused();

  const editRemote = page.getByRole('button', { name: 'Edit remote origin' });
  await editRemote.focus();
  await editRemote.click();
  const editDialog = page.getByRole('dialog', { name: 'Edit Remote' });
  await expect(editDialog.getByLabel('Name')).toHaveValue('origin');
  await expect(editDialog.getByLabel('Name')).toHaveAttribute('readonly', '');
  await expect(editDialog.getByLabel('Fetch URL')).toHaveValue('git@github.com:example/git-khronos.git');
  await expect(editDialog.getByLabel('Fetch URL')).toBeFocused();
  await expect(editDialog).toContainText('Push currently uses git@github.com:example/git-khronos.git.');

  await editDialog.getByRole('button', { name: 'Remove Remote' }).click();
  const confirmation = page.getByRole('alertdialog', { name: 'origin' });
  await expect(confirmation).toContainText('remote-tracking branches');
  const cancelRemoval = confirmation.getByRole('button', { name: 'Cancel' });
  const confirmRemoval = confirmation.getByRole('button', { name: 'Remove Remote' });
  await expect(cancelRemoval).toBeFocused();
  await cancelRemoval.press('Shift+Tab');
  await expect(confirmRemoval).toBeFocused();
  await confirmRemoval.press('Tab');
  await expect(cancelRemoval).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirmation).toBeHidden();
  await expect(editRemote).toBeFocused();
});

test('keeps add-submodule keyboard focus inside the dialog and returns it to its launcher', async ({ page }) => {
  await page.goto('/?submodules');
  const opener = page.getByRole('button', { name: 'Add submodule' });
  await opener.focus();
  await opener.click();

  const dialog = page.getByRole('dialog', { name: 'Add Submodule' });
  const close = dialog.getByRole('button', { name: 'Close add submodule dialog' });
  const remoteUrl = dialog.getByRole('textbox', { name: 'Remote URL' });
  await expect(remoteUrl).toBeFocused();

  await close.focus();
  await close.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Cancel' }).press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test('makes submodule management discoverable from the sidebar and command palette', async ({ page }) => {
  await page.goto('/');

  const section = page.locator('#reference-section-submodules');
  await expect(section).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submodules 2' })).toHaveAttribute('aria-expanded', 'true');

  const manage = page.getByRole('button', { name: 'Manage submodules' });
  await expect(manage).toContainText('Review state, sync, check out, deinitialize, or remove');
  await manage.click();
  await expect(page.getByRole('dialog', { name: 'Manage submodules', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(manage).toBeFocused();

  await page.reload();
  await page.getByRole('button', { name: 'Command palette', exact: true }).click();
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await palette.getByLabel('Search commands').fill('submodule');
  await expect(palette.getByRole('option', { name: /Manage Submodules/ })).toBeVisible();
  await expect(palette.getByRole('option', { name: /Add Submodule/ })).toBeVisible();
});

test('preserves an explicit choice to hide the submodule pane', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('git-khronos.ui.pane-submodules', 'false'));
  await page.reload();

  await expect(page.locator('#reference-section-submodules')).toBeHidden();
  await page.locator('.sidebar-heading').first().click({ button: 'right' });
  await expect(page.getByRole('menu', { name: 'Left Panel panes' })
    .getByRole('menuitemcheckbox', { name: 'Submodules' })).toHaveAttribute('aria-checked', 'false');
});

test('starts with author and date metadata and persists the optional SHA column', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('.graph-columns')).toContainText('AUTHOR');
  await expect(page.locator('.graph-columns')).toContainText('DATE / TIME');
  await expect(page.locator('.graph-columns')).not.toContainText('SHA');
  await page.getByRole('button', { name: 'Configure graph columns' }).click();
  let settings = page.getByRole('dialog', { name: 'Graph settings' });
  await expect(settings.getByRole('checkbox', { name: 'Author' })).toBeChecked();
  await expect(settings.getByRole('checkbox', { name: 'Date / Time' })).toBeChecked();
  const shaColumn = settings.getByRole('checkbox', { name: 'SHA' });
  await expect(shaColumn).not.toBeChecked();
  await shaColumn.check();
  await expect(page.locator('.graph-columns')).toContainText('SHA');
  await expect(page.locator('.commit-row .row-date').first()).toBeVisible();
  await expect(page.locator('.commit-row .row-date small').filter({ hasText: /^\d{2}:\d{2}$/ }).first()).toBeVisible();
  await expect(page.locator('.commit-row .row-date small').first()).toHaveCSS('font-size', '12px');

  await page.reload();
  await expect(page.locator('.graph-columns')).toContainText('DATE / TIME');
  await expect(page.locator('.graph-columns')).toContainText('SHA');
  await page.getByRole('button', { name: 'Configure graph columns' }).click();
  settings = page.getByRole('dialog', { name: 'Graph settings' });
  await expect(settings.getByRole('checkbox', { name: 'SHA' })).toBeChecked();
});

test('uses lean graph defaults on compact desktops without overriding an explicit metadata choice', async ({ page }) => {
  await page.setViewportSize({ width: 1051, height: 720 });
  await page.goto('/');
  await expect(page.locator('.graph-columns')).not.toContainText('AUTHOR');
  await expect(page.locator('.graph-columns')).not.toContainText('DATE / TIME');

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('.graph-columns')).toContainText('AUTHOR');
  await expect(page.locator('.graph-columns')).toContainText('DATE / TIME');
  await page.setViewportSize({ width: 1051, height: 720 });
  await expect(page.locator('.graph-columns')).not.toContainText('AUTHOR');
  await expect(page.locator('.graph-columns')).not.toContainText('DATE / TIME');

  await page.getByRole('button', { name: 'Configure graph columns' }).click();
  const settings = page.getByRole('dialog', { name: 'Graph settings' });
  const authorColumn = settings.getByRole('checkbox', { name: 'Author' });
  const dateColumn = settings.getByRole('checkbox', { name: 'Date / Time' });
  await expect(authorColumn).not.toBeChecked();
  await expect(dateColumn).not.toBeChecked();
  await authorColumn.check();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.setViewportSize({ width: 1051, height: 720 });
  await expect(page.locator('.graph-columns')).toContainText('AUTHOR');
  await expect(page.locator('.graph-columns')).not.toContainText('DATE / TIME');

  await page.reload();
  await expect(page.locator('.graph-columns')).toContainText('AUTHOR');
  await expect(page.locator('.graph-columns')).not.toContainText('DATE / TIME');
});

test('opens graph column controls from the header and dismisses them predictably', async ({ page }) => {
  const header = page.locator('.graph-columns');
  const settingsButton = page.getByRole('button', { name: 'Configure graph columns' });
  await expect.poll(() => settingsButton.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return Math.min(box.width, box.height);
  })).toBeGreaterThanOrEqual(24);

  await settingsButton.click();
  const settings = page.getByRole('dialog', { name: 'Graph settings' });
  await expect(settingsButton).toHaveAttribute('aria-expanded', 'true');
  await expect(settings).toBeFocused();
  await expect(settings).toHaveCSS('width', '252px');
  await expect(settings.locator('.fit-graph-column')).toHaveCSS('font-size', '13px');
  await expect(settings.getByLabel('Compact Graph Column')).toHaveCSS('font-size', '13px');
  await expect(settings.getByRole('button', { name: 'Restore graph defaults' })).toHaveCSS('font-size', '13px');
  const moveGraphLeft = settings.getByRole('button', { name: 'Move Graph column left' });
  await expect(moveGraphLeft).toBeEnabled();
  await moveGraphLeft.focus();
  await moveGraphLeft.press('Enter');
  const orderedHeadings = () => page.locator('.graph-columns > .draggable-column').evaluateAll((columns) =>
    [...columns].sort((left, right) => Number((left as HTMLElement).style.order) - Number((right as HTMLElement).style.order))
      .map((column) => column.querySelector('[role="separator"]')?.getAttribute('aria-label')),
  );
  await expect.poll(orderedHeadings).toEqual([
    'Resize Graph column',
    'Resize Branch and Tag column',
    'Resize Commit Message column',
  ]);
  await expect.poll(() => page.evaluate(() => JSON.parse(
    localStorage.getItem('git-khronos.graph.%2Fhome%2Fmaya%2Fprojects%2Fgit-khronos.column.order') ?? '[]',
  ))).toEqual(['graph', 'branch', 'message', 'author', 'date', 'sha']);
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await expect(settingsButton).toHaveAttribute('aria-expanded', 'false');
  await expect(settingsButton).toBeFocused();

  await header.getByText('GRAPH', { exact: true }).click({ button: 'right' });
  await expect(settings).toBeVisible();
  await expect(settings).toBeFocused();
  await expect(settings.getByText('Columns', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
});

test('reserves compact header space when graph columns are reordered', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 720 });
  await page.goto('/');

  await page.getByRole('button', { name: 'Configure graph columns' }).click();
  const settings = page.getByRole('dialog', { name: 'Graph settings' });
  await settings.getByRole('button', { name: 'Move Graph column left' }).click();
  await page.keyboard.press('Escape');

  const launcher = page.getByRole('button', { name: 'Open left panel' });
  const leadingHeading = page.locator('.graph-columns > .responsive-leading-column');
  await expect(leadingHeading).toHaveClass(/graph-column-heading/);
  await expect(leadingHeading.locator('.column-heading-label')).toHaveText('GRAPH');
  const [launcherBox, labelBox] = await Promise.all([
    launcher.boundingBox(),
    leadingHeading.locator('.column-heading-label').boundingBox(),
  ]);
  expect(launcherBox).not.toBeNull();
  expect(labelBox).not.toBeNull();
  expect(launcherBox!.x + launcherBox!.width).toBeLessThanOrEqual(labelBox!.x);
});

test('restores graph layout defaults without resetting unrelated preferences', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Configure graph columns' }).click();
  const settings = page.getByRole('dialog', { name: 'Graph settings' });
  await settings.getByLabel('Compact Graph Column').check();
  await settings.getByLabel('Scroll Markers').uncheck();
  await settings.getByRole('checkbox', { name: 'Date / Time', exact: true }).uncheck();
  await expect(page.locator('.graph-columns')).not.toContainText('DATE / TIME');

  await settings.getByRole('button', { name: 'Restore graph defaults' }).click();
  await expect(settings.getByLabel('Compact Graph Column')).not.toBeChecked();
  await expect(settings.getByLabel('Scroll Markers')).toBeChecked();
  await expect(settings.getByRole('checkbox', { name: 'Author', exact: true })).toBeChecked();
  await expect(settings.getByRole('checkbox', { name: 'Date / Time', exact: true })).toBeChecked();
  await expect(settings.getByRole('checkbox', { name: 'SHA', exact: true })).not.toBeChecked();
  await expect(page.locator('.graph-columns')).toContainText('DATE / TIME');
  await expect(settings).toContainText('Drag headers or use the arrow buttons to reorder columns.');
  await expect.poll(() => page.evaluate(() => ({
    compact: localStorage.getItem('git-khronos.graph.%2Fhome%2Fmaya%2Fprojects%2Fgit-khronos.column.graph.compact'),
    date: localStorage.getItem('git-khronos.graph.%2Fhome%2Fmaya%2Fprojects%2Fgit-khronos.column.date.visible'),
    markers: localStorage.getItem('git-khronos.graph.%2Fhome%2Fmaya%2Fprojects%2Fgit-khronos.scroll-markers'),
  }))).toEqual({ compact: null, date: null, markers: null });
});

test('resizes the graph directly from its row boundary and fits paths on double-click', async ({ page }) => {
  const graphHeading = page.locator('.graph-column-heading');
  const rowHandle = page.locator('.commit-row[data-commit-oid] .graph-row-resizer').first();
  const initialWidth = await graphHeading.evaluate((element) => element.getBoundingClientRect().width);
  const handleBox = await rowHandle.boundingBox();
  expect(handleBox).not.toBeNull();
  expect(handleBox!.width).toBeGreaterThanOrEqual(12);

  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox!.x - 30, handleBox!.y + handleBox!.height / 2);
  await page.mouse.up();

  const resizedWidth = await graphHeading.evaluate((element) => element.getBoundingClientRect().width);
  expect(resizedWidth).toBeLessThan(initialWidth - 20);
  await page.reload();
  await expect.poll(() => graphHeading.evaluate((element) => element.getBoundingClientRect().width)).toBe(resizedWidth);

  await page.locator('.commit-row[data-commit-oid] .graph-row-resizer').first().dblclick();
  await expect.poll(() => graphHeading.evaluate((element) => element.getBoundingClientRect().width)).toBe(initialWidth);
});

test('resizes graph columns with accessible keyboard separators', async ({ page }) => {
  const branchSeparator = page.getByRole('separator', { name: 'Resize Branch and Tag column' });
  await expect(branchSeparator).toHaveAttribute('aria-orientation', 'vertical');
  await expect(branchSeparator).toHaveAttribute('aria-valuemin', '75');
  await expect(branchSeparator).toHaveAttribute('aria-valuemax', '800');
  await expect(branchSeparator).toHaveAttribute('aria-valuenow', '180');
  expect((await branchSeparator.boundingBox())!.width).toBeGreaterThanOrEqual(12);
  await branchSeparator.focus();
  expect(await branchSeparator.evaluate((element) => getComputedStyle(element, '::after').width)).toBe('3px');
  await page.keyboard.press('ArrowRight');
  await expect(branchSeparator).toHaveAttribute('aria-valuenow', '188');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(branchSeparator).toHaveAttribute('aria-valuenow', '220');
  await page.keyboard.press('Home');
  await expect(branchSeparator).toHaveAttribute('aria-valuenow', '75');
  await page.keyboard.press('End');
  await expect(branchSeparator).toHaveAttribute('aria-valuenow', '800');
  await branchSeparator.dblclick();
  await expect(branchSeparator).toHaveAttribute('aria-valuenow', '180');
  await expect.poll(() => page.evaluate(() => {
    const key = Object.keys(localStorage).find((candidate) => candidate.endsWith('.column.branch.width'));
    return key ? localStorage.getItem(key) : null;
  })).toBe('180');

  const graphSeparator = page.getByRole('separator', { name: 'Resize Graph column' });
  await expect(graphSeparator).toHaveAttribute('aria-valuemin', '42');
  await graphSeparator.focus();
  await page.keyboard.press('Home');
  await expect(graphSeparator).toHaveAttribute('aria-valuenow', '42');
  await page.keyboard.press('ArrowRight');
  await expect(graphSeparator).toHaveAttribute('aria-valuenow', '50');
  await page.keyboard.press('End');
  await expect(graphSeparator).toHaveAttribute('aria-valuenow', await graphSeparator.getAttribute('aria-valuemax'));
  const maximumGraphWidth = await graphSeparator.getAttribute('aria-valuemax');
  await expect.poll(() => page.evaluate(() => {
    const key = Object.keys(localStorage).find((candidate) => candidate.endsWith('.column.graph.expanded.width'));
    return key ? localStorage.getItem(key) : null;
  })).toBe(maximumGraphWidth);
});

test('resizes the commit message column independently of unused graph space', async ({ page }) => {
  const messageSeparator = page.getByRole('separator', { name: 'Resize Commit Message column' });
  const messageHeading = page.locator('.graph-columns .draggable-column').filter({ hasText: 'COMMIT MESSAGE' });
  const settingsButton = page.getByRole('button', { name: 'Configure graph columns' });
  // A trailing heading also spans the 26px actions lane; measure the column's own track.
  const messageWidth = () => messageHeading.evaluate((heading) =>
    Math.round(heading.getBoundingClientRect().width - (heading.classList.contains('trailing-column') ? 26 : 0)));
  const expectSettingsPinnedRight = async () => {
    // The last heading also spans the settings strip, the header's only extra track.
    expect(await page.locator('.graph-columns').evaluate((header) =>
      getComputedStyle(header).gridTemplateColumns.split(' ').length
        === header.children.length + header.querySelectorAll(':scope > .trailing-column').length,
    )).toBe(true);
    await expect(page.locator('.graph-columns .graph-settings-toggle')).toHaveCount(0);
    await expect.poll(async () => {
      const header = (await page.locator('.graph-columns').boundingBox())!;
      const button = (await settingsButton.boundingBox())!;
      return Math.abs(header.x + header.width - button.x - button.width - 22);
    }).toBeLessThanOrEqual(1);
  };
  await expectSettingsPinnedRight();
  await expect(messageSeparator).toHaveAttribute('aria-valuemin', '180');
  await expect(messageSeparator).toHaveAttribute('aria-valuemax', '2400');
  const initialMessageWidth = (await messageWidth());
  await expect(messageSeparator).toHaveAttribute('aria-valuenow', String(initialMessageWidth));

  await messageSeparator.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(messageSeparator).toHaveAttribute('aria-valuenow', String(initialMessageWidth - 8));
  expect((await messageWidth())).toBe(initialMessageWidth - 8);
  await page.keyboard.press('Home');
  await expect(messageSeparator).toHaveAttribute('aria-valuenow', '180');
  expect((await messageWidth())).toBe(180);
  await expectSettingsPinnedRight();
  await page.keyboard.press('End');
  await expect(messageSeparator).toHaveAttribute('aria-valuenow', '2400');
  expect((await messageWidth())).toBe(2400);
  await expectSettingsPinnedRight();
  await page.keyboard.press('Home');
  await expect(messageSeparator).toHaveAttribute('aria-valuenow', '180');

  const handle = await messageSeparator.boundingBox();
  expect(handle).not.toBeNull();
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle!.x + handle!.width / 2 + 40, handle!.y + handle!.height / 2);
  await page.mouse.up();
  await expect(messageSeparator).toHaveAttribute('aria-valuenow', '220');
  expect((await messageWidth())).toBe(220);
  await page.reload();
  await expect(messageSeparator).toHaveAttribute('aria-valuenow', '220');
  expect((await messageWidth())).toBe(220);
  await expectSettingsPinnedRight();
  await messageSeparator.dblclick();
  await expect.poll(async () => Number(await messageSeparator.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(260);
  await expect.poll(() => page.evaluate(() => {
    const key = Object.keys(localStorage).find((candidate) => candidate.endsWith('.column.message.width'));
    return key ? localStorage.getItem(key) : null;
  })).toBeNull();
  await expectSettingsPinnedRight();
});

test('resizes the date column from its right edge without changing columns on its left', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto('/');
  const separator = page.getByRole('separator', { name: 'Resize Date and Time column' });
  const date = page.locator('.graph-columns .draggable-column').filter({ has: separator });
  const author = page.locator('.author-column-heading');
  const message = page.locator('.message-column-heading');
  await expect(separator).not.toHaveClass(/leading-edge/);
  const box = async (locator: typeof date) => (await locator.boundingBox())!;
  const left = async () => (await box(date)).x + await page.locator('.graph-columns').evaluate((header) => header.scrollLeft);
  const initialLeft = await left();
  const initialAuthor = (await box(author)).width;
  const messageWidth = (await box(message)).width;
  const handle = await box(separator);
  const initialDate = await box(date);
  expect(Math.abs(handle.x + handle.width / 2 - initialDate.x - initialDate.width + 26)).toBeLessThanOrEqual(1);
  const drag = async (delta: number) => {
    const current = await box(separator);
    const x = current.x + current.width / 2;
    const y = current.y + current.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + delta, y, { steps: 4 });
    await page.mouse.up();
  };
  const expectLeftFixed = async (expected = initialLeft) => {
    expect(Math.abs(await left() - expected)).toBeLessThanOrEqual(1);
    expect(Math.abs((await box(author)).width - initialAuthor)).toBeLessThanOrEqual(1);
    expect(Math.abs((await box(message)).width - messageWidth)).toBeLessThanOrEqual(1);
  };

  await expect(separator).toHaveAttribute('aria-valuenow', '100');
  await expect(date.locator('.column-heading-label')).toBeVisible();
  await expect(date.locator('.column-heading-icon')).toHaveCount(0);
  await drag(24);
  await expect(separator).toHaveAttribute('aria-valuenow', '124');
  await expectLeftFixed();

  // Narrowing stops at the width needed by the rendered dates and times.
  const minimum = Number(await separator.getAttribute('aria-valuemin'));
  expect(minimum).toBeGreaterThan(40);
  expect(minimum).toBeLessThan(100);
  await drag(-48);
  await expect(separator).toHaveAttribute('aria-valuenow', String(minimum));
  await expectLeftFixed();

  await expect(date).toHaveAttribute('title', 'Date / Time');
  await page.reload();
  await expect(separator).toHaveAttribute('aria-valuenow', String(minimum));
  await expectLeftFixed();

  await separator.focus();
  await page.keyboard.press('ArrowRight');
  await expect(separator).toHaveAttribute('aria-valuenow', String(minimum + 8));
  await expectLeftFixed();
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(separator).toHaveAttribute('aria-valuenow', String(minimum));
  await expectLeftFixed();
  await page.keyboard.press('ArrowLeft');
  await expect(separator).toHaveAttribute('aria-valuenow', String(minimum));
  await expectLeftFixed();

  await separator.dblclick();
  await expect(separator).toHaveAttribute('aria-valuenow', '100');
  await expectLeftFixed();

  // Free space does not silently enlarge the last column.
  await page.getByRole('separator', { name: 'Resize Author column', exact: true }).focus();
  await page.keyboard.press('Home');
  await expect(separator).toHaveAttribute('aria-valuenow', '100');
  const newLeft = await left();
  const newAuthor = (await box(author)).width;
  await separator.focus();
  const maximum = Number(await separator.getAttribute('aria-valuemax'));
  await page.keyboard.press('End');
  await expect(separator).toHaveAttribute('aria-valuenow', String(maximum));
  expect(Math.abs(await left() - newLeft)).toBeLessThanOrEqual(1);
  expect((await box(author)).width).toBe(newAuthor);
  await drag(-40);
  await expect(separator).toHaveAttribute('aria-valuenow', String(maximum - 40));
  expect(Math.abs(await left() - newLeft)).toBeLessThanOrEqual(1);
  expect((await box(author)).width).toBe(newAuthor);
  await page.keyboard.press('Home');
  await expect(separator).toHaveAttribute('aria-valuenow', String(minimum));
  expect(Math.abs(await left() - newLeft)).toBeLessThanOrEqual(1);
});

test('shows each graph heading title in full or as an icon with a tooltip', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Configure graph columns' }).click();
  await page.getByLabel('SHA', { exact: true }).check();
  await page.getByRole('button', { name: 'Configure graph columns' }).click();
  const headingsFit = () => page.locator('.graph-columns > .draggable-column').evaluateAll((columns) => columns.map((column) => {
    const label = column.querySelector<HTMLElement>('.column-heading-label');
    if (!label) return 'message';
    if (label.classList.contains('sr-only')) {
      return column.querySelector('.column-heading-icon svg') && column.getAttribute('title') ? 'icon' : `missing icon: ${label.textContent}`;
    }
    return label.scrollWidth <= label.clientWidth ? 'text' : `truncated: ${label.textContent}`;
  }));
  const assertFit = async () => {
    for (const result of await headingsFit()) expect(result).toMatch(/^(message|text|icon)$/);
  };
  await assertFit();
  const date = page.locator('.graph-columns .draggable-column').filter({ hasText: 'DATE / TIME' });
  await expect(date.locator('.column-heading-label')).toBeVisible();
  await expect(date.locator('.column-heading-icon')).toHaveCount(0);
  // Date / Time never narrows below its dates and times, which is already wide enough for its full title.
  await page.getByRole('separator', { name: 'Resize Date and Time column', exact: true }).focus();
  await page.keyboard.press('Home');
  await expect(date.locator('.column-heading-label')).toBeVisible();
  await expect(date.locator('.column-heading-icon')).toHaveCount(0);
  await assertFit();
  for (const name of ['Resize Branch and Tag column', 'Resize Graph column', 'Resize Author column', 'Resize Date and Time column', 'Resize SHA column']) {
    const separator = page.getByRole('separator', { name, exact: true });
    await separator.focus();
    await page.keyboard.press('Home');
    await assertFit();
    for (let step = 0; step < 4; step++) {
      await page.keyboard.press('ArrowRight');
      await assertFit();
    }
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    await assertFit();
  }
  const branch = page.locator('.graph-columns .draggable-column').filter({ hasText: 'BRANCH / TAG' });
  await page.getByRole('separator', { name: 'Resize Branch and Tag column', exact: true }).focus();
  await page.keyboard.press('Home');
  await expect(branch.locator('.column-heading-icon')).toBeVisible();
  await expect(branch).toHaveAttribute('title', 'Branch / Tag');
  await page.keyboard.press('End');
  await expect(branch.locator('.column-heading-icon')).toHaveCount(0);
  await expect(branch.locator('.column-heading-label')).toBeVisible();
});

test('resizes every graph column independently with flexible and narrow commit messages', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  const labels = [
    'Resize Branch and Tag column', 'Resize Graph column', 'Resize Commit Message column',
    'Resize Author column', 'Resize Date and Time column', 'Resize SHA column',
  ];
  for (const narrowMessage of [false, true]) {
    await page.goto('/');
    await page.getByRole('button', { name: 'Configure graph columns' }).click();
    await page.getByLabel('SHA', { exact: true }).check();
    await page.getByRole('button', { name: 'Configure graph columns' }).click();
    if (narrowMessage) {
      await page.getByRole('separator', { name: labels[2], exact: true }).focus();
      await page.keyboard.press('Home');
    }
    for (const label of labels) {
      const separator = page.getByRole('separator', { name: label, exact: true });
      const heading = separator.locator('..');
      // Scroll the history, which the header mirrors, until the handle is clear of the settings button.
      await heading.evaluate((column) => {
        const list = document.querySelector<HTMLElement>('.commit-list')!;
        const visibleRight = list.getBoundingClientRect().left + list.clientWidth - 48;
        const overflow = column.querySelector('.column-resizer')!.getBoundingClientRect().right - visibleRight;
        if (overflow > 0) {
          list.scrollLeft += overflow;
          list.dispatchEvent(new Event('scroll'));
        }
      });
      await expect.poll(() => page.evaluate(() =>
        document.querySelector('.graph-columns')!.scrollLeft - document.querySelector('.commit-list')!.scrollLeft)).toBe(0);
      const before = (await heading.boundingBox())!;
      const scrollBefore = await page.locator('.graph-columns').evaluate((header) => header.scrollLeft);
      const columnIndex = await heading.evaluate((column) =>
        [...column.parentElement!.querySelectorAll(':scope > .draggable-column')].indexOf(column),
      );
      const widths = await page.locator('.graph-columns > .draggable-column').evaluateAll((columns) =>
        columns.map((column) => Math.round(column.getBoundingClientRect().width)),
      );
      const handle = (await separator.boundingBox())!;
      const x = handle.x + handle.width / 2;
      const y = handle.y + handle.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 16, y, { steps: 4 });
      await page.mouse.up();
      const after = (await heading.boundingBox())!;
      expect(Math.round(after.width), label).toBe(Math.round(before.width) + 16);
      const scrollAfter = await page.locator('.graph-columns').evaluate((header) => header.scrollLeft);
      // Columns are never pinned, so every other column keeps its left edge in the scrolled content.
      expect(Math.abs(after.x + scrollAfter - before.x - scrollBefore), label).toBeLessThanOrEqual(1);
      const newWidths = await page.locator('.graph-columns > .draggable-column').evaluateAll((columns) =>
        columns.map((column) => Math.round(column.getBoundingClientRect().width)),
      );
      expect(newWidths).toEqual(widths.map((width, index) => width + (index === columnIndex ? 16 : 0)));
      await separator.focus();
      await page.keyboard.press('ArrowLeft');
      expect(Math.round((await heading.boundingBox())!.width)).toBe(Math.round(before.width) + 8);
    }
    const author = page.getByRole('separator', { name: labels[3], exact: true });
    await author.focus();
    for (let step = 0; step < 8; step++) await page.keyboard.press('Shift+ArrowRight');
    expect(Number(await author.getAttribute('aria-valuenow'))).toBeGreaterThan(220);
    await page.getByRole('button', { name: 'Configure graph columns' }).click();
    await page.getByRole('button', { name: 'Restore graph defaults' }).click();
    await page.getByRole('button', { name: 'Configure graph columns' }).click();
  }
});

test('resizes repository side panels with accessible keyboard splitters', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const leftPanel = page.locator('#repository-reference-panel');
  const leftSplitter = page.getByRole('separator', { name: 'Resize left panel' });
  const authorColumn = page.getByRole('separator', { name: 'Resize Author column' });
  const dateColumn = page.getByRole('separator', { name: 'Resize Date and Time column' });
  await expect(authorColumn).toBeVisible();
  await expect(dateColumn).toBeVisible();
  await expect(leftSplitter).toHaveAttribute('aria-controls', 'repository-reference-panel');
  await expect(leftSplitter).toHaveAttribute('aria-orientation', 'vertical');
  await expect(leftSplitter).toHaveAttribute('aria-valuemin', '170');
  await expect(leftSplitter).toHaveAttribute('aria-valuemax', '420');
  await expect(leftSplitter).toHaveAttribute('aria-valuenow', '250');
  expect((await leftSplitter.boundingBox())!.width).toBeGreaterThanOrEqual(12);
  expect(await leftSplitter.evaluate((element) => getComputedStyle(element).backgroundSize)).toBe('3px 28px');
  await leftSplitter.focus();
  expect(await leftSplitter.evaluate((element) => getComputedStyle(element, '::after').width)).toBe('3px');
  expect(await leftSplitter.evaluate((element) => getComputedStyle(element, '::after').backgroundColor))
    .toBe(await resolvedCssColor(page, 'var(--focus-ring)'));
  await page.keyboard.press('ArrowRight');
  await expect(leftSplitter).toHaveAttribute('aria-valuenow', '260');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(leftSplitter).toHaveAttribute('aria-valuenow', '292');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('git-khronos.panel.sidebar.width'))).toBe('292');
  await page.keyboard.press('Home');
  await expect(leftSplitter).toHaveAttribute('aria-valuenow', '170');
  await page.keyboard.press('End');
  await expect(leftSplitter).toHaveAttribute('aria-valuenow', '420');
  await expect(authorColumn).toBeHidden();
  await expect(dateColumn).toBeHidden();
  await leftSplitter.dblclick();
  await expect(leftSplitter).toHaveAttribute('aria-valuenow', '250');
  await expect.poll(() => leftPanel.evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(250);
  await expect(authorColumn).toBeVisible();
  await expect(dateColumn).toBeVisible();
  const splitterBounds = (await leftSplitter.boundingBox())!;
  await page.mouse.move(splitterBounds.x + splitterBounds.width / 2, splitterBounds.y + splitterBounds.height / 2);
  await page.mouse.down();
  await expect(leftSplitter).toHaveCSS('background-color', await resolvedCssColor(page, 'var(--splitter-active)'));
  await page.mouse.up();

  const commitPanel = page.locator('#repository-commit-panel');
  const commitSplitter = page.getByRole('separator', { name: 'Resize commit panel' });
  await expect(commitSplitter).toHaveAttribute('aria-controls', 'repository-commit-panel');
  await expect(commitSplitter).toHaveAttribute('aria-valuenow', '355');
  expect((await commitSplitter.boundingBox())!.width).toBeGreaterThanOrEqual(12);
  await commitSplitter.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(commitSplitter).toHaveAttribute('aria-valuenow', '365');
  await page.keyboard.press('ArrowRight');
  await expect(commitSplitter).toHaveAttribute('aria-valuenow', '355');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('git-khronos.panel.details.width'))).toBe('355');
  await expect.poll(() => commitPanel.evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(355);
});

test('keeps the stage-all action readable at the minimum commit-panel width', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const commitPanel = page.locator('#repository-commit-panel');
  const splitter = page.getByRole('separator', { name: 'Resize commit panel' });
  const stageAll = commitPanel.getByRole('button', { name: 'Stage all changes' });
  const fullLabel = stageAll.locator('.file-section-bulk-full');
  const compactLabel = stageAll.locator('.file-section-bulk-compact');

  await expect(fullLabel).toBeVisible();
  await expect(compactLabel).toBeHidden();
  await splitter.focus();
  await page.keyboard.press('Home');
  await expect(splitter).toHaveAttribute('aria-valuenow', '280');
  await expect.poll(() => commitPanel.evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(280);
  await expect(fullLabel).toBeHidden();
  await expect(compactLabel).toBeVisible();
  await expect(stageAll).toHaveAccessibleName('Stage all changes');
  expect(await commitPanel.locator('.unstaged-section .file-section-title').evaluate((element) =>
    element.scrollWidth <= element.clientWidth)).toBe(true);
});

test('resizes and restores the repository terminal with an accessible splitter', async ({ page }) => {
  const openTerminal = page.getByTitle('Open repository terminal (Alt+T or Ctrl+`)');
  await expect(openTerminal).toHaveAttribute('aria-pressed', 'false');
  await openTerminal.click();

  let panel = page.getByLabel('Repository terminals');
  let splitter = page.getByRole('separator', { name: 'Resize terminal' });
  await expect(panel).toBeVisible();
  await expect(page.getByTitle('Hide repository terminal (Alt+T or Ctrl+`)')).toHaveAttribute('aria-pressed', 'true');
  const panelId = await panel.getAttribute('id');
  expect(panelId).toMatch(/^repository-terminal-panel-/);
  await expect(splitter).toHaveAttribute('aria-controls', panelId!);
  await expect(splitter).toHaveAttribute('aria-orientation', 'horizontal');
  await expect(splitter).toHaveAttribute('aria-valuemin', '150');
  expect((await splitter.boundingBox())!.height).toBeGreaterThanOrEqual(12);
  await expect(panel.getByRole('button', { name: 'New terminal tab' })).toHaveAttribute('aria-keyshortcuts', 'Control+Shift+T');
  await expect(panel.locator('.terminal-empty-tab')).toHaveText('Terminal');
  const hideTerminal = panel.getByRole('button', { name: 'Hide terminal panel' });
  await expect(hideTerminal).toBeVisible();
  await page.keyboard.press('Tab');
  await hideTerminal.focus();
  await expect(hideTerminal).toHaveCSS('outline-style', 'solid');
  const minimizeTerminal = panel.getByRole('button', { name: 'Minimize terminal' });
  await expect(minimizeTerminal).toHaveAttribute('aria-expanded', 'true');
  await expect(minimizeTerminal).toHaveAttribute('aria-controls', `${panelId}-body`);
  await page.keyboard.press('Tab');
  await minimizeTerminal.focus();
  await expect(minimizeTerminal).toHaveCSS('outline-style', 'solid');
  await expect(panel.getByRole('status')).toContainText('Terminal sessions are available in the desktop app.');
  await expect(panel.locator('.terminal-context')).toHaveCSS('font-size', '12px');
  await expect(panel.locator('.terminal-error')).toHaveCSS('font-size', '12px');
  await splitter.focus();

  await page.keyboard.press('Home');
  expect(await splitter.evaluate((element) => getComputedStyle(element, '::after').height)).toBe('3px');
  await expect(splitter).toHaveAttribute('aria-valuenow', '150');
  await page.keyboard.press('ArrowUp');
  await expect(splitter).toHaveAttribute('aria-valuenow', '160');
  await page.keyboard.press('Shift+ArrowUp');
  await expect(splitter).toHaveAttribute('aria-valuenow', '192');
  await expect.poll(() => page.evaluate(() =>
    localStorage.getItem('git-khronos.terminal.panel-height'),
  )).toBe('192');
  await expect.poll(() => panel.evaluate((element) => Math.round(element.getBoundingClientRect().height))).toBe(192);

  await page.reload();
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.getByTitle('Open repository terminal (Alt+T or Ctrl+`)').click();
  panel = page.getByLabel('Repository terminals');
  splitter = page.getByRole('separator', { name: 'Resize terminal' });
  await expect(splitter).toHaveAttribute('aria-valuenow', '192');
  await expect.poll(() => panel.evaluate((element) => Math.round(element.getBoundingClientRect().height))).toBe(192);

  const maximum = await splitter.getAttribute('aria-valuemax');
  await splitter.focus();
  await page.keyboard.press('End');
  await expect(splitter).toHaveAttribute('aria-valuenow', maximum!);
  await splitter.dblclick();
  await expect(splitter).toHaveAttribute('aria-valuenow', '280');
  await expect.poll(() => page.evaluate(() =>
    localStorage.getItem('git-khronos.terminal.panel-height'),
  )).toBeNull();

  await panel.getByRole('button', { name: 'Hide terminal panel' }).click();
  await expect(panel).toBeAttached();
  await expect(panel).toBeHidden();
  await expect(openTerminal).toBeFocused();
  await expect(openTerminal).toHaveAttribute('aria-pressed', 'false');
  await openTerminal.click();
  await expect(panel).toBeVisible();

  await panel.getByRole('button', { name: 'Minimize terminal' }).click();
  await expect(panel.getByRole('button', { name: 'Restore terminal' })).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(() => panel.evaluate((element) => Math.round(element.getBoundingClientRect().height))).toBe(32);
  await panel.getByRole('button', { name: 'Restore terminal' }).click();
  await expect(panel.getByRole('button', { name: 'Minimize terminal' })).toHaveAttribute('aria-expanded', 'true');
});

test('keeps terminal session controls reachable in compact windows', async ({ page }) => {
  await page.setViewportSize({ width: 550, height: 560 });
  await page.getByRole('button', { name: 'More repository actions' }).click();
  await page.getByRole('menu', { name: 'More repository actions' })
    .getByRole('menuitem', { name: /Open repository terminal/ }).click();
  const panel = page.getByLabel('Repository terminals');
  const header = panel.locator('header');
  const newTerminal = panel.getByRole('button', { name: 'New terminal tab' });
  await expect(panel).toBeVisible();
  await expect(newTerminal).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Hide terminal panel' })).toBeVisible();
  expect(await header.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  const [headerBounds, newTerminalBounds] = await Promise.all([
    header.boundingBox(),
    newTerminal.boundingBox(),
  ]);
  expect(headerBounds).not.toBeNull();
  expect(newTerminalBounds).not.toBeNull();
  expect(newTerminalBounds!.x + newTerminalBounds!.width)
    .toBeLessThanOrEqual(headerBounds!.x + headerBounds!.width);

  await panel.locator('.terminal-tabs').evaluate((tabs) => {
    for (let index = 1; index <= 6; index++) {
      const tab = document.createElement('div');
      tab.className = 'terminal-tab';
      tab.textContent = `Terminal ${index}`;
      tabs.append(tab);
    }
    tabs.dispatchEvent(new Event('scroll'));
  });
  const previousTabs = panel.getByRole('button', { name: 'Show previous terminal tabs' });
  const nextTabs = panel.getByRole('button', { name: 'Show next terminal tabs' });
  await expect(previousTabs).toBeVisible();
  await expect(previousTabs).toBeDisabled();
  await expect(nextTabs).toBeEnabled();
  await nextTabs.click();
  await expect.poll(() => panel.locator('.terminal-tabs').evaluate((tabs) => tabs.scrollLeft)).toBeGreaterThan(0);
  await expect(previousTabs).toBeEnabled();
  expect(await header.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test('keeps the active terminal tab visible when the window narrows', async ({ page }) => {
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    let terminal = 0;
    app.git.systemInfo.set({
      appVersion: 'renderer test',
      gitVersion: '2.50.0',
      gitSupported: true,
      minimumGitVersion: '2.39.0',
    });
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string) => {
        if (command === 'open_terminal') {
          terminal += 1;
          return Promise.resolve({
            id: `resize-terminal-${terminal}`,
            label: 'bash',
            cwd: '/home/maya/projects/git-khronos',
          });
        }
        if (command === 'plugin:event|listen') return Promise.resolve(terminal + 100);
        if (command === 'plugin:event|unlisten') return Promise.resolve(null);
        if (command === 'resize_terminal' || command === 'write_terminal' || command === 'close_terminal') {
          return Promise.resolve(null);
        }
        return Promise.reject(new Error(`Unexpected command: ${command}`));
      },
      transformCallback: () => terminal + 100,
      unregisterCallback: () => undefined,
    };
  });

  await page.getByTitle('Open repository terminal (Alt+T or Ctrl+`)').click();
  const panel = page.getByLabel('Repository terminals');
  await expect(panel).toBeVisible();
  const newTerminal = panel.getByRole('button', { name: 'New terminal tab' });
  await page.keyboard.press('Tab');
  await newTerminal.focus();
  await expect(newTerminal).toHaveCSS('outline-style', 'solid');
  await expect(newTerminal).toHaveCSS('outline-width', '2px');
  await expect(panel.getByRole('tab', { name: 'bash 1' })).toBeVisible();
  await expect(panel.locator('.terminal-empty-tab')).toHaveCount(0);
  await page.evaluate(async () => {
    const terminalPanel = (window as any).ng.getComponent(document.querySelector('gc-terminal-panel'));
    const firstTerminal = terminalPanel.tabs()[0].terminal;
    await new Promise<void>((resolve) => firstTerminal.write('\u001b]0;API logs\u0007', resolve));
  });
  const titledTab = panel.getByRole('tab', { name: 'API logs' });
  await expect(titledTab).toBeVisible();
  await expect(titledTab).toHaveAttribute('title', 'API logs · /home/maya/projects/git-khronos');
  await expect(panel.getByRole('button', { name: 'Close API logs' })).toBeVisible();
  for (let index = 0; index < 7; index++) {
    await panel.getByRole('button', { name: 'New terminal tab' }).click();
  }
  const activeTab = panel.getByRole('tab', { name: /bash 8/ });
  await expect(activeTab).toHaveAttribute('aria-selected', 'true');
  const activeClose = panel.getByRole('button', { name: 'Close bash 8' });
  const inactiveTab = panel.getByRole('tab', { name: /bash 7/ });
  const inactiveTabShell = inactiveTab.locator('..');
  const inactiveClose = panel.getByRole('button', { name: 'Close bash 7' });
  await expect(activeClose).toHaveCSS('opacity', '1');
  await expect(inactiveClose).toHaveCSS('opacity', '0');
  await inactiveTabShell.hover();
  await expect(inactiveClose).toHaveCSS('opacity', '1');
  await page.mouse.move(0, 0);
  await inactiveTab.focus();
  await expect(inactiveClose).toHaveCSS('opacity', '1');
  await page.keyboard.press('Tab');
  await inactiveClose.focus();
  await expect(inactiveClose).toHaveCSS('outline-style', 'solid');

  await page.setViewportSize({ width: 780, height: 650 });
  const tabStrip = panel.locator('.terminal-tabs');
  await expect.poll(async () => {
    const [stripBounds, tabBounds] = await Promise.all([tabStrip.boundingBox(), activeTab.boundingBox()]);
    return !!stripBounds && !!tabBounds
      && tabBounds.x >= stripBounds.x - 1
      && tabBounds.x + tabBounds.width <= stripBounds.x + stripBounds.width + 1;
  }).toBe(true);
  await expect.poll(() => tabStrip.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await expect(panel.getByRole('button', { name: 'Show previous terminal tabs' })).toBeEnabled();

  await page.setViewportSize({ width: 360, height: 560 });
  await expect(panel.locator('.terminal-context')).toBeHidden();
  await expect.poll(async () => {
    const [stripBounds, tabBounds] = await Promise.all([tabStrip.boundingBox(), activeTab.boundingBox()]);
    return !!stripBounds && !!tabBounds
      && tabBounds.x >= stripBounds.x - 1
      && tabBounds.x + tabBounds.width <= stripBounds.x + stripBounds.width + 1;
  }).toBe(true);
  await expect(newTerminal).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Minimize terminal' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Hide terminal panel' })).toBeVisible();
});

test('keeps graph headers aligned while wide histories scroll horizontally', async ({ page }) => {
  await page.getByRole('button', { name: 'Configure graph columns' }).click();
  const settings = page.locator('.column-settings');
  await settings.getByRole('checkbox', { name: 'Author', exact: true }).check();
  await settings.getByRole('checkbox', { name: 'SHA', exact: true }).check();
  await page.getByRole('button', { name: 'Configure graph columns' }).click();
  await expect(settings).toBeHidden();

  const list = page.locator('.commit-list');
  const shell = page.locator('.commit-list-shell');
  const header = page.locator('.graph-columns');
  const settingsButton = page.getByRole('button', { name: 'Configure graph columns' });
  const leadingHeader = header.locator('.leading-branch-column');
  const leadingCell = page.locator('.commit-row[data-commit-oid] .branch-column.leading-branch-column').first();
  expect(await list.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await expect(shell).not.toHaveClass(/can-scroll-left/);
  await expect(shell).toHaveClass(/can-scroll-right/);
  expect(await shell.evaluate((element) => getComputedStyle(element, '::before').opacity)).toBe('0');
  await expect.poll(() => shell.evaluate((element) => getComputedStyle(element, '::after').opacity)).toBe('1');
  await expect(list).toHaveCSS('scrollbar-color', 'rgb(75, 73, 101) rgb(23, 23, 35)');
  const shellX = await shell.evaluate((element) => element.getBoundingClientRect().x);
  const scrollOffset = await list.evaluate((element) => {
    element.scrollLeft = Math.min(64, element.scrollWidth - element.clientWidth);
    element.dispatchEvent(new Event('scroll'));
    return element.scrollLeft;
  });
  expect(scrollOffset).toBeGreaterThan(0);
  await expect.poll(() => header.evaluate((element) => element.scrollLeft)).toBe(scrollOffset);
  await expect(shell).toHaveClass(/can-scroll-left/);
  await expect.poll(() => shell.evaluate((element) => getComputedStyle(element, '::before').opacity)).toBe('1');
  const [headerBoxAfterScroll, settingsBoxAfterScroll] = await Promise.all([
    header.boundingBox(),
    settingsButton.boundingBox(),
  ]);
  expect(headerBoxAfterScroll).not.toBeNull();
  expect(settingsBoxAfterScroll).not.toBeNull();
  expect(Math.abs(settingsBoxAfterScroll!.x + settingsBoxAfterScroll!.width -
    (headerBoxAfterScroll!.x + headerBoxAfterScroll!.width - 22))).toBeLessThanOrEqual(1);
  // The leading column scrolls with the history instead of staying pinned over the columns after it.
  await expect.poll(() => leadingHeader.evaluate((element) => element.getBoundingClientRect().x)).toBeLessThan(shellX);
  await expect.poll(async () => Math.abs(
    await leadingHeader.evaluate((element) => element.getBoundingClientRect().x)
    - await leadingCell.evaluate((element) => element.getBoundingClientRect().x),
  )).toBeLessThanOrEqual(1);

  const [headerMessageX, rowMessageX] = await Promise.all([
    header.getByText('COMMIT MESSAGE', { exact: true }).evaluate((element) => element.getBoundingClientRect().x),
    page.locator('.commit-row[data-commit-oid] .commit-main').first().evaluate((element) => element.getBoundingClientRect().x),
  ]);
  expect(Math.abs(headerMessageX - rowMessageX)).toBeLessThanOrEqual(1);

  await list.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
    element.dispatchEvent(new Event('scroll'));
  });
  await expect(shell).not.toHaveClass(/can-scroll-right/);
  await expect.poll(() => shell.evaluate((element) => getComputedStyle(element, '::after').opacity)).toBe('0');
  const settingsBoxAtEnd = (await settingsButton.boundingBox())!;
  expect(Math.abs(settingsBoxAtEnd.x - settingsBoxAfterScroll!.x)).toBeLessThanOrEqual(1);
  await settingsButton.focus();
  await page.keyboard.press('Enter');
  await expect(settings).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settingsButton).toBeFocused();
});

test('keeps compact history controls clear of the side-by-side commit inspector', async ({ page }) => {
  for (const width of [820, 780]) {
    await page.setViewportSize({ width, height: 720 });
    await page.goto('/');

    const history = page.locator('.history-panel');
    const inspector = page.locator('.detail-panel:not(.panel-hidden)');
    const settingsButton = page.getByRole('button', { name: 'Configure graph columns' });
    const [historyBox, inspectorBox, settingsBox] = await Promise.all([
      history.boundingBox(),
      inspector.boundingBox(),
      settingsButton.boundingBox(),
    ]);
    expect(historyBox).not.toBeNull();
    expect(inspectorBox).not.toBeNull();
    expect(settingsBox).not.toBeNull();
    expect(historyBox!.x + historyBox!.width).toBeLessThanOrEqual(inspectorBox!.x);
    expect(settingsBox!.x + settingsBox!.width).toBeLessThanOrEqual(inspectorBox!.x - 4);
    expect(Math.abs(settingsBox!.x + settingsBox!.width -
      (historyBox!.x + historyBox!.width - 22))).toBeLessThanOrEqual(1);

    await settingsButton.click();
    await expect(page.getByRole('dialog', { name: 'Graph settings' })).toBeVisible();
  }
});

test('uses a full-width inspector drawer in compact windows', async ({ page }) => {
  for (const width of [760, 700, 661, 550, 420]) {
    await page.setViewportSize({ width, height: 720 });
    await page.goto('/');

    const panel = page.locator('.detail-panel');
    if (await panel.isHidden()) await page.getByTitle(/Show Commit Panel/).click();
    const inspector = page.locator('.detail-panel:not(.panel-hidden)');
    await expect.poll(() => inspector.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { left: Math.round(box.left), right: Math.round(box.right), width: Math.round(box.width) };
    })).toEqual({ left: 0, right: width, width });
    await expect(page.locator('.history-panel')).toHaveAttribute('inert', '');

    await page.getByRole('button', { name: 'Close commit panel' }).click();
    await expect(inspector).toBeHidden();
    await expect(page.locator('.history-panel')).not.toHaveAttribute('inert', '');
    await expect.poll(() => page.locator('.history-panel').evaluate((element) =>
      Math.round(element.getBoundingClientRect().width),
    )).toBe(width);
    await page.getByRole('button', { name: 'Show Commit Panel', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Close commit panel' })).toBeFocused();
    await expect(page.locator('.history-panel')).toHaveAttribute('inert', '');
    await page.getByRole('button', { name: 'Close commit panel' }).click();
    await page.getByRole('button', { name: 'Configure graph columns' }).click();
    await expect(page.getByRole('dialog', { name: 'Graph settings' })).toBeVisible();
  }
});

test('keeps the history and inspector side by side above the compact breakpoint', async ({ page }) => {
  await page.setViewportSize({ width: 761, height: 720 });
  await page.goto('/');

  const panel = page.locator('.detail-panel');
  if (await panel.isHidden()) await page.getByTitle(/Show Commit Panel/).click();
  const inspector = page.locator('.detail-panel:not(.panel-hidden)');
  const history = page.locator('.history-panel');
  const [inspectorBox, historyBox] = await Promise.all([inspector.boundingBox(), history.boundingBox()]);

  expect(inspectorBox).not.toBeNull();
  expect(historyBox).not.toBeNull();
  expect(inspectorBox!.x).toBeGreaterThan(0);
  expect(historyBox!.width).toBeGreaterThan(0);
  expect(historyBox!.x + historyBox!.width).toBeLessThanOrEqual(inspectorBox!.x + 1);
  await expect(history).not.toHaveAttribute('inert', '');
});

test('compacts graph lanes and persists the graph layout', async ({ page }) => {
  const graphHeading = page.locator('.graph-column-heading');
  const laneNodes = page.locator('.commit-row[data-commit-oid] .author-node');
  const titleClearanceViolations = () => page.locator('.commit-row').evaluateAll((rows) =>
    rows.filter((row) => {
      const node = row.querySelector<HTMLElement>('.node');
      const title = row.querySelector<HTMLElement>('.commit-main .subject');
      if (!node || !title) return false;

      // Leave room for the active HEAD ring as well as the author circle itself.
      return node.getBoundingClientRect().right + 8 > title.getBoundingClientRect().left;
    }).map((row) => row.getAttribute('data-commit-oid') ?? row.textContent?.trim().slice(0, 40)),
  );
  await expect(graphHeading).toHaveCSS('width', '112px');
  expect(await titleClearanceViolations()).toEqual([]);

  const expandedOffsets = await laneNodes.evaluateAll((nodes) =>
    nodes.map((node) => Number(node.getAttribute('data-lane-offset'))),
  );
  await page.getByRole('button', { name: 'Configure graph columns' }).click();
  await expect(page.getByRole('button', { name: /Fit all \d+ branch paths?/ })).toBeVisible();
  await page.getByLabel('Compact Graph Column').check();

  await expect(page.locator('.commit-list')).toHaveClass(/compact-graph/);
  await expect(graphHeading).toHaveCSS('width', '92px');
  await expect(laneNodes.first()).toHaveCSS('font-size', '10px');
  expect(await laneNodes.evaluateAll((nodes) => nodes.every((node) => node.scrollWidth <= node.clientWidth))).toBe(true);
  const compactOffsets = await laneNodes.evaluateAll((nodes) =>
    nodes.map((node) => Number(node.getAttribute('data-lane-offset'))),
  );
  expect(Math.max(...compactOffsets)).toBeLessThan(Math.max(...expandedOffsets));
  expect(await titleClearanceViolations()).toEqual([]);
  await page.getByRole('button', { name: /Fit all \d+ branch paths?/ }).click();
  expect(await titleClearanceViolations()).toEqual([]);

  await page.reload();
  await expect(graphHeading).toHaveCSS('width', '92px');
  await page.getByRole('button', { name: 'Configure graph columns' }).click();
  await expect(page.getByLabel('Compact Graph Column')).toBeChecked();
});

test('provides distinct colors for wide commit graphs', async ({ page }) => {
  const colors = await page.evaluate(() => Array.from({ length: 12 }, (_, index) => {
    const marker = document.createElement('i');
    marker.className = `color-${index}`;
    document.body.append(marker);
    const color = getComputedStyle(marker).getPropertyValue('--graph-lane-color').trim();
    marker.remove();
    return color;
  }));

  expect(colors.every(Boolean)).toBe(true);
  expect(new Set(colors).size).toBe(12);
});

test('formats graph dates with a persisted UI preference', async ({ page }) => {
  const date = page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"] .row-date');
  await page.getByRole('button', { name: 'Configure graph columns' }).click();
  await page.getByRole('checkbox', { name: 'Date / Time', exact: true }).check();
  await page.getByRole('button', { name: 'Configure graph columns' }).click();
  await page.locator('button.chrome-icon[title="Preferences"]').click();
  let preferences = page.getByRole('dialog', { name: 'Preferences' });
  await preferences.getByRole('tab', { name: /Commit Graph/ }).click();
  const format = preferences.getByLabel('Commit graph date format');
  await format.selectOption('iso');
  await expect(date.locator('span')).toHaveText(/^2026-10-\d{2}$/);
  await expect(date.locator('small')).toHaveText(/^\d{2}:\d{2} Z$/);

  await page.reload();
  await expect(date.locator('span')).toHaveText(/^2026-10-\d{2}$/);
  await page.locator('button.chrome-icon[title="Preferences"]').click();
  preferences = page.getByRole('dialog', { name: 'Preferences' });
  await preferences.getByRole('tab', { name: /Commit Graph/ }).click();
  await expect(preferences.getByLabel('Commit graph date format')).toHaveValue('iso');
  await preferences.getByLabel('Commit graph date format').selectOption('relative');
  await expect(date.locator('span')).toHaveText(/ago|yesterday|today|tomorrow|in |last (?:wk\.|week|month|year)/i);
});

test('persists privacy-preserving commit author markers', async ({ page }) => {
  const nodes = page.locator('.commit-row[data-commit-oid] .author-node');
  await expect(nodes.first()).not.toHaveText('');
  await expect(nodes.first()).toHaveCSS('width', '24px');
  await expect(nodes.first()).toHaveCSS('height', '24px');
  await expect(nodes.first()).toHaveCSS('font-size', '11px');
  await expect(nodes.first()).toHaveCSS('overflow', 'hidden');
  expect(await nodes.evaluateAll((markers) => markers.every((node) => {
    const testNode = node.cloneNode(true) as HTMLElement;
    testNode.textContent = 'WW';
    testNode.style.visibility = 'hidden';
    node.parentElement?.append(testNode);
    const initialsFit = testNode.scrollWidth <= testNode.clientWidth;
    testNode.remove();
    return initialsFit;
  }))).toBe(true);
  const identityMarker = page.locator('.identity-chip > span');
  await expect(identityMarker).toHaveCSS('font-size', '11px');
  expect(await identityMarker.evaluate((marker) => marker.scrollWidth <= marker.clientWidth)).toBe(true);

  await page.locator('button.chrome-icon[title="Preferences"]').click();
  let preferences = page.getByRole('dialog', { name: 'Preferences' });
  await preferences.getByRole('tab', { name: /Commit Graph/ }).click();
  await preferences.getByLabel('Commit author marker style').selectOption('color');
  await expect(nodes.first()).toHaveClass(/color-marker/);
  await expect(nodes.first()).toHaveText('');

  await page.reload();
  await expect(nodes.first()).toHaveClass(/color-marker/);
  await page.locator('button.chrome-icon[title="Preferences"]').click();
  preferences = page.getByRole('dialog', { name: 'Preferences' });
  await preferences.getByRole('tab', { name: /Commit Graph/ }).click();
  await expect(preferences.getByLabel('Commit author marker style')).toHaveValue('color');
  await preferences.getByLabel('Commit author marker style').selectOption('initials');
  await expect(nodes.first()).not.toHaveText('');
});

test('shows shortcuts for the active desktop platform', async ({ page }) => {
  await expect(page.getByTitle('New repository tab (Ctrl+T)')).toHaveAttribute('aria-keyshortcuts', 'Control+T Meta+T');
  const commandPaletteTrigger = page.getByTitle('Command palette (Ctrl+P)');
  await expect(commandPaletteTrigger).toHaveAttribute('aria-keyshortcuts', 'Control+P Meta+P');
  await expect(commandPaletteTrigger.locator('gc-icon svg circle')).toHaveAttribute('r', '7');
  await expect(page.getByTitle('Hide Left Panel (Ctrl+J)')).toHaveAttribute('aria-keyshortcuts', 'Control+J Meta+J');
  await expect(page.getByTitle('Open repository terminal (Alt+T or Ctrl+`)')).toHaveAttribute('aria-keyshortcuts', 'Alt+T Control+` Meta+`');
  await expect(page.getByTitle('Hide Commit Panel (Ctrl+K)')).toHaveAttribute('aria-keyshortcuts', 'Control+K Meta+K');
  await expect(page.getByRole('button', { name: 'Decrease zoom' })).toHaveAttribute('title', 'Decrease zoom (Ctrl+-)');
  await expect(page.getByRole('button', { name: 'Increase zoom' })).toHaveAttribute('title', 'Increase zoom (Ctrl++)');
  await expect(page.getByRole('button', { name: 'Reset zoom to 100 percent' })).toHaveAttribute('title', 'Reset zoom to 100% (Ctrl+0)');
  await expect(page.locator('.graph-search kbd')).toHaveText('Ctrl F');

  await page.getByTitle('Show all open repositories').click();
  const repositoryTabsMenu = page.getByRole('menu', { name: 'Open repositories' });
  const activeRepositoryItem = repositoryTabsMenu.getByRole('menuitemradio', { name: /git-khronos/ });
  await expect(page.locator('.tab-list-menu kbd').first()).toHaveText('Ctrl 1');
  await expect(activeRepositoryItem).toBeFocused();
  await expect(activeRepositoryItem).toHaveAttribute('aria-checked', 'true');
  await activeRepositoryItem.press('ArrowDown');
  await expect(activeRepositoryItem).toBeFocused();
  await activeRepositoryItem.press('Escape');
  await expect(repositoryTabsMenu).toBeHidden();
  await expect(page.getByRole('button', { name: 'Show all open repositories' })).toBeFocused();

  const commandPaletteButton = page.getByTitle('Command palette (Ctrl+P)');
  await commandPaletteButton.focus();
  await page.keyboard.press('Control+P');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette.locator('.palette-search kbd')).toHaveText('Ctrl P');
  await page.keyboard.press('Escape');
  await expect(commandPaletteButton).toBeFocused();

  await page.keyboard.press('Control+/');

  const dialog = page.getByRole('dialog', { name: 'Keyboard Shortcuts' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Ctrl', { exact: true }).first()).toBeVisible();
  await expect(dialog.getByText('Alt', { exact: true }).first()).toBeVisible();
  await expect(dialog.getByText('F11', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Undo repository action')).toBeVisible();
  await expect(dialog.getByText('Redo repository action')).toBeVisible();
  await expect(dialog.getByText('Stage selected file', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Unstage selected file', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Close focused panel', { exact: true })).toBeVisible();
  await expect(dialog.getByText('First commit', { exact: true }).locator('..').locator('kbd')).toHaveText(['Ctrl', 'Home']);
  await expect(dialog.getByText('Last commit', { exact: true }).locator('..').locator('kbd')).toHaveText(['Ctrl', 'End']);

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('keeps command palette focus inside the compact modal', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 720 });
  const opener = page.getByTitle('Command palette (Ctrl+P)');
  await opener.focus();
  await page.keyboard.press('Control+P');

  const palette = page.getByRole('dialog', { name: 'Command palette' });
  const search = palette.getByRole('combobox', { name: 'Search commands' });
  const close = palette.getByRole('button', { name: 'Close command palette' });
  await expect(search).toBeFocused();
  await expect(close).toBeVisible();
  await expect(palette.getByRole('listbox', { name: 'Available commands' })).toBeVisible();
  await expect(palette.getByText('Files', { exact: true })).toHaveCount(0);
  await expect(palette.locator('.palette-search kbd')).toBeHidden();
  await expect(palette.locator('.palette-navigation-hint')).toBeVisible();
  await expect(palette.locator('.palette-jump-hint')).toBeHidden();
  const results = palette.getByRole('listbox', { name: 'Available commands' });
  const firstGroup = palette.locator('.palette-group-heading').first();
  await expect(firstGroup).toHaveCSS('font-size', '12px');
  await expect(firstGroup).toHaveCSS('position', 'sticky');
  await expect(results).toHaveCSS('scroll-padding-top', '34px');
  await results.evaluate((element) => { element.scrollTop = 60; });
  const [resultsBox, firstGroupBox] = await Promise.all([results.boundingBox(), firstGroup.boundingBox()]);
  expect(resultsBox).not.toBeNull();
  expect(firstGroupBox).not.toBeNull();
  expect(firstGroupBox!.y).toBeGreaterThanOrEqual(resultsBox!.y);
  expect(firstGroupBox!.y).toBeLessThanOrEqual(resultsBox!.y + 8);
  await results.evaluate((element) => { element.scrollTop = 0; });

  await search.press('End');
  const lastSelected = palette.locator('[role="option"][aria-selected="true"]');
  const [endResultsBox, lastSelectedBox] = await Promise.all([results.boundingBox(), lastSelected.boundingBox()]);
  expect(endResultsBox).not.toBeNull();
  expect(lastSelectedBox).not.toBeNull();
  expect(lastSelectedBox!.y + lastSelectedBox!.height).toBeLessThanOrEqual(endResultsBox!.y + endResultsBox!.height - 8);
  await search.press('Home');
  const firstSelected = palette.locator('[role="option"][aria-selected="true"]');
  const [homeGroupBox, firstSelectedBox] = await Promise.all([firstGroup.boundingBox(), firstSelected.boundingBox()]);
  expect(homeGroupBox).not.toBeNull();
  expect(firstSelectedBox).not.toBeNull();
  expect(firstSelectedBox!.y + 1).toBeGreaterThanOrEqual(homeGroupBox!.y + homeGroupBox!.height);

  const resultCount = await palette.getByRole('option').count();
  await expect(palette.locator('.palette-result-count')).toHaveText(`${resultCount} commands`);
  await expect(palette.locator('.palette-footer kbd')).toHaveText(['↑', '↓', 'PgUp', 'PgDn', '↵', 'Esc']);
  await expect(palette.locator('.palette-footer kbd').first()).toHaveCSS('font-size', '10px');
  expect(await palette.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

  const selectedAction = palette.locator('[role="option"][aria-selected="true"]');
  await expect(selectedAction).toBeEnabled();
  await expect(selectedAction.locator('.palette-action-copy strong')).toHaveCSS('font-size', '13px');
  await expect(selectedAction.locator('.palette-action-copy em')).toHaveCSS('font-size', '12px');
  const disabledAction = palette.getByRole('option', { name: /Switch to Default/ });
  await expect(disabledAction).toBeDisabled();
  await expect(disabledAction).toContainText('Current workspace · 1 repository');
  await expect(disabledAction).toHaveCSS('cursor', 'not-allowed');
  const selectedId = await selectedAction.getAttribute('id');
  await disabledAction.hover();
  await expect(search).toHaveAttribute('aria-activedescendant', selectedId!);

  await search.press('Shift+Tab');
  await expect(close).toBeFocused();
  await close.press('Tab');
  await expect(search).toBeFocused();
  await search.press('Tab');
  await expect(close).toBeFocused();
  await close.press('Tab');
  await expect(search).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();
  await expect(opener).toBeFocused();

  await page.keyboard.press('Control+P');
  await palette.getByRole('combobox', { name: 'Search commands' }).fill('preferences');
  await palette.getByRole('option', { name: /^Open Preferences/ }).click();
  const preferences = page.getByRole('dialog', { name: 'Preferences' });
  await expect(preferences.getByRole('button', { name: 'Close preferences' })).toBeFocused();
  await preferences.getByRole('tab', { name: /Commit Graph/ }).click();
  const compactBehavior = preferences.getByRole('group', { name: 'Behavior' });
  const compactColumns = preferences.getByRole('group', { name: 'Visible columns' });
  const [behaviorBox, columnsBox] = await Promise.all([compactBehavior.boundingBox(), compactColumns.boundingBox()]);
  expect(behaviorBox).not.toBeNull();
  expect(columnsBox).not.toBeNull();
  expect(columnsBox!.y).toBeGreaterThanOrEqual(behaviorBox!.y + behaviorBox!.height);
  await page.keyboard.press('Escape');
  await expect(preferences).toBeHidden();
  await expect(opener).toBeFocused();

  await page.keyboard.press('Control+P');
  await palette.getByRole('combobox', { name: 'Search commands' }).fill('new tab');
  await palette.getByRole('option', { name: /^New Tab/ }).click();
  const repositoryManager = page.getByRole('dialog', { name: 'Repository management' });
  await expect(repositoryManager.getByRole('tab', { name: 'Browse' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(repositoryManager).toBeHidden();
  await expect(opener).toBeFocused();
});

test('keeps command palette chrome inside a short desktop window', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 400 });
  await page.keyboard.press('Control+P');

  const palette = page.getByRole('dialog', { name: 'Command palette' });
  const results = palette.getByRole('listbox', { name: 'Available commands' });
  const footer = palette.locator('.palette-footer');
  const [paletteBox, resultsBox, footerBox] = await Promise.all([
    palette.boundingBox(),
    results.boundingBox(),
    footer.boundingBox(),
  ]);
  expect(paletteBox).not.toBeNull();
  expect(resultsBox).not.toBeNull();
  expect(footerBox).not.toBeNull();
  expect(paletteBox!.y + paletteBox!.height).toBeLessThanOrEqual(384);
  expect(footerBox!.y + footerBox!.height).toBeLessThanOrEqual(paletteBox!.y + paletteBox!.height);
  expect(await results.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
});

test('pairs command palette surfaces with each application theme', async ({ page }) => {
  const appearances: Record<string, string[]> = {};
  for (const theme of ['chronos', 'midnight']) {
    await page.evaluate((value) => localStorage.setItem('git-khronos.ui.theme', value), theme);
    await page.reload();
    await page.keyboard.press('Control+P');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    appearances[theme] = await palette.evaluate((element) => [
      getComputedStyle(element).backgroundColor,
      getComputedStyle(element.querySelector('.palette-header')!).backgroundColor,
      getComputedStyle(element.querySelector('.palette-results > button.selected')!).backgroundColor,
      getComputedStyle(element.querySelector('.palette-action-icon')!).backgroundColor,
      getComputedStyle(element.querySelector('.palette-footer')!).borderTopColor,
    ]);
    await page.keyboard.press('Escape');
  }

  expect(appearances['chronos']).not.toEqual(appearances['midnight']);
  expect(new Set(appearances['chronos']).size).toBeGreaterThan(2);
  expect(new Set(appearances['midnight']).size).toBeGreaterThan(2);
});

test('uses familiar macOS graph boundary shortcuts', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'platform', { configurable: true, get: () => 'MacIntel' });
  });
  await page.reload();

  const commits = page.locator('.commit-row[data-commit-oid]');
  await expect(commits.first()).toBeVisible();
  await commits.nth(2).focus();
  await page.keyboard.press('Meta+ArrowUp');
  await expect(commits.first()).toBeFocused();
  await page.keyboard.press('Meta+ArrowDown');
  await expect(commits.last()).toBeFocused();

  await page.keyboard.press('Meta+/');
  const dialog = page.getByRole('dialog', { name: 'Keyboard Shortcuts' });
  await expect(dialog.getByText('First commit', { exact: true }).locator('..').locator('kbd')).toHaveText(['⌘', '↑']);
  await expect(dialog.getByText('Last commit', { exact: true }).locator('..').locator('kbd')).toHaveText(['⌘', '↓']);
});

test('closes only the focused workspace panel with Escape', async ({ page }) => {
  const sidebar = page.locator('.sidebar');
  const commitPanel = page.locator('.commit-panel');

  const stageAll = commitPanel.getByRole('button', { name: 'Stage all changes' });
  await stageAll.focus();
  await page.keyboard.press('Escape');
  await expect(commitPanel).toBeHidden();
  await expect(sidebar).toBeVisible();

  await page.getByRole('button', { name: 'Show Commit Panel', exact: true }).click();
  await expect(commitPanel).toBeVisible();
  const referenceFilter = page.getByPlaceholder('Filter references');
  await referenceFilter.focus();
  await page.keyboard.press('Escape');
  await expect(sidebar).toBeHidden();
  await expect(commitPanel).toBeVisible();

  await page.getByRole('button', { name: 'Show Left Panel', exact: true }).click();
  const graphRow = page.locator('.commit-row[data-commit-oid]').first();
  await graphRow.focus();
  await page.keyboard.press('Escape');
  await expect(sidebar).toBeVisible();
  await expect(commitPanel).toBeVisible();
});

test('exposes familiar repository and application actions from the main menu', async ({ page }) => {
  const toggle = page.getByRole('button', { name: 'Main menu' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle.locator('.app-menu-chevron')).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  const menu = page.getByRole('menu', { name: 'Git Khronos menu' });
  await expect(menu).toBeVisible();
  await expect(menu.locator('header strong')).toHaveCSS('font-size', '13px');
  await expect(menu.locator('header small')).toHaveCSS('font-size', '12px');
  await expect(menu.getByRole('menuitem', { name: /Manage Repositories/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Manage Repositories/ }).locator('strong')).toHaveCSS('font-size', '13px');
  await expect(menu.getByRole('menuitem', { name: /Command Palette/ }).locator('gc-icon svg circle')).toHaveAttribute('r', '7');
  await expect(menu.getByRole('menuitem', { name: /Keyboard Shortcuts/ }).locator('gc-icon svg rect')).toHaveAttribute('width', '18');
  await expect(menu.getByRole('menuitem', { name: /Manage Repositories/ }).locator('small')).toHaveCSS('font-size', '12px');
  await expect(menu.getByRole('menuitem', { name: /Open Repository/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Clone Repository/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Initialize Repository/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /^Undo/ })).toContainText('Ctrl Z');
  await expect(menu.getByRole('menuitem', { name: /^Redo/ })).toContainText('Ctrl Y');
  await expect(menu.getByRole('menuitem', { name: /Recovery History/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Command Palette/ })).toContainText('Ctrl P');

  const manageRepositories = menu.getByRole('menuitem', { name: /Manage Repositories/ });
  await expect(manageRepositories).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: /Open Repository/ })).toBeFocused();
  await page.keyboard.press('End');
  await expect(menu.getByRole('menuitem', { name: /Preferences/ })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(manageRepositories).toBeFocused();

  await menu.getByRole('menuitem', { name: /Preferences/ }).click();
  await expect(menu).toHaveCount(0);
  const preferences = page.getByRole('dialog', { name: 'Preferences' });
  await expect(preferences.getByRole('button', { name: 'Close preferences' })).toBeFocused();
  const generalPreferences = preferences.getByRole('tab', { name: /General/ });
  const graphPreferences = preferences.getByRole('tab', { name: /Commit Graph/ });
  await graphPreferences.click();
  await expect(graphPreferences).toHaveAttribute('aria-selected', 'true');
  await expect(graphPreferences).toHaveClass(/active/);
  await expect(generalPreferences).toHaveAttribute('aria-selected', 'false');
  await expect(generalPreferences).not.toHaveClass(/active/);
  await expect(preferences.getByRole('group', { name: 'Behavior' })).toBeVisible();
  const visibleColumns = preferences.getByRole('group', { name: 'Visible columns' });
  await expect(visibleColumns).toBeVisible();
  await expect(visibleColumns.getByLabel('Commit message')).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(preferences).toBeHidden();
  await expect(toggle).toBeFocused();

  await toggle.click();
  await menu.getByRole('menuitem', { name: /Keyboard Shortcuts/ }).click();
  const shortcuts = page.getByRole('dialog', { name: 'Keyboard Shortcuts' });
  await expect(shortcuts.getByRole('searchbox', { name: 'Search keyboard shortcuts' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(shortcuts).toBeHidden();
  await expect(toggle).toBeFocused();

  await toggle.click();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeFocused();
});

test('keeps every main-menu command reachable in compact-height windows', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 640 });
  await page.getByRole('button', { name: 'Main menu' }).click();

  const menu = page.getByRole('menu', { name: 'Git Khronos menu' });
  const scrollRegion = menu.locator('.app-menu-scroll');
  const applicationSection = menu.locator('.app-menu-application');
  const preferences = menu.getByRole('menuitem', { name: /Preferences/ });
  const metrics = await menu.evaluate((element) => ({
    bottom: element.getBoundingClientRect().bottom,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(metrics.bottom).toBeLessThanOrEqual(640);
  expect(metrics.scrollHeight).toBe(metrics.clientHeight);
  await expect(applicationSection).toBeInViewport();
  await expect(preferences).toBeInViewport();

  const currentRepositorySection = scrollRegion.locator('.app-menu-section').filter({ hasText: 'Current Repository' });
  const editSection = scrollRegion.locator('.app-menu-section').filter({ hasText: 'Edit' });
  const [currentRepositoryBox, editBox] = await Promise.all([
    currentRepositorySection.boundingBox(),
    editSection.boundingBox(),
  ]);
  expect(currentRepositoryBox).not.toBeNull();
  expect(editBox).not.toBeNull();
  expect(currentRepositoryBox!.y).toBeLessThan(editBox!.y);
  await expect(menu.getByRole('menuitem', { name: /^Terminal/ })).toBeInViewport();

  const applicationTop = (await applicationSection.boundingBox())!.y;
  const scrollMetrics = await scrollRegion.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight);
  await scrollRegion.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect.poll(async () => (await applicationSection.boundingBox())!.y).toBeCloseTo(applicationTop, 0);

  await page.keyboard.press('End');
  await expect(preferences).toBeFocused();
  await expect(preferences).toBeInViewport();
  await preferences.click();
  await expect(page.getByRole('dialog', { name: 'Preferences' })).toBeVisible();
});

test('condenses the main menu without hiding commands at the native minimum height', async ({ page }) => {
  await page.setViewportSize({ width: 780, height: 560 });
  await page.getByRole('button', { name: 'Main menu' }).click();

  const menu = page.getByRole('menu', { name: 'Git Khronos menu' });
  const scrollRegion = menu.locator('.app-menu-scroll');
  const descriptions = menu.locator('.app-menu-section button small');
  const commands = [
    /Manage Repositories/,
    /^Terminal/,
    /Recovery History/,
    /^Undo/,
    /^Redo/,
    /Command Palette/,
    /Preferences/,
  ];

  await expect(descriptions.first()).toBeHidden();
  for (const name of commands) await expect(menu.getByRole('menuitem', { name })).toBeInViewport();
  const menuBounds = await menu.boundingBox();
  expect(menuBounds).not.toBeNull();
  expect(menuBounds!.y + menuBounds!.height).toBeLessThanOrEqual(560 - 8);
  expect(await scrollRegion.evaluate((element) => element.scrollHeight)).toBe(
    await scrollRegion.evaluate((element) => element.clientHeight),
  );

  await page.keyboard.press('End');
  await expect(menu.getByRole('menuitem', { name: /Preferences/ })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(menu.getByRole('menuitem', { name: /Manage Repositories/ })).toBeFocused();
});

test('fits the complete main menu without needless scrolling when the viewport has room', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Main menu' }).click();

  const menu = page.getByRole('menu', { name: 'Git Khronos menu' });
  const scrollRegion = menu.locator('.app-menu-scroll');
  const lastScrollableSection = scrollRegion.locator('.app-menu-section').last();
  const metrics = await Promise.all([
    menu.boundingBox(),
    scrollRegion.boundingBox(),
    lastScrollableSection.boundingBox(),
    scrollRegion.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    })),
  ]);

  expect(metrics[0]).not.toBeNull();
  expect(metrics[1]).not.toBeNull();
  expect(metrics[2]).not.toBeNull();
  expect(metrics[0]!.y + metrics[0]!.height).toBeLessThanOrEqual(900 - 8);
  expect(metrics[3].scrollHeight).toBe(metrics[3].clientHeight);
  expect(metrics[2]!.y + metrics[2]!.height).toBeLessThanOrEqual(metrics[1]!.y + metrics[1]!.height);
  await expect(menu.getByRole('menuitem', { name: /Recovery History/ })).toBeInViewport();
  await expect(menu.getByRole('menuitem', { name: /^Undo/ })).toBeInViewport();
});

test('finds and safely preserves commits from recovery history', async ({ page }) => {
  await page.getByRole('button', { name: 'Main menu' }).click();
  await page.getByRole('menu', { name: 'Git Khronos menu' }).getByRole('menuitem', { name: /Recovery History/ }).click();

  const dialog = page.getByRole('dialog', { name: 'Recovery history' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Creating a recovery branch keeps the selected commit reachable');
  await expect(dialog.locator('.recovery-entry')).toHaveCount(7);

  const search = dialog.getByRole('searchbox', { name: 'Search recovery history' });
  await expect(search).toBeFocused();
  await search.fill('HEAD@{1}');
  await expect(dialog.locator('.recovery-entry')).toHaveCount(1);
  await expect(dialog.locator('.recovery-entry')).toContainText('HEAD@{1}');

  await dialog.getByRole('button', { name: 'Create branch' }).click();
  const branchName = dialog.getByLabel('New branch name');
  await expect(branchName).toBeFocused();
  await expect(branchName).toHaveValue(/^recovery\/[0-9a-f]{8}$/);
  await expect(dialog.getByRole('button', { name: /Create at/ })).toBeEnabled();

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('keeps the graph header in place while the author filter is open', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const header = page.locator('.graph-columns');
  const before = (await header.boundingBox())!;
  await page.getByRole('button', { name: 'Filter commits by author' }).click();
  await expect(page.getByLabel('Search authors')).toBeFocused();
  expect(await header.evaluate((element) => [element.scrollTop, element.scrollLeft])).toEqual([0, 0]);
  expect((await page.locator('.author-column-heading').boundingBox())!.y).toBeGreaterThanOrEqual(before.y - 1);
  await page.keyboard.press('Escape');
  expect(await header.evaluate((element) => element.scrollTop)).toBe(0);
});

test('keeps a resized column edge visible while columns overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('separator', { name: 'Resize Commit Message column', exact: true }).focus();
  await page.keyboard.press('End');
  const list = page.locator('.commit-list');
  await expect.poll(() => list.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeGreaterThan(100);
  const edges = () => page.evaluate(() => ({
    authorRight: document.querySelector('.author-column-heading')!.getBoundingClientRect().right,
    dateLeft: document.querySelector('.graph-columns > .trailing-column')!.getBoundingClientRect().left,
    dateRight: document.querySelector('.graph-columns > .trailing-column')!.getBoundingClientRect().right,
    visibleRight: (() => { const list = document.querySelector('.commit-list')!; return list.getBoundingClientRect().left + list.clientWidth; })(),
  }));
  // Date / Time follows its own right edge, not Author's edge.
  await list.evaluate((element) => { element.scrollLeft = 0; });
  await page.getByRole('separator', { name: 'Resize Date and Time column', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => { const { dateRight, visibleRight } = await edges(); return dateRight <= visibleRight + 1; }).toBe(true);
  // Widening Author from its own handle scrolls its right edge into view.
  await list.evaluate((element) => { element.scrollLeft = 0; });
  await page.getByRole('separator', { name: 'Resize Author column', exact: true }).focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(async () => { const { authorRight, dateLeft, visibleRight } = await edges(); return authorRight <= dateLeft + 1 && authorRight <= visibleRight; }).toBe(true);
});

const graphColumnFit = (page: Page) => page.evaluate(() => {
  const list = document.querySelector('.commit-list')!;
  const separators = [...document.querySelectorAll('.graph-columns [role="separator"]')].map((separator) => ({
    name: separator.getAttribute('aria-label')!,
    now: Number(separator.getAttribute('aria-valuenow')),
    min: Number(separator.getAttribute('aria-valuemin')),
    max: Number(separator.getAttribute('aria-valuemax')),
  }));
  const headings = [...document.querySelectorAll('.graph-columns > *')]
    .map((heading) => heading.getBoundingClientRect())
    .filter((box) => box.width > 0)
    .sort((left, right) => left.left - right.left);
  const overlaps = headings.some((box, index) => index > 0 && box.left < headings[index - 1].right - 1);
  return { overflow: list.scrollWidth - list.clientWidth, separators, overlaps };
});

const separatorWidth = async (page: Page, name: string) =>
  Number(await page.getByRole('separator', { name, exact: true }).getAttribute('aria-valuenow'));

const expectGraphColumnsFit = async (page: Page) => {
  await expect.poll(async () => {
    const { overflow, separators, overlaps } = await graphColumnFit(page);
    return overflow <= 1 && !overlaps && separators.every(({ now, min }) => now >= min);
  }).toBe(true);
};

test('fits graph columns to the panel when horizontal scrolling is off', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  const settingsButton = page.getByRole('button', { name: 'Configure graph columns' });
  await settingsButton.click();
  const settings = page.getByRole('dialog', { name: 'Graph settings' });
  const toggle = settings.getByLabel('Horizontal Scrolling');
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('git-khronos.graph.horizontal-scroll'))).toBe('false');
  await expectGraphColumnsFit(page);

  // End on Commit Message takes only right-hand columns' spare width.
  const branchWidth = await separatorWidth(page, 'Resize Branch and Tag column');
  const graphWidth = await separatorWidth(page, 'Resize Graph column');
  const message = page.getByRole('separator', { name: 'Resize Commit Message column', exact: true });
  await message.focus();
  await page.keyboard.press('End');
  await expectGraphColumnsFit(page);
  const messageMaximum = Number(await message.getAttribute('aria-valuemax'));
  expect(messageMaximum).toBeLessThan(2400);
  await expect(message).toHaveAttribute('aria-valuenow', String(messageMaximum));
  for (const { name, now, min } of (await graphColumnFit(page)).separators) {
    if (name === 'Resize Author column' || name === 'Resize Date and Time column') expect(now, name).toBe(min);
  }
  expect(await separatorWidth(page, 'Resize Branch and Tag column')).toBe(branchWidth);
  expect(await separatorWidth(page, 'Resize Graph column')).toBe(graphWidth);
  await page.keyboard.press('Home');
  await expect(message).toHaveAttribute('aria-valuenow', '180');
  await expectGraphColumnsFit(page);

  // Widening Branch narrows right-hand columns nearest-first; reversing the drag restores them.
  const branchName = 'Resize Branch and Tag column';
  const authorName = 'Resize Author column';
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) if (key.includes('.column.') && key.endsWith('.width')) localStorage.removeItem(key);
  });
  await page.reload();
  await expect(page.getByRole('separator', { name: branchName, exact: true })).toHaveAttribute('aria-valuenow', '180');
  const startMessage = await separatorWidth(page, 'Resize Commit Message column');
  const startAuthor = await separatorWidth(page, authorName);
  const handle = (await page.getByRole('separator', { name: branchName, exact: true }).boundingBox())!;
  const y = handle.y + handle.height / 2;
  await page.mouse.move(handle.x + handle.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 120, y, { steps: 4 });
  await expect.poll(() => separatorWidth(page, branchName)).toBe(300);
  await expect.poll(() => separatorWidth(page, 'Resize Commit Message column')).toBeLessThan(startMessage);
  expect(await separatorWidth(page, authorName)).toBe(startAuthor);
  await expectGraphColumnsFit(page);
  await page.mouse.move(handle.x + handle.width / 2 + 700, y, { steps: 6 });
  await expectGraphColumnsFit(page);
  expect(await separatorWidth(page, 'Resize Commit Message column')).toBe(180);
  expect(await separatorWidth(page, authorName)).toBeLessThan(startAuthor);
  await page.mouse.move(handle.x + handle.width / 2, y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => separatorWidth(page, branchName)).toBe(180);
  expect(await separatorWidth(page, 'Resize Commit Message column')).toBe(startMessage);
  expect(await separatorWidth(page, authorName)).toBe(startAuthor);

  // The last column cannot widen a full panel by borrowing from Author or Commit Message.
  const date = page.getByRole('separator', { name: 'Resize Date and Time column', exact: true });
  const startDate = Number(await date.getAttribute('aria-valuenow'));
  await date.focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(() => separatorWidth(page, 'Resize Date and Time column')).toBe(startDate);
  expect(await separatorWidth(page, authorName)).toBe(startAuthor);
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(date).toHaveAttribute('aria-valuenow', await date.getAttribute('aria-valuemin'));
  await page.keyboard.press('End');
  await expect.poll(() => separatorWidth(page, 'Resize Date and Time column')).toBe(startDate);
  expect(await separatorWidth(page, authorName)).toBe(startAuthor);
  await expectGraphColumnsFit(page);

  // Narrowing the window narrows the columns, and the setting survives a reload.
  await page.setViewportSize({ width: 1440, height: 900 });
  await expectGraphColumnsFit(page);
  await page.reload();
  await expectGraphColumnsFit(page);
  await settingsButton.click();
  await expect(toggle).not.toBeChecked();

  // Turning scrolling back on lets columns overflow again.
  await toggle.check();
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('git-khronos.graph.horizontal-scroll'))).toBe('true');
  await message.focus();
  await page.keyboard.press('End');
  await expect(message).toHaveAttribute('aria-valuenow', '2400');
  await expect.poll(async () => (await graphColumnFit(page)).overflow).toBeGreaterThan(100);
});

test('keeps fitted graph columns inside the panel when paths are fitted or columns shown', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Configure graph columns' }).click();
  const settings = page.getByRole('dialog', { name: 'Graph settings' });
  await settings.getByLabel('Horizontal Scrolling').uncheck();
  await settings.getByRole('checkbox', { name: 'SHA', exact: true }).check();
  await page.keyboard.press('Escape');
  await expectGraphColumnsFit(page);
  const graph = page.getByRole('separator', { name: 'Resize Graph column', exact: true });
  await graph.focus();
  await page.keyboard.press('End');
  await expectGraphColumnsFit(page);
  await graph.dblclick();
  await expectGraphColumnsFit(page);

  await page.getByRole('button', { name: 'Configure graph columns' }).click();
  await settings.getByRole('button', { name: 'Restore graph defaults' }).click();
  await expect(settings.getByLabel('Horizontal Scrolling')).toBeChecked();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('git-khronos.graph.horizontal-scroll'))).toBeNull();
});

for (const reordered of [false, true]) {
  test(`clamps right-edge resizing without borrowing from the left${reordered ? ' after reordering and hiding columns' : ''}`, async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Configure graph columns' }).click();
    const settings = page.getByRole('dialog', { name: 'Graph settings' });
    await settings.getByLabel('Horizontal Scrolling').uncheck();
    await settings.getByLabel('SHA', { exact: true }).check();
    if (reordered) await settings.getByLabel('Graph', { exact: true }).uncheck();
    await page.keyboard.press('Escape');
    const author = page.getByRole('separator', { name: 'Resize Author column', exact: true });
    if (reordered) {
      await author.locator('..').dragTo(page.locator('.message-column-heading'), { targetPosition: { x: 8, y: 8 } });
    }
    const names = await page.locator('.graph-columns > .draggable-column').evaluateAll((columns) =>
      [...columns].sort((a, b) => Number((a as HTMLElement).style.order) - Number((b as HTMLElement).style.order))
        .map((column) => column.querySelector('[role="separator"]')!.getAttribute('aria-label')!));
    const authorIndex = names.indexOf('Resize Author column');
    if (reordered) expect(authorIndex).toBeLessThan(names.indexOf('Resize Commit Message column'));
    expect(authorIndex).toBeGreaterThan(0);
    expect(names.length - authorIndex - 1).toBeGreaterThanOrEqual(2);
    for (const name of names.slice(authorIndex + 1)) {
      const separator = page.getByRole('separator', { name, exact: true });
      await separator.focus();
      await page.keyboard.press('Home');
      await expect(separator).toHaveAttribute('aria-valuenow', await separator.getAttribute('aria-valuemin'));
    }
    const geometry = () => page.locator('.graph-columns > .draggable-column').evaluateAll((columns) =>
      [...columns].sort((a, b) => Number((a as HTMLElement).style.order) - Number((b as HTMLElement).style.order))
        .map((column) => {
          const box = column.getBoundingClientRect();
          return { left: box.left, width: box.width };
        }));
    const before = await geometry();
    const maximum = Number(await author.getAttribute('aria-valuemax'));
    const expectFixedLeft = async () => {
      const after = await geometry();
      for (let index = 0; index < authorIndex; index++) {
        expect(Math.abs(after[index].left - before[index].left), names[index]).toBeLessThanOrEqual(1);
        expect(Math.abs(after[index].width - before[index].width), names[index]).toBeLessThanOrEqual(1);
      }
      expect(Math.abs(after[authorIndex].left - before[authorIndex].left)).toBeLessThanOrEqual(1);
      expect(Math.round(after[authorIndex].width)).toBe(maximum);
      await expectGraphColumnsFit(page);
    };
    await author.focus();
    await page.keyboard.press('End');
    await expect(author).toHaveAttribute('aria-valuenow', String(maximum));
    await expectFixedLeft();
    for (const key of ['ArrowRight', 'Shift+ArrowRight', 'End']) {
      await page.keyboard.press(key);
      await expect(author).toHaveAttribute('aria-valuenow', String(maximum));
      await expectFixedLeft();
    }
    const handle = (await author.boundingBox())!;
    const x = handle.x + handle.width / 2;
    const y = handle.y + handle.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 300, y, { steps: 5 });
    await expect(author).toHaveAttribute('aria-valuenow', String(maximum));
    await expectFixedLeft();
    await page.mouse.move(x, y, { steps: 5 });
    await page.mouse.up();
    await expectFixedLeft();
    await page.keyboard.press('ArrowLeft');
    await expect(author).toHaveAttribute('aria-valuenow', String(maximum - 8));
    const narrowed = await geometry();
    expect(Math.abs(narrowed[authorIndex].left - before[authorIndex].left)).toBeLessThanOrEqual(1);
    expect(narrowed.slice(0, authorIndex)).toEqual(before.slice(0, authorIndex));
    await page.reload();
    await expect(author).toHaveAttribute('aria-valuenow', String(maximum - 8));
    await expectGraphColumnsFit(page);
  });
}

test('keeps a last-column keyboard resize fixed after a blocked expansion and reload', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Configure graph columns' }).click();
  const settings = page.getByRole('dialog', { name: 'Graph settings' });
  await settings.getByLabel('Horizontal Scrolling').uncheck();
  await settings.getByLabel('Author', { exact: true }).uncheck();
  await settings.getByLabel('Date / Time', { exact: true }).uncheck();
  await page.keyboard.press('Escape');
  const message = page.getByRole('separator', { name: 'Resize Commit Message column', exact: true });
  const heading = message.locator('..');
  const left = (await heading.boundingBox())!.x;
  const width = Number(await message.getAttribute('aria-valuenow'));
  await expect(message).toHaveAttribute('aria-valuemax', String(width));
  await expect(heading).toHaveClass(/trailing-column/);
  await message.focus();
  await page.keyboard.press('End');
  await expect(message).toHaveAttribute('aria-valuenow', String(width));
  await expect.poll(() => page.evaluate(() => {
    const key = Object.keys(localStorage).find((candidate) => candidate.endsWith('.column.message.width'));
    return key ? Number(localStorage.getItem(key)) : null;
  })).toBe(width);
  await page.reload();
  await page.setViewportSize({ width: 2000, height: 900 });
  await expect(message).toHaveAttribute('aria-valuenow', String(width));
  expect((await heading.boundingBox())!.x).toBe(left);
  await message.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(message).toHaveAttribute('aria-valuenow', String(width - 8));
  expect((await heading.boundingBox())!.x).toBe(left);
  await message.dblclick();
  await expect(message).toHaveAttribute('aria-valuenow', String(width + 80));
  expect((await heading.boundingBox())!.x).toBe(left);
  await expectGraphColumnsFit(page);
});

test('clamps fitting graph paths at the right-hand limit without moving the left-hand column', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Configure graph columns' }).click();
  await page.getByLabel('Horizontal Scrolling').uncheck();
  await page.keyboard.press('Escape');
  const branch = page.getByRole('separator', { name: 'Resize Branch and Tag column', exact: true });
  await branch.focus();
  await page.keyboard.press('End');
  const branchWidth = await separatorWidth(page, 'Resize Branch and Tag column');
  expect(branchWidth).toBeLessThan(800);
  const graph = page.getByRole('separator', { name: 'Resize Graph column', exact: true });
  const minimum = Number(await graph.getAttribute('aria-valuemin'));
  await expect(graph).toHaveAttribute('aria-valuenow', String(minimum));
  await expect(graph).toHaveAttribute('aria-valuemax', String(minimum));
  const left = (await graph.locator('..').boundingBox())!.x;
  for (const handle of [graph, page.locator('.commit-row[data-commit-oid] .graph-row-resizer').first()]) {
    await handle.dblclick();
    await expect(graph).toHaveAttribute('aria-valuenow', String(minimum));
    expect(await separatorWidth(page, 'Resize Branch and Tag column')).toBe(branchWidth);
    expect((await graph.locator('..').boundingBox())!.x).toBe(left);
    await expectGraphColumnsFit(page);
  }
});

test('searches and applies the graph author filter', async ({ page }) => {
  await page.getByRole('button', { name: 'Configure graph columns' }).click();
  await page.locator('.column-settings').getByRole('checkbox', { name: 'Author', exact: true }).check();
  await page.getByRole('button', { name: 'Configure graph columns' }).click();
  await expect(page.locator('.column-settings')).toBeHidden();

  const filterButton = page.getByRole('button', { name: 'Filter commits by author' });
  const filterTarget = await filterButton.boundingBox();
  expect(filterTarget?.width).toBeGreaterThanOrEqual(24);
  expect(filterTarget?.height).toBeGreaterThanOrEqual(24);
  await filterButton.click();
  const authorSearch = page.getByRole('searchbox', { name: 'Search authors' });
  await expect(authorSearch).toBeFocused();
  await expect(authorSearch).toHaveCSS('font-size', '13px');
  await expect(page.getByRole('dialog', { name: 'Author filter' })).toContainText('All authors');
  // The whole menu is on top: it is not clipped by the column header, so every option is clickable.
  const authorMenu = page.getByRole('dialog', { name: 'Author filter' });
  await expect(authorMenu).toHaveCSS('width', '280px');
  await expect(authorMenu.getByRole('button', { name: /All authors/ }).locator('strong')).toHaveCSS('font-size', '13px');
  await expect(authorMenu.getByRole('button', { name: /All authors/ }).locator('small')).toHaveCSS('font-size', '12px');
  expect(await authorMenu.evaluate((menu) => {
    const box = menu.getBoundingClientRect();
    return [box.top + 8, box.top + box.height / 2, box.bottom - 8].every((y) =>
      [box.left + 8, box.right - 8].every((x) => menu.contains(document.elementFromPoint(x, y))));
  })).toBe(true);
  const lastAuthor = authorMenu.locator(':scope > button').last();
  const lastAuthorName = (await lastAuthor.locator('strong').textContent())!.trim();
  await lastAuthor.click();
  await expect(page.locator('.author-column-heading')).toHaveClass(/filtered/);
  await expect(page.locator('.commit-row[data-commit-oid] .row-author').first()).toContainText(lastAuthorName);
  await filterButton.click();
  await authorMenu.getByRole('button', { name: /All authors/ }).click();
  await expect(page.locator('.author-column-heading')).not.toHaveClass(/filtered/);
  await filterButton.click();
  await expect(authorSearch).toBeFocused();

  await authorSearch.fill('leo@example');
  await expect(page.getByRole('dialog', { name: 'Author filter' }).getByRole('button', { name: /Leo Martin/ })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Author filter' }).getByRole('button', { name: /Maya Chen/ })).toHaveCount(0);
  await authorSearch.press('Enter');

  await expect(filterButton).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.author-column-heading')).toHaveClass(/filtered/);
  await expect(page.locator('.author-filter-indicator')).toBeVisible();
  await expect(page.locator('.commit-row[data-commit-oid]')).toHaveCount(1);
  await expect(page.locator('.commit-row[data-commit-oid]')).toContainText('Leo Martin');

  await filterButton.click();
  await page.getByRole('dialog', { name: 'Author filter' }).getByRole('button', { name: /All authors/ }).click();
  await expect(page.locator('.author-column-heading')).not.toHaveClass(/filtered/);
  await expect(page.locator('.commit-row[data-commit-oid]')).toHaveCount(7);
});

test('switches a minimized author column from names to avatars', async ({ page }) => {
  await page.getByRole('button', { name: 'Configure graph columns' }).click();
  await page.locator('.column-settings').getByRole('checkbox', { name: 'Author', exact: true }).check();

  const heading = page.locator('.author-column-heading');
  const resizer = heading.locator('.column-resizer');
  await resizer.focus();
  await resizer.press('Home');

  await expect(resizer).toHaveAttribute('aria-valuenow', '70');
  await expect(heading).toHaveClass(/compact/);
  await expect(heading.locator(':scope > gc-icon')).toBeVisible();
  await expect(page.locator('.commit-row[data-commit-oid] .row-author .compact-author-avatar').first()).toBeVisible();
  await expect(page.locator('.commit-row[data-commit-oid]:not(.stash-row) .row-author').first()).toHaveAttribute('title', /<.+>/);

  await page.reload();
  await expect(page.locator('.author-column-heading')).toHaveClass(/compact/);
  await expect(page.locator('.commit-row[data-commit-oid] .compact-author-avatar').first()).toBeVisible();
});

test('exposes familiar tag actions from the reference panel', async ({ page }) => {
  await page.getByRole('button', { name: 'Tags 1' }).click();
  await page.locator('.tag-item').filter({ hasText: 'v0.1.0' }).click({ button: 'right' });
  const menu = page.getByRole('menu').filter({ hasText: 'v0.1.0' });
  await expect(menu.getByText('Tag', { exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'View tagged commit' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Copy tag name' })).toBeVisible();
  const createBranch = menu.getByRole('menuitem', { name: 'Create branch here…' });
  await expect(createBranch).toBeVisible();
  await expect(menu.getByRole('form', { name: 'Create branch here' })).toHaveCount(0);
  await createBranch.click();
  const branchForm = menu.getByRole('form', { name: 'Create branch here' });
  const branchName = branchForm.getByLabel('Create branch here');
  await expect(branchForm).toBeVisible();
  await expect(branchName).toBeFocused();
  await branchName.fill('review/tag-point');
  await page.keyboard.press('Tab');
  await expect(branchForm.getByRole('button', { name: 'Create' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(branchForm.getByRole('button', { name: 'Cancel branch creation' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(branchName).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(branchForm).toHaveCount(0);
  await expect(createBranch).toBeFocused();
  await menu.getByRole('menuitem', { name: 'Create tag here…' }).click();
  const creator = page.getByRole('dialog', { name: 'Create tag at v0.1.0' });
  await expect(creator).toBeVisible();
  await expect(creator.getByLabel('Tag name')).toBeVisible();
  await creator.getByLabel('Annotated').check();
  await expect(creator.getByLabel('Tag message')).toBeVisible();
  await creator.getByRole('button', { name: 'Cancel' }).click();
  await expect(menu).toBeHidden();

  const graphTag = page.locator('.interactive-tag-ref').filter({ hasText: 'v0.1.0' }).first();
  await expect(graphTag).toHaveAttribute('title', /Right-click for actions/);
  await graphTag.click({ button: 'right' });
  await expect(page.getByRole('menu').filter({ hasText: 'v0.1.0' })).toContainText('Tag');
  await expect(page.getByRole('menuitem', { name: 'View tagged commit' })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('opens local, remote, and tag reference actions from the keyboard', async ({ page }) => {
  const localBranch = page.getByRole('button', { name: 'Local branch feature/partial-staging' });
  await localBranch.focus();
  await page.keyboard.press('Shift+F10');
  let menu = page.locator('.context-menu[role="menu"]');
  await expect(menu.getByRole('menuitem', { name: 'Checkout branch' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Copy branch name' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(localBranch).toBeFocused();

  const remoteBranch = page.locator('#reference-section-local').getByLabel('Remote branch origin/main', { exact: true });
  await remoteBranch.focus();
  await page.keyboard.press('ContextMenu');
  menu = page.locator('.context-menu[role="menu"]');
  await expect(menu.getByRole('menuitem', { name: 'Create local tracking branch' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(remoteBranch).toBeFocused();

  await page.getByRole('button', { name: 'Tags 1' }).click();
  const tag = page.locator('.tag-item').filter({ hasText: 'v0.1.0' });
  await tag.focus();
  await page.keyboard.press('Shift+F10');
  menu = page.locator('.context-menu[role="menu"]');
  await expect(menu.getByRole('menuitem', { name: 'View tagged commit' })).toBeFocused();
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(tag).toBeFocused();
});

test('keeps long branch actions stable and reachable inside a short viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 560 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open left panel' }).click();

  const branch = page.getByRole('button', { name: 'Local branch feature/partial-staging' });
  await branch.click({ button: 'right' });
  const menu = page.locator('.graph-action-menu[role="menu"]');
  await expect(menu).toBeVisible();
  await expect(menu).toHaveClass(/positioned/);

  const bounds = await menu.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const styles = getComputedStyle(element);
    return {
      top: rect.top,
      bottom: rect.bottom,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      overscrollBehavior: styles.overscrollBehavior,
      scrollbarGutter: styles.scrollbarGutter,
    };
  });
  const statusbarTop = await page.locator('.statusbar').evaluate(
    (element) => element.getBoundingClientRect().top,
  );
  expect(bounds.top).toBeGreaterThanOrEqual(8);
  expect(bounds.bottom).toBeLessThanOrEqual(statusbarTop - 8);
  expect(bounds.scrollHeight).toBeGreaterThan(bounds.clientHeight);
  expect(bounds.overscrollBehavior).toBe('contain');
  expect(bounds.scrollbarGutter).toContain('stable');

  await page.keyboard.press('End');
  const finalAction = menu.getByRole('menuitem', { name: 'Create tag here…' });
  await expect(finalAction).toBeFocused();
  expect(await finalAction.evaluate((element) => {
    const action = element.getBoundingClientRect();
    const container = element.closest('[role="menu"]')!.getBoundingClientRect();
    return action.top >= container.top && action.bottom <= container.bottom;
  })).toBe(true);
  await expect(menu.locator('.context-heading')).toBeVisible();
});

test('shows the complete commit action menu when the viewport has room', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const row = page.locator('.commit-row[data-commit-oid]').filter({ hasText: 'Refine graph lane rendering' });
  await row.click({ button: 'right' });

  const menu = page.getByRole('menu', { name: 'Actions for commit Refine graph lane rendering' });
  await expect(menu).toBeVisible();
  const bounds = await menu.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      top: rect.top,
      bottom: rect.bottom,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    };
  });
  const statusbarTop = await page.locator('.statusbar').evaluate(
    (element) => element.getBoundingClientRect().top,
  );
  expect(bounds.top).toBeGreaterThanOrEqual(8);
  expect(bounds.bottom).toBeLessThanOrEqual(statusbarTop - 8);
  expect(bounds.scrollHeight).toBeLessThanOrEqual(bounds.clientHeight);
  await expect(menu.getByRole('menuitem', { name: 'Create tag here…' })).toBeVisible();
});

test('keeps branch confirmations keyboard-contained and returns to the invoking branch', async ({ page }) => {
  const localBranch = page.getByRole('button', { name: 'Local branch feature/partial-staging' });
  await localBranch.focus();
  await page.keyboard.press('Shift+F10');
  const menu = page.locator('.context-menu[role="menu"]');
  await menu.getByRole('menuitem', { name: 'Delete branch…' }).click();

  const confirmation = page.getByRole('alertdialog', { name: 'feature/partial-staging' });
  const cancel = confirmation.getByRole('button', { name: 'Cancel' });
  const forceDelete = confirmation.getByRole('checkbox', { name: /Force delete/ });
  const confirm = confirmation.getByRole('button', { name: 'Delete branch' });
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(confirm).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(forceDelete).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Escape');

  await expect(confirmation).toHaveCount(0);
  await expect(localBranch).toBeFocused();
});

test('never narrows Date / Time below its visible dates and times', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.reload();
  const separator = page.getByRole('separator', { name: 'Resize Date and Time column', exact: true });
  const clipped = () => page.locator('.commit-row .row-date').evaluateAll((cells) => cells.some((cell) =>
    [...cell.children, cell].some((part) => part.scrollWidth > part.clientWidth + 0.5)
      || [...cell.children].some((part) => part.getBoundingClientRect().right > cell.getBoundingClientRect().right - 6)));
  const minimum = Number(await separator.getAttribute('aria-valuemin'));
  expect(minimum).toBeGreaterThan(32);
  await separator.focus();
  await page.keyboard.press('Home');
  await expect.poll(() => separator.getAttribute('aria-valuenow')).toBe(String(minimum));
  expect(await clipped()).toBe(false);

  // A narrower width saved earlier is widened to fit the dates when the repository loads.
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) if (key.endsWith('column.date.width')) localStorage.setItem(key, '32');
  });
  await page.reload();
  await expect(page.locator('.commit-row .row-date').first()).toBeVisible();
  await expect.poll(clipped).toBe(false);
});

test('offers an explicit force delete when Git protects an unmerged branch', async ({ page }) => {
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    const snapshot = git.repository();
    const state = { calls: [] as Array<{ command: string; args: Record<string, unknown> }> };
    (window as any).__unmergedDeleteTest = state;
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string, args: Record<string, unknown> = {}) => {
        state.calls.push({ command, args });
        if (command === 'delete_branch' && !args['force']) {
          return Promise.reject({
            kind: 'branchNotMerged',
            message: 'feature/partial-staging has commits that are not merged into its upstream or the current branch.',
            hint: 'Deleting it anyway can make those commits unreachable from any branch.',
          });
        }
        if (command === 'delete_branch') {
          return Promise.resolve({
            ...snapshot,
            branches: snapshot.branches.filter((branch: { name: string }) => branch.name !== args['name']),
          });
        }
        if (command === 'refresh_repository') return Promise.resolve(snapshot);
        return Promise.reject(new Error(`Unexpected command: ${command}`));
      },
    };
  });
  const localBranch = page.getByRole('button', { name: 'Local branch feature/partial-staging' });
  await localBranch.focus();
  await page.keyboard.press('Shift+F10');
  await page.locator('.context-menu[role="menu"]').getByRole('menuitem', { name: 'Delete branch…' }).click();
  const confirmation = page.getByRole('alertdialog', { name: 'feature/partial-staging' });
  await confirmation.getByRole('button', { name: 'Delete branch' }).click();

  await expect(confirmation.getByRole('button', { name: 'Delete anyway' })).toBeVisible();
  await expect(confirmation).toContainText('not merged into its upstream or the current branch');
  await expect(confirmation.getByRole('checkbox', { name: /Force delete/ })).toHaveCount(0);
  await expect(page.getByText('Git needs attention')).toHaveCount(0);
  await expect(confirmation.getByRole('button', { name: 'Cancel' })).toBeFocused();

  await confirmation.getByRole('button', { name: 'Delete anyway' }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(page.getByText('Git needs attention')).toHaveCount(0);
  await expect(localBranch).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__unmergedDeleteTest.calls
    .filter((call: { command: string }) => call.command === 'delete_branch')
    .map((call: { args: Record<string, unknown> }) => call.args['force']))).toEqual([false, true]);
});

test('navigates branch-drop actions as a fitted desktop menu', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 560 });
  await page.getByRole('button', { name: 'Open left panel' }).click();
  const source = page.getByRole('button', { name: 'Local branch feature/partial-staging' });
  const target = page.getByRole('button', { name: /Local branch main, current/ });

  // Exercise a real drag, including the second target move needed for dragover
  // across browser implementations; hover also checks that the source is hit-testable.
  await source.hover();
  const sourceBox = await source.boundingBox();
  expect(sourceBox).not.toBeNull();
  await page.mouse.down();
  // Start dragging before the target's auto-scroll can move the source away
  // from the pressed pointer in the short, scrollable references drawer.
  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2 + 8, sourceBox!.y + sourceBox!.height / 2, { steps: 4 });
  await expect(source).toHaveClass(/branch-dragging/);
  await target.hover();
  await target.hover();
  await page.mouse.up();
  const menu = page.getByRole('menu', { name: 'Branch drop actions' });
  const fastForward = menu.getByRole('menuitem', { name: /Fast-forward main/ });
  const merge = menu.getByRole('menuitem', { name: /Merge feature\/partial-staging into main/ });
  const interactiveRebase = menu.getByRole('menuitem', { name: /Interactive Rebase/ });

  await expect(menu).toBeVisible();
  await expect(fastForward).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(merge).toBeFocused();
  await page.keyboard.press('End');
  await expect(interactiveRebase).toBeFocused();
  await page.keyboard.press('Home');
  await expect(fastForward).toBeFocused();
  await expect.poll(async () => {
    const bounds = await menu.boundingBox();
    return bounds
      ? bounds.x >= 8
        && bounds.y >= 8
        && bounds.x + bounds.width <= 992
        && bounds.y + bounds.height <= 552
      : false;
  }).toBe(true);

  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(target).toBeFocused();
});

test('prepares a commit cherry-pick by dragging its action onto a local branch', async ({ page }) => {
  const commit = page.locator('.commit-row[data-commit-oid]').filter({ hasText: 'Add hunk-level staging actions' });
  const dragHandle = commit.getByRole('button', { name: /Commit actions for Add hunk-level staging actions/ });
  const target = page.getByRole('button', { name: 'Local branch feature/partial-staging' });

  await expect(dragHandle).toHaveAttribute('draggable', 'true');
  await expect(dragHandle).toHaveAttribute('title', /Drag onto a local branch to cherry-pick/);
  await expect(target).toHaveAttribute('title', /Drop a commit here to cherry-pick/);
  await commit.hover();
  await dragHandle.dragTo(target);

  const confirmation = page.getByRole('alertdialog');
  const cancel = confirmation.getByRole('button', { name: 'Cancel' });
  const confirm = confirmation.getByRole('button', { name: 'Cherry-pick onto feature/partial-staging' });
  await expect(confirmation).toContainText('Cherry-pick onto feature/partial-staging');
  await expect(confirmation).toContainText('Switch to feature/partial-staging');
  await expect(confirm).toBeVisible();
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(confirm).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(confirmation.getByRole('checkbox', { name: 'Apply changes without creating commits' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(confirm).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirmation).toHaveCount(0);
  await expect(target).toBeFocused();
});

test('positions reference actions at the invocation point and keeps them inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 1000 });
  await page.getByRole('button', { name: 'Open left panel' }).click();
  await page.getByRole('button', { name: 'Tags 1' }).click();
  const tag = page.locator('.tag-item').filter({ hasText: 'v0.1.0' });

  await tag.evaluate((element) => element.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    button: 2,
    clientX: 700,
    clientY: 400,
  })));
  const menu = page.locator('.context-menu[role="menu"]').filter({ hasText: 'v0.1.0' });
  const bottomBoundary = await page.evaluate(() => innerHeight - 8 - (
    Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--statusbar-height')) || 0
  ));
  await expect(menu).toBeVisible();
  await expect.poll(async () => {
    const bounds = await menu.boundingBox();
    return bounds ? { x: bounds.x, y: bounds.y } : null;
  }).toEqual({ x: 700, y: 400 });

  await tag.evaluate((element) => element.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    button: 2,
    clientX: 700,
    clientY: 700,
  })));
  await expect.poll(async () => {
    const bounds = await menu.boundingBox();
    return bounds ? Math.round(bounds.y - Math.min(700, bottomBoundary - bounds.height)) : null;
  }).toBe(0);

  await tag.evaluate((element) => element.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    button: 2,
    clientX: 995,
    clientY: 995,
  })));
  await expect.poll(async () => {
    const bounds = await menu.boundingBox();
    return bounds ? {
      right: Math.round(bounds.x + bounds.width),
      bottom: Math.round(bounds.y + bounds.height),
    } : null;
  }).toEqual({ right: 992, bottom: bottomBoundary });
});

test('previews annotated tags without loading their messages into the graph', async ({ page }) => {
  await page.getByRole('button', { name: 'Tags 1' }).click();
  const tag = page.locator('.tag-item').filter({ hasText: 'v0.1.0' });

  await tag.dispatchEvent('mouseenter');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  const preview = page.getByRole('tooltip');
  await expect(preview).toBeVisible();
  await expect(tag).toHaveAttribute('aria-describedby', 'tag-reference-preview');
  await expect(preview).toContainText('Annotated tag');
  await expect(preview).toContainText('First Git Khronos preview release');
  await expect(preview).toContainText('Maya Chen');
  await expect(preview).toContainText('v0.1.0');
  await expect(preview.locator('header small')).toHaveCSS('font-size', '12px');
  await expect(preview.locator('footer')).toHaveCSS('font-size', '12px');

  await tag.dispatchEvent('mouseleave');
  await expect(preview).toBeHidden();
  await tag.focus();
  await expect(preview).toBeVisible();
  await tag.blur();
  await expect(preview).toBeHidden();
});

test('keeps tag previews behind modal surfaces', async ({ page }) => {
  await page.getByRole('button', { name: 'Tags 1' }).click();
  const tag = page.locator('.tag-item').filter({ hasText: 'v0.1.0' });
  await tag.dispatchEvent('mouseenter');

  const preview = page.getByRole('tooltip');
  await expect(preview).toBeVisible();
  const previewBox = await preview.boundingBox();
  const previewLayer = await preview.evaluate((element) => Number(getComputedStyle(element).zIndex));
  expect(previewBox).not.toBeNull();

  await page.keyboard.press('Control+P');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  const modalLayer = await page.locator('.palette-backdrop').evaluate((element) => Number(getComputedStyle(element).zIndex));
  expect(previewLayer).toBeLessThan(modalLayer);
  expect(await page.evaluate(({ x, y }) => {
    return document.elementFromPoint(x, y)?.closest('.tag-reference-preview') === null;
  }, {
    x: previewBox!.x + previewBox!.width / 2,
    y: previewBox!.y + previewBox!.height / 2,
  })).toBe(true);
});

test('jumps from tags and stashes to their graph entries', async ({ page }) => {
  await page.getByRole('button', { name: 'Tags 1' }).click();
  const tag = page.locator('.tag-item').filter({ hasText: 'v0.1.0' });
  await expect(tag).toHaveAttribute('aria-label', 'Tag v0.1.0');
  await expect(tag).toHaveAttribute('title', /Tag v0\.1\.0/);
  await tag.click();
  await expect(tag).toHaveClass(/current/);
  await expect(page.locator('.commit-row.selected')).toContainText('Add hunk-level staging actions');
  await expect(page.locator('.commit-panel')).toContainText('Add hunk-level staging actions');

  await page.getByRole('button', { name: 'Stashes 1' }).click();
  const stash = page.locator('.stash-item').first();
  await expect(stash).toHaveAttribute('aria-label', 'Stash stash@{0}, WIP on graph polish');
  await expect(stash).toHaveAttribute('title', /Stash stash@\{0\}: WIP on graph polish/);
  await expect(stash).toHaveAttribute('aria-haspopup', 'menu');
  await stash.focus();
  await page.keyboard.press('Shift+F10');
  let stashActionMenu = page.getByRole('menu', { name: 'Stash actions' });
  await expect(stashActionMenu.getByRole('menuitem', { name: 'Apply Stash' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(stash).toBeFocused();
  await stash.click();
  await expect(stash).toHaveClass(/current/);
  await expect(page.locator('.commit-row.selected')).toContainText('WIP on graph polish');
  const stashPanel = page.locator('.commit-panel');
  await expect(stashPanel.locator('.panel-title')).toContainText('Stash');
  const applyStash = stashPanel.getByRole('button', { name: 'Apply Stash Keep saved' });
  const popStash = stashPanel.getByRole('button', { name: 'Pop Stash Remove after applying' });
  await expect(applyStash).toHaveAttribute('title', 'Apply the stash and keep it saved');
  await expect(popStash).toHaveAttribute('title', 'Apply the stash and remove it after success');
  await expect(applyStash.locator('small')).toHaveText('Keep saved');
  await expect(popStash.locator('small')).toHaveText('Remove after applying');
  await expect(applyStash).toHaveCSS('color', 'rgb(158, 229, 209)');
  await expect(popStash).toHaveCSS('color', 'rgb(225, 184, 102)');
  let [applyBox, popBox] = await Promise.all([applyStash.boundingBox(), popStash.boundingBox()]);
  expect(applyBox).not.toBeNull();
  expect(popBox).not.toBeNull();
  expect(Math.round(applyBox!.y)).toBe(Math.round(popBox!.y));
  expect(popBox!.x).toBeGreaterThan(applyBox!.x);

  await page.setViewportSize({ width: 780, height: 720 });
  // Read both rectangles in one frame: the compact inspector animates in,
  // so separate protocol reads can compare different transform positions.
  await expect.poll(() => stashPanel.locator('.selected-stash-actions').evaluate(element => {
    const [apply, pop] = Array.from(element.querySelectorAll('button'), button => button.getBoundingClientRect());
    return Math.round(apply.x) === Math.round(pop.x) && pop.y > apply.y;
  })).toBe(true);
  expect(await stashPanel.locator('.selected-stash-actions').evaluate((element) => element.scrollWidth)).toBe(
    await stashPanel.locator('.selected-stash-actions').evaluate((element) => element.clientWidth),
  );
  const stashActions = stashPanel.getByRole('button', { name: 'Stash actions' });
  await expect(stashActions.locator('gc-icon svg')).toBeVisible();
  await expect(stashActions).toHaveAttribute('aria-expanded', 'false');
  await stashActions.click();
  stashActionMenu = page.getByRole('menu', { name: 'Stash actions' });
  await expect(stashActionMenu).toBeVisible();
  await expect(stashActionMenu.getByRole('menuitem', { name: 'Apply Stash' })).toBeFocused();
  await expect(stashActions).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(stashActions).toHaveAttribute('aria-expanded', 'false');
  await expect(stashActions).toBeFocused();
  await expect(page.getByRole('button', { name: /Switch branch, current main/ })).toBeVisible();
});

test('exposes consistent remote branch actions wherever a reference appears', async ({ page }) => {
  const sidebarRemote = page.locator('#reference-section-local').getByLabel('Remote branch origin/main', { exact: true });
  await sidebarRemote.click({ button: 'right' });
  let menu = page.locator('.context-menu[role="menu"]').filter({ hasText: 'origin/main' });
  await expect(menu.getByText('Remote branch', { exact: true })).toBeVisible();
  await expect(menu.locator('.context-section-label')).toHaveText([
    'Checkout and inspect',
    'Manage remote branch',
  ]);
  await expect(menu.getByRole('menuitem', { name: 'Create local tracking branch' })).toBeFocused();
  await expect(menu.getByRole('menuitem', { name: 'Copy remote branch name' })).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Create local tracking branch',
    'Share repository context…',
    'Copy remote branch name',
    'Compare with working directory',
    'Delete branch on remote…',
    'Create branch here…',
    'Create tag here…',
  ]);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(sidebarRemote).toBeFocused();

  const graphStack = page.locator('[data-commit-oid="83e6d15fb82672899688b93f59251dfc669888a3"] .commit-ref-stack');
  await graphStack.locator('.reference-stack-trigger').focus();
  await page.keyboard.press('Enter');
  const graphRemote = graphStack.getByRole('menuitem', { name: 'Remote branch origin/main' });
  await expect(graphRemote).toBeVisible();
  await graphRemote.click({ button: 'right' });
  menu = page.locator('.context-menu[role="menu"]').filter({ hasText: 'origin/main' });
  await expect(menu.getByRole('menuitem', { name: 'Create local tracking branch' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  await page.locator('[data-commit-oid="83e6d15fb82672899688b93f59251dfc669888a3"]').click();
  const detailStack = page.locator('.commit-detail-ref-stack');
  const detailTrigger = detailStack.locator('.detail-reference-stack-trigger');
  await expect(detailTrigger.locator('.reference-stack-label')).toHaveText('main');
  await expect(detailTrigger).not.toContainText('origin/main');
  await expect(detailTrigger).not.toContainText('upstream/main');
  await expect(detailTrigger.locator('.reference-stack-locations gc-icon')).toHaveCount(2);
  await detailTrigger.focus();
  await page.keyboard.press('Shift+F10');
  await expect(detailStack.getByRole('menuitem', { name: 'Remote branch origin/main' })).toBeFocused();
  await expect(page.locator('.context-menu')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(detailTrigger).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(detailStack.locator('.grouped-reference-row')).toHaveCount(1);
  await expect(detailStack.locator('.grouped-reference-label')).toHaveText('main');
  await page.keyboard.press('ArrowDown');
  await expect(detailStack.getByRole('menuitem', { name: 'Remote branch origin/main' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(detailTrigger).toBeFocused();
  await expect(detailTrigger).toHaveAttribute('aria-expanded', 'false');
  await expect(detailStack.locator('.detail-reference-popover')).toBeHidden();
  await page.keyboard.press('Enter');
  const detailRemote = detailStack.getByRole('menuitem', { name: 'Remote branch origin/main' });
  await detailRemote.click({ button: 'right' });
  await expect(page.locator('.context-menu[role="menu"]').filter({ hasText: 'origin/main' }).getByText('Remote branch', { exact: true })).toBeVisible();
});

test('compares local and remote branch tips with the working directory', async ({ page }) => {
  const wipNode = page.locator('.wip-row').first().locator('.wip-node');
  const localBranch = page.locator('.branch-item').filter({ hasText: 'feature/partial-staging' }).first();
  await localBranch.click({ button: 'right' });
  let menu = page.getByRole('menu').filter({ hasText: 'feature/partial-staging' });
  await menu.getByRole('menuitem', { name: 'Compare with working directory' }).click();

  const panel = page.locator('.commit-panel');
  await expect(panel.getByText('Commit compared with WIP')).toBeVisible();
  await expect(panel.getByLabel('Selected commit range')).toContainText('Refine graph lane rendering');
  await expect(page.locator('.commit-row.range-selected')).toHaveCount(2);

  await wipNode.click();
  const remoteBranch = page.locator('#reference-section-local').getByLabel('Remote branch origin/main', { exact: true });
  await remoteBranch.click({ button: 'right' });
  menu = page.getByRole('menu').filter({ hasText: 'origin/main' });
  await menu.getByRole('menuitem', { name: 'Compare with working directory' }).click();
  await expect(panel.getByLabel('Selected commit range')).toContainText('Merge feature/partial-staging');
  await expect(page.locator('.commit-row.range-selected')).toHaveCount(2);
});

test('configures a local branch upstream from its context menu', async ({ page }) => {
  const main = page.locator('.branch-item').filter({ hasText: /^main/ }).first();
  await main.click({ button: 'right' });
  let menu = page.getByRole('menu').filter({ hasText: 'main' });
  await expect(menu.getByRole('menuitem', { name: 'Change upstream…' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Unset upstream origin\/main/ })).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Change upstream…' }).click();

  let dialog = page.getByRole('dialog', { name: 'Set upstream for main' });
  const upstream = dialog.getByLabel('Upstream branch');
  await expect(upstream).toHaveValue('origin/main');
  await expect(upstream.locator('option')).toHaveCount(6);
  await upstream.selectOption('upstream/main');
  await expect(upstream).toHaveValue('upstream/main');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  const feature = page.locator('.branch-item').filter({ hasText: 'feature/partial-staging' }).first();
  await feature.click({ button: 'right' });
  menu = page.getByRole('menu').filter({ hasText: 'feature/partial-staging' });
  await menu.getByRole('menuitem', { name: 'Set upstream…' }).click();
  dialog = page.getByRole('dialog', { name: 'Set upstream for feature/partial-staging' });
  await expect(dialog.getByLabel('Upstream branch')).toHaveValue('origin/docs');
  await expect(dialog.getByRole('button', { name: 'Set Upstream' })).toBeEnabled();
});

test('searches local and remote branches from the repository breadcrumb', async ({ page }) => {
  const branchToggle = page.getByRole('button', { name: /Switch branch, current main/ });
  await expect(branchToggle.locator('.toolbar-nav-leading-icon')).toBeVisible();
  await branchToggle.click();
  const picker = page.locator('.branch-nav-menu');
  const search = picker.getByRole('searchbox', { name: 'Filter branches' });
  await expect(search).toBeVisible();
  await expect(search).toBeFocused();
  await expect(search).toHaveAttribute('aria-describedby', 'branch-picker-result-count');
  await expect(picker.getByText('Local branches', { exact: true })).toBeVisible();
  await expect(picker.getByText('Remote branches', { exact: true })).toBeVisible();
  const currentBranchChoice = picker.getByRole('button', { name: /main Current branch · origin\/main · ahead 1/ });
  await expect(currentBranchChoice).toBeVisible();
  await expect(currentBranchChoice).toHaveAttribute('aria-current', 'true');
  await expect(currentBranchChoice.locator('.branch-picker-location-icon')).toBeVisible();
  await expect(currentBranchChoice.locator('.branch-picker-current')).toBeVisible();
  const currentBranchContext = currentBranchChoice.locator('small');
  await expect(currentBranchContext).toHaveAttribute('title', 'Current branch · origin/main · ahead 1');
  expect(await currentBranchContext.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  const trackedRelease = picker.getByRole('button', { name: /release Local branch · origin\/release/ });
  await expect(trackedRelease.locator('small')).toHaveAttribute('title', 'Local branch · origin/release');
  const [branchIconBox, branchCopyBox, branchStateBox] = await Promise.all([
    currentBranchChoice.locator('.branch-picker-location-icon').boundingBox(),
    currentBranchChoice.locator(':scope > span').first().boundingBox(),
    currentBranchChoice.locator('.toolbar-branch-state').boundingBox(),
  ]);
  expect(branchIconBox).not.toBeNull();
  expect(branchCopyBox).not.toBeNull();
  expect(branchStateBox).not.toBeNull();
  expect(branchIconBox!.x + branchIconBox!.width).toBeLessThan(branchCopyBox!.x);
  expect(branchCopyBox!.x + branchCopyBox!.width).toBeLessThanOrEqual(branchStateBox!.x);
  await expect(picker.locator('#branch-picker-result-count')).toHaveText(/^\d+ of \d+ branch choices shown$/);
  const createBranch = picker.locator('.branch-picker-footer button');
  await expect(createBranch).toContainText('Create branch');
  await expect(createBranch).toContainText('From current HEAD');
  await expect(createBranch).toHaveAttribute('aria-keyshortcuts', 'Control+B Meta+B');
  await expect(createBranch.locator('kbd')).toHaveText('Ctrl B');

  await search.fill('feature/partial');
  await expect(picker.getByRole('button', { name: /feature\/partial-staging/ })).toBeVisible();
  await expect(picker.getByRole('button', { name: /main Current branch/ })).toBeHidden();

  await search.fill('upstream');
  const trackedMain = picker.getByRole('button', { name: /main Current branch/ });
  await expect(trackedMain).toBeVisible();
  await expect(trackedMain.locator('.toolbar-branch-locations [aria-label="Remote location upstream"]')).toBeVisible();
  const remoteDocs = picker.getByRole('button', { name: /Remote branch docs, create local tracking branch from origin\/docs, 2 locations/ });
  await expect(remoteDocs).toBeVisible();
  await expect(remoteDocs.locator('.toolbar-branch-locations [aria-label="Remote location origin"]')).toBeVisible();
  await expect(remoteDocs.locator('.toolbar-branch-locations [aria-label="Remote location upstream"]')).toBeVisible();
  await expect(picker.getByRole('button', { name: /Remote branch upstream\/docs/ })).toHaveCount(0);
  await search.fill('does-not-exist');
  await expect(picker.getByText('No branches found')).toBeVisible();

  await search.fill('');
  await search.press('ArrowDown');
  const currentBranch = picker.getByRole('button', { name: /main Current branch · origin\/main · ahead 1/ });
  const featureBranch = picker.getByRole('button', { name: /feature\/partial-staging Local branch/ });
  const docsBranch = picker.getByRole('button', { name: /Remote branch docs, create local tracking branch from origin\/docs, 2 locations/ });
  await expect(currentBranch).toBeFocused();
  await currentBranch.press('ArrowDown');
  await expect(featureBranch).toBeFocused();
  await featureBranch.press('End');
  await expect(docsBranch).toBeFocused();
  await docsBranch.press('Home');
  await expect(currentBranch).toBeFocused();
  await currentBranch.press('Escape');
  await expect(picker).toBeHidden();
  await expect(branchToggle).toBeFocused();

  await branchToggle.click();
  await search.fill('main');
  await search.press('Enter');
  await expect(picker).toBeHidden();
  await branchToggle.click();
  await expect(search).toBeFocused();
  await search.press('Escape');
  await expect(picker).toBeHidden();
  await expect(branchToggle).toBeFocused();

  await branchToggle.click();
  await picker.locator('.branch-picker-footer button').click();
  const branchName = page.getByRole('textbox', { name: 'New branch name' });
  await expect(branchName).toBeFocused();
  await page.getByRole('button', { name: 'Cancel branch creation' }).click();
});

test('carries an unmatched branch search into the reviewed creation form', async ({ page }) => {
  const branchToggle = page.getByRole('button', { name: /Switch branch, current main/ });
  await branchToggle.click();
  const picker = page.getByRole('dialog', { name: 'Switch branch' });
  const search = picker.getByRole('searchbox', { name: 'Filter branches' });
  await search.fill('review/picker-context');

  await expect(picker.getByText('No branches found')).toBeVisible();
  const create = picker.getByRole('button', { name: 'Create branch review/picker-context from current HEAD' });
  await expect(create).toContainText('Create “review/picker-context”');
  await expect(create.locator('strong')).toHaveAttribute('title', 'Create branch review/picker-context');

  await search.press('Enter');
  await expect(picker).toBeHidden();
  const branchName = page.getByRole('textbox', { name: 'New branch name' });
  await expect(branchName).toBeFocused();
  await expect(branchName).toHaveValue('review/picker-context');
  await expect(page.getByRole('form', { name: 'Create branch' })).toContainText('From main at HEAD');
});

test('selects and persists the remote used for pull and push', async ({ page }) => {
  let remoteToggle = page.getByRole('button', { name: 'Select remote, current origin' });
  await remoteToggle.click();
  let picker = page.getByRole('menu', { name: 'Select remote for pull and push' });
  const origin = picker.getByRole('menuitemradio', { name: /origin/ });
  const upstream = picker.getByRole('menuitemradio', { name: /upstream/ });

  await expect(origin).toBeFocused();
  await expect(origin).toHaveAttribute('aria-checked', 'true');
  await expect(origin).toContainText('Selected');
  await expect(origin.locator('.remote-picker-location-icon')).toBeVisible();
  await expect(origin.locator('.remote-picker-selected')).toBeVisible();
  await expect(upstream.locator('.remote-picker-location-icon')).toBeVisible();
  await expect(upstream.locator('.remote-picker-selected')).toHaveCount(0);
  const [originIconBox, originCopyBox, originSelectedBox] = await Promise.all([
    origin.locator('.remote-picker-location-icon').boundingBox(),
    origin.locator('.remote-picker-copy').boundingBox(),
    origin.locator('.remote-picker-selected').boundingBox(),
  ]);
  expect(originIconBox).not.toBeNull();
  expect(originCopyBox).not.toBeNull();
  expect(originSelectedBox).not.toBeNull();
  expect(originIconBox!.x + originIconBox!.width).toBeLessThan(originCopyBox!.x);
  expect(originCopyBox!.x + originCopyBox!.width).toBeLessThanOrEqual(originSelectedBox!.x);
  await expect(origin.locator('.remote-picker-url b')).toHaveText('Fetch & push');
  const originUrl = origin.locator('.remote-picker-url > span');
  await expect(originUrl).toHaveAttribute('title', 'git@github.com:example/git-khronos.git');
  await expect(originUrl).toHaveCSS('white-space', 'nowrap');
  await expect(originUrl).toHaveCSS('text-overflow', 'ellipsis');
  const [pickerBeforeNavigation, originBeforeNavigation, upstreamBeforeNavigation] = await Promise.all([
    picker.boundingBox(),
    origin.boundingBox(),
    upstream.boundingBox(),
  ]);
  await origin.press('ArrowDown');
  await expect(upstream).toBeFocused();
  await expect(originUrl).toHaveCSS('white-space', 'nowrap');
  const [pickerAfterNavigation, originAfterNavigation, upstreamAfterNavigation] = await Promise.all([
    picker.boundingBox(),
    origin.boundingBox(),
    upstream.boundingBox(),
  ]);
  expect(pickerBeforeNavigation).not.toBeNull();
  expect(originBeforeNavigation).not.toBeNull();
  expect(upstreamBeforeNavigation).not.toBeNull();
  expect(pickerAfterNavigation).not.toBeNull();
  expect(originAfterNavigation).not.toBeNull();
  expect(upstreamAfterNavigation).not.toBeNull();
  expect(Math.abs(pickerBeforeNavigation!.height - pickerAfterNavigation!.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(originBeforeNavigation!.height - originAfterNavigation!.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(upstreamBeforeNavigation!.height - upstreamAfterNavigation!.height)).toBeLessThanOrEqual(1);
  await upstream.press('End');
  const addRemote = picker.getByRole('menuitem', { name: /Add remote Configure fetch and push URLs/ });
  await expect(addRemote).toBeFocused();
  await addRemote.press('Home');
  await expect(origin).toBeFocused();
  await origin.press('ArrowDown');
  await expect(upstream).toBeFocused();
  await upstream.press('Enter');
  await expect(picker).toBeHidden();
  await expect(page.getByRole('button', { name: 'Pull from upstream/main' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Push to upstream/main' })).toBeVisible();

  await page.reload();
  remoteToggle = page.getByRole('button', { name: 'Select remote, current upstream' });
  await expect(remoteToggle).toBeVisible();
  await remoteToggle.click();
  picker = page.getByRole('menu', { name: 'Select remote for pull and push' });
  const persistedUpstream = picker.getByRole('menuitemradio', { name: /upstream/ });
  await expect(persistedUpstream).toHaveAttribute('aria-checked', 'true');
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    app.git.repositories.update((repositories: any[]) => repositories.map((repository) => ({
      ...repository,
      remotes: repository.remotes.map((remote: any) => remote.name === 'upstream'
        ? { ...remote, pushUrl: 'git@github.com:example/git-khronos-fork.git' }
        : remote),
    })));
  });
  await expect(persistedUpstream.locator('.remote-picker-url b')).toHaveText(['Fetch', 'Push']);
  const remoteUrls = persistedUpstream.locator('.remote-picker-url > span');
  await expect(remoteUrls.nth(0)).toHaveAttribute('title', 'https://github.com/example/git-khronos.git');
  await expect(remoteUrls.nth(1)).toHaveAttribute('title', 'git@github.com:example/git-khronos-fork.git');
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await expect(remoteToggle).toBeFocused();
});

test('keeps remote setup reachable when the repository has no remotes', async ({ page }) => {
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    app.git.repositories.update((repositories: any[]) => repositories.map((repository) => ({
      ...repository,
      remotes: [],
    })));
  });

  const remoteToggle = page.getByRole('button', { name: 'Select remote, current none' });
  await remoteToggle.click();
  const picker = page.getByRole('menu', { name: 'Select remote for pull and push' });
  await expect(picker.getByText('No remotes configured')).toBeVisible();
  const addRemote = picker.getByRole('menuitem', { name: /Add remote Configure fetch and push URLs/ });
  await expect(addRemote).toBeFocused();
  await addRemote.press('Escape');
  await expect(picker).toBeHidden();
  await expect(remoteToggle).toBeFocused();
});

test('switches complete repository tab sets with persistent workspaces', async ({ page }) => {
  let workspaceToggle = page.getByRole('button', { name: 'Workspace: Default' });
  await expect(workspaceToggle).toHaveCSS('font-size', '13px');
  await expect(workspaceToggle.locator('small')).toHaveText('1');
  await expect(workspaceToggle.locator('small')).toHaveAttribute('title', '1 repository in this workspace');
  await workspaceToggle.click();
  let menu = page.getByRole('menu', { name: 'Workspaces' });
  await expect(menu).toHaveCSS('width', '310px');
  await expect(menu.getByRole('menuitemradio', { name: /Default/ }).locator('strong')).toHaveCSS('font-size', '13px');
  await expect(menu.getByRole('menuitemradio', { name: /Default/ }).locator('small')).toHaveCSS('font-size', '12px');
  await expect(menu.getByRole('menuitemradio', { name: /Default/ }).locator('small > span')).toHaveText('git-khronos');
  await expect(menu.getByRole('menuitemradio', { name: /Default/ }).locator('small > b')).toHaveText('1');
  await expect(menu.getByRole('menuitemradio', { name: /Default/ }).locator('kbd')).toHaveText('Ctrl ⇧ 1');
  await expect(menu.getByRole('menuitemradio', { name: /Default/ })).toHaveAttribute('aria-keyshortcuts', 'Control+Shift+1 Meta+Shift+1');
  await expect(menu.getByRole('menuitemradio', { name: /Default/ })).toHaveAccessibleName('Default, current workspace, 1 repository, git-khronos');
  await expect(menu.getByRole('menuitem', { name: 'New workspace' })).toHaveCSS('font-size', '13px');
  await expect(menu.getByRole('menuitemradio', { name: /Default/ })).toHaveAttribute('aria-checked', 'true');
  await menu.getByRole('menuitem', { name: 'New workspace' }).click();

  let dialog = page.getByRole('dialog', { name: 'New Workspace' });
  const workspaceName = dialog.getByLabel('Workspace name');
  const workspaceClose = dialog.getByRole('button', { name: 'Close workspace dialog' });
  const workspaceLastEnabled = dialog.locator('button:not(:disabled)').last();
  await expect(workspaceName).toBeFocused();
  await workspaceClose.focus();
  await workspaceClose.press('Shift+Tab');
  await expect(workspaceLastEnabled).toBeFocused();
  await workspaceLastEnabled.press('Tab');
  await expect(workspaceClose).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(workspaceToggle).toBeFocused();

  await workspaceToggle.click();
  menu = page.getByRole('menu', { name: 'Workspaces' });
  await menu.getByRole('menuitem', { name: 'New workspace' }).click();
  dialog = page.getByRole('dialog', { name: 'New Workspace' });
  await dialog.getByLabel('Workspace name').fill('Client project');
  await dialog.getByRole('button', { name: 'Create Workspace' }).click();

  await expect(page.locator('.welcome')).toBeVisible();
  workspaceToggle = page.getByRole('button', { name: 'Workspace: Client project' });
  await workspaceToggle.click();
  menu = page.getByRole('menu', { name: 'Workspaces' });
  const workspaceItems = menu.getByRole('menuitemradio');
  await expect(workspaceItems.first()).toHaveAccessibleName('Client project, current workspace, 0 repositories, No repositories yet');
  await expect(workspaceItems.first().locator('kbd')).toHaveText('Ctrl ⇧ 2');
  await expect(workspaceItems.first()).toHaveAttribute('aria-keyshortcuts', 'Control+Shift+2 Meta+Shift+2');
  await expect(workspaceItems.first().locator('small > span')).toHaveText('No repositories yet');
  await expect(workspaceItems.nth(1)).toHaveAccessibleName('Default, 1 repository, git-khronos');
  await expect(workspaceItems.nth(1).locator('kbd')).toHaveText('Ctrl ⇧ 1');
  await page.keyboard.press('Escape');
  await expect(workspaceToggle).toBeFocused();

  const paletteOpener = workspaceToggle;
  await paletteOpener.focus();
  await page.keyboard.press('Control+P');
  const renamePalette = page.getByRole('dialog', { name: 'Command palette' });
  await renamePalette.getByRole('combobox', { name: 'Search commands' }).fill('rename current workspace');
  await renamePalette.getByRole('option', { name: /^Rename Current Workspace/ }).click();
  dialog = page.getByRole('dialog', { name: 'Rename Workspace' });
  await expect(dialog.getByLabel('Workspace name')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(paletteOpener).toBeFocused();

  await workspaceToggle.click();
  menu = page.getByRole('menu', { name: 'Workspaces' });
  await menu.getByRole('menuitem', { name: 'Rename current' }).click();
  dialog = page.getByRole('dialog', { name: 'Rename Workspace' });
  await dialog.getByLabel('Workspace name').fill('Client context');
  await dialog.getByRole('button', { name: 'Save Name' }).click();
  await expect(page.getByRole('button', { name: 'Workspace: Client context' })).toBeVisible();

  await page.reload();
  await expect(page.locator('.welcome')).toBeVisible();
  await page.keyboard.press('Control+P');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  const paletteSearch = palette.getByRole('combobox', { name: 'Search commands' });
  await paletteSearch.fill('Switch to Default');
  await expect(palette.getByRole('option', { name: /Switch to Default/ }).locator('.palette-inline-group')).toHaveText('Workspace');
  await expect(palette.getByRole('option', { name: /Switch to Default/ })).toContainText('1 repository');
  await paletteSearch.press('Enter');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Workspace: Default' })).toBeFocused();

  await page.keyboard.press('Control+Shift+2');
  await expect(page.locator('.welcome')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Workspace: Client context' })).toBeFocused();
  await page.keyboard.press('Control+Shift+1');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Workspace: Default' })).toBeFocused();

  await page.getByRole('button', { name: 'Workspace: Default' }).click();
  menu = page.getByRole('menu', { name: 'Workspaces' });
  await menu.getByRole('menuitemradio', { name: /Client context/ }).click();
  await expect(page.locator('.welcome')).toBeVisible();
  await page.getByRole('button', { name: 'Workspace: Client context' }).click();
  menu = page.getByRole('menu', { name: 'Workspaces' });
  await menu.getByRole('menuitem', { name: 'Delete current' }).click();
  let confirmation = page.getByRole('alertdialog', { name: 'Client context' });
  await expect(confirmation).toContainText('Repositories and files on disk are not changed');
  const deleteCancel = confirmation.getByRole('button', { name: 'Cancel' });
  const deleteConfirm = confirmation.getByRole('button', { name: 'Delete Workspace' });
  await expect(deleteCancel).toBeFocused();
  await deleteCancel.press('Shift+Tab');
  await expect(deleteConfirm).toBeFocused();
  await deleteConfirm.press('Tab');
  await expect(deleteCancel).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirmation).toBeHidden();
  workspaceToggle = page.getByRole('button', { name: 'Workspace: Client context' });
  await expect(workspaceToggle).toBeFocused();

  await workspaceToggle.click();
  menu = page.getByRole('menu', { name: 'Workspaces' });
  await menu.getByRole('menuitem', { name: 'Delete current' }).click();
  confirmation = page.getByRole('alertdialog', { name: 'Client context' });
  await confirmation.getByRole('button', { name: 'Delete Workspace' }).click();
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Workspace: Default' })).toBeVisible();
});

test('finds repositories, references, and changed files from the command palette', async ({ page }) => {
  await page.keyboard.press('Control+P');
  const search = page.getByRole('combobox', { name: 'Search commands' });
  const palette = page.locator('.command-palette');
  await expect(palette.locator('.palette-search gc-icon svg circle')).toHaveAttribute('r', '7');
  await expect(search).toHaveAttribute('placeholder', 'Search commands, repos, refs, and files');
  await expect(palette.locator('.palette-group-heading').first()).toHaveText('Quick Actions');
  await expect(palette.getByRole('option').filter({ hasText: 'Fetch All' })).toHaveCount(1);
  await expect(palette.getByRole('option', { name: /^Pull(?:\s|$)/ })).toHaveCount(1);
  await expect(palette.locator('.palette-result-count')).toContainText('commands');
  await expect(palette.locator('.palette-search-hint')).toHaveText('Commands · repos · refs · files');
  await expect(palette.locator('.palette-group-heading').filter({ hasText: 'Repository' })).toHaveCount(1);
  await expect(palette.locator('.palette-action-copy small')).toHaveCount(0);

  await search.fill('no-such-command-or-repository-item');
  await expect(palette.locator('.palette-empty')).toContainText('No matching commands, repositories, references, or files');

  await search.fill('undo');
  const undo = page.getByRole('option').filter({ hasText: 'No supported repository action to undo' });
  await expect(undo).toContainText('Ctrl Z');
  await expect(undo).toBeDisabled();

  await search.fill('redo');
  const redo = page.getByRole('option').filter({ hasText: 'No supported repository action to redo' });
  await expect(redo).toContainText('Ctrl Y');
  await expect(redo).toBeDisabled();

  await search.fill('clone repository');
  await page.getByRole('option').filter({ hasText: 'Clone Repository' }).click();
  await expect(page.getByRole('heading', { name: 'Clone a Repository' })).toBeVisible();
  await page.getByRole('button', { name: 'Close repository management' }).click();

  await page.keyboard.press('Control+P');
  await expect(palette.getByRole('option').first()).toContainText('Clone Repository');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('git-khronos.ui.recent-commands'))).toBe('["clone"]');
  await page.getByRole('combobox', { name: 'Search commands' }).fill('initialize repository');
  await page.getByRole('option').filter({ hasText: 'Initialize Repository' }).click();
  await expect(page.getByRole('heading', { name: 'Initialize a Repository' })).toBeVisible();
  await page.getByRole('button', { name: 'Close repository management' }).click();

  await page.keyboard.press('Control+P');
  await page.getByRole('combobox', { name: 'Search commands' }).fill('create tag');
  await page.getByRole('option').filter({ hasText: 'Create Tag' }).click();
  const createTag = page.getByRole('dialog', { name: /Create tag at/ });
  await expect(createTag.getByRole('textbox', { name: 'Tag name' })).toBeFocused();
  await expect(createTag.getByRole('radio', { name: /Lightweight/ })).toBeChecked();
  await createTag.getByRole('radio', { name: /Annotated/ }).check();
  await expect(createTag.getByRole('textbox', { name: 'Tag message' })).toBeVisible();
  await expect(createTag.getByRole('button', { name: 'Create Tag' })).toBeDisabled();
  await createTag.getByRole('textbox', { name: 'Tag name' }).fill('v1.0.0-preview');
  await createTag.getByRole('textbox', { name: 'Tag message' }).fill('Preview release');
  await expect(createTag.getByRole('button', { name: 'Create Tag' })).toBeEnabled();
  await createTag.getByRole('button', { name: 'Cancel' }).click();

  await page.keyboard.press('Control+P');
  await page.getByRole('combobox', { name: 'Search commands' }).fill('apply stash 0');
  await expect(page.getByRole('option').filter({ hasText: 'Apply stash@{0}' })).toContainText('Keep this stash');

  await search.fill('file');
  const paletteResults = page.locator('.palette-results');
  const initialSelection = paletteResults.locator('[aria-selected="true"]');
  expect(await page.getByRole('option').count()).toBeGreaterThan(6);
  await expect(initialSelection).toHaveAttribute('id', 'command-palette-option-0');
  await search.press('ArrowDown');
  await expect(paletteResults.locator('[aria-selected="true"]')).toHaveAttribute('id', 'command-palette-option-1');
  await search.press('PageDown');
  const pagedSelection = paletteResults.locator('[aria-selected="true"]');
  await expect(pagedSelection).toBeVisible();
  await expect(pagedSelection).toHaveAttribute('id', 'command-palette-option-7');
  const [resultsBox, selectionBox] = await Promise.all([paletteResults.boundingBox(), pagedSelection.boundingBox()]);
  expect(resultsBox && selectionBox && selectionBox.y >= resultsBox.y && selectionBox.y + selectionBox.height <= resultsBox.y + resultsBox.height).toBe(true);
  await search.press('Home');
  await expect(paletteResults.locator('[aria-selected="true"]')).toHaveAttribute('id', 'command-palette-option-0');

  await search.fill('feature partial');
  await expect(page.getByRole('option').filter({ hasText: 'Checkout feature/partial-staging' })).toBeVisible();

  await search.fill('rename feature partial');
  await page.getByRole('option').filter({ hasText: 'Rename feature/partial-staging' }).click();
  const renameBranch = page.getByRole('dialog', { name: 'Rename branch feature/partial-staging' });
  await expect(renameBranch.getByRole('textbox', { name: 'New branch name' })).toHaveValue('feature/partial-staging');
  await renameBranch.getByRole('button', { name: 'Cancel' }).click();

  await page.keyboard.press('Control+P');
  await page.getByRole('combobox', { name: 'Search commands' }).fill('delete feature partial');
  await page.getByRole('option').filter({ hasText: 'Delete feature/partial-staging' }).click();
  const deleteBranch = page.getByRole('alertdialog').filter({ hasText: 'Delete branch' });
  await expect(deleteBranch).toContainText('feature/partial-staging');
  await deleteBranch.getByRole('button', { name: 'Cancel' }).click();

  await page.keyboard.press('Control+P');

  await search.fill('upstream main');
  await expect(page.getByRole('option').filter({ hasText: 'Track upstream/main' })).toContainText(
    'Create and checkout a local tracking branch',
  );

  await search.fill('v0.1.0');
  await page.getByRole('option').filter({ hasText: 'View tag v0.1.0' }).click();
  await expect(page.locator('.commit-panel')).toContainText('Add hunk-level staging actions');

  await page.keyboard.press('Control+P');
  await page.getByRole('combobox', { name: 'Search commands' }).fill('stash graph polish');
  await expect(page.getByRole('option').filter({ hasText: 'View stash@{0}' })).toContainText('WIP on graph polish');

  await search.fill('app component history');
  await expect(page.getByRole('option').filter({ hasText: 'File History: apps/desktop/src/app/app.component.ts' })).toBeVisible();
  await search.fill('app component blame');
  await expect(page.getByRole('option').filter({ hasText: 'Blame: apps/desktop/src/app/app.component.ts' })).toBeVisible();
  await search.fill('interface notes changes');
  await page.getByRole('option').filter({ hasText: 'View Changes: docs/interface-notes.md' }).click();
  await expect(page.getByLabel('Diff viewer')).toBeVisible();
  await expect(page.getByLabel('Diff viewer')).toContainText('docs/interface-notes.md');

  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+P');
  await page.getByRole('combobox', { name: 'Search commands' }).fill('repository maintenance');
  await page.getByRole('option', { name: /Perform Repository Maintenance/ }).click();
  await expect(page.getByRole('button', { name: /Repository maintenance complete/ })).toBeVisible();
});

test('finds history and blame for any tracked file from the keyboard', async ({ page }) => {
  await page.keyboard.press('Control+Shift+H');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  const search = page.getByRole('combobox', { name: 'Search tracked files' });
  await expect(search).toBeFocused();
  await expect(palette.getByText('Files', { exact: true })).toBeVisible();
  await expect(palette.getByRole('region', { name: 'Command search status' })).toBeVisible();
  await expect(palette.locator('.palette-result-count')).toHaveText('0 results');
  await expect(page.locator('.palette-empty')).toContainText('Type at least two characters');

  await search.fill('app.component');
  const history = page.getByRole('option').filter({
    hasText: 'File History: apps/desktop/src/app/app.component.ts',
  });
  const blame = page.getByRole('option').filter({
    hasText: 'Blame: apps/desktop/src/app/app.component.ts',
  });
  await expect(history).toBeVisible();
  await expect(blame).toBeVisible();
  await expect(palette.locator('.palette-result-count')).toHaveText(/^[1-9]\d* results$/);
  await history.click();

  const viewer = page.getByLabel('Diff viewer');
  await expect(viewer).toBeVisible();
  await expect(viewer).toContainText('apps/desktop/src/app/app.component.ts');
  const historyPanel = page.getByRole('region', { name: 'File history', exact: true });
  await expect(historyPanel).toBeVisible();
  await expect(historyPanel.getByRole('alert')).toContainText('requires the native desktop app');
});

test('jumps from sidebar references to branch tips without checking them out', async ({ page }) => {
  const featureBranch = page.getByRole('button', { name: 'Local branch feature/partial-staging' });
  await featureBranch.click();
  await expect(featureBranch).toHaveClass(/tip-selected/);
  await expect(page.locator('.commit-row.selected')).toContainText('Refine graph lane rendering');
  await expect(page.locator('.commit-panel')).toContainText('Refine graph lane rendering');
  await expect(page.getByRole('button', { name: /Switch branch, current main/ })).toBeVisible();

  const remoteBranch = page.locator('#reference-section-local').getByLabel('Remote branch origin/main', { exact: true });
  await remoteBranch.click();
  await expect(remoteBranch).toHaveClass(/tip-selected/);
  await expect(page.locator('.commit-row.selected')).toContainText('Merge feature/partial-staging');
  await expect(page.getByRole('button', { name: /Switch branch, current main/ })).toBeVisible();
});

test('makes branch synchronization state explicit and actionable in the status bar', async ({ page }) => {
  const statusbar = page.locator('.statusbar');
  const statusActions = statusbar.locator('button');
  const repository = statusbar.locator('.status-repository');
  await expect(repository).toHaveText('git-khronos');
  await expect(repository).toHaveAttribute('title', '/home/maya/projects/git-khronos');
  await expect(repository).toHaveAttribute('aria-label', 'Repository git-khronos, /home/maya/projects/git-khronos');
  expect(await statusActions.count()).toBeGreaterThan(0);
  expect(await statusActions.evaluateAll((controls) => controls.every((control) => {
    const box = control.getBoundingClientRect();
    return box.width >= 24 && box.height >= 24;
  }))).toBe(true);
  await expect(statusbar.getByRole('button', { name: 'View current branch main tip' })).toBeVisible();
  await expect(statusbar.getByRole('button', { name: '1 commit ahead of origin/main, push now' })).toHaveText('Ahead 1');
  await expect(statusbar.locator('.status-sync.incoming')).toHaveCount(0);
  await expect(statusbar).not.toContainText('↓ 0');

  await statusbar.getByRole('button', { name: 'View current branch main tip' }).click();
  await expect(page.locator('.commit-row.selected')).toContainText('Polish repository activity drawer');
  await expect(page.getByRole('button', { name: /Switch branch, current main/ })).toBeVisible();
});

test('distinguishes detached HEAD from a repository without commits in the status bar', async ({ page }) => {
  const head = await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    const repository = git.repository();
    git.repositories.update((items: any[]) => items.map((item) => item.id === repository.id ? {
      ...item,
      status: { ...item.status, branch: null },
      branches: item.branches.map((branch: any) => ({ ...branch, current: false })),
    } : item));
    return repository.headOid as string;
  });

  const detached = page.locator('.statusbar').getByRole('button', {
    name: `View detached HEAD commit ${head.slice(0, 7)}`,
  });
  await expect(detached).toContainText(`Detached HEAD ${head.slice(0, 7)}`);
  await detached.click();
  await expect(page.locator('.commit-row.selected')).toHaveAttribute('data-commit-oid', head);

  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    const repository = git.repository();
    git.repositories.update((items: any[]) => items.map((item) => item.id === repository.id ? {
      ...item,
      headOid: null,
      commits: [],
      branches: [],
    } : item));
  });

  const emptyState = page.locator('.statusbar .status-branch.unborn');
  await expect(emptyState).toHaveText('No commits yet');
  await expect(emptyState).toHaveAttribute('title', 'This repository does not have any commits yet');
  await expect(page.locator('.statusbar').getByRole('button', { name: /detached HEAD/i })).toHaveCount(0);
});

test('returns to HEAD after navigating deep into history', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 320 });
  const commits = page.locator('.commit-list');
  await commits.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event('scroll'));
  });
  const backToHead = page.getByRole('button', { name: 'Back to HEAD' });
  await expect(backToHead).toBeVisible();

  await backToHead.click();
  await expect.poll(() => commits.evaluate((element) => Math.round(element.scrollTop))).toBe(0);
  await expect(page.locator('.commit-row.selected')).toContainText('Polish repository activity drawer');
  await expect(backToHead).toBeHidden();
});

test('searches commits without replacing the graph', async ({ page }) => {
  const search = page.getByLabel('Search loaded commits by message, SHA, or author');
  await search.fill('lane rendering');

  await expect(page.locator('.search-result-count')).toHaveText('1 / 1');
  await expect(page.locator('.commit-row.search-match')).toContainText('Refine graph lane rendering');
  await expect(page.locator('.commit-row.search-dimmed')).not.toHaveCount(0);
  await expect(page.locator('.commit-row.search-match .subject mark')).toHaveText('lane rendering');
  await expect(page.locator('.commit-row.search-match .subject mark')).toHaveCSS('color', 'rgb(33, 22, 12)');

  await search.fill('first-parent');
  await expect(page.locator('.commit-row.search-match .commit-description mark')).toHaveText('first-parent');

  await search.press('Escape');
  await expect(search).toHaveValue('');
});

test('navigates HEAD, working changes, selection, and search with scroll markers', async ({ page }) => {
  const markers = page.getByRole('navigation', { name: 'Commit graph scroll markers' });
  await expect(markers.getByRole('button', { name: 'HEAD · current branch tip' })).toBeVisible();
  await expect(markers.getByRole('button', { name: /Working changes/ })).toHaveCount(2);
  await expect(markers.getByRole('button', { name: 'Working changes · main' })).toBeVisible();
  const markerTargets = await markers.getByRole('button').evaluateAll((buttons) => buttons.map((button) => {
    const bounds = button.getBoundingClientRect();
    const marker = getComputedStyle(button, '::before');
    return {
      targetWidth: bounds.width,
      targetHeight: bounds.height,
      visualWidth: Number.parseFloat(marker.width),
    };
  }));
  expect(markerTargets.length).toBeGreaterThan(0);
  // Thin marker visuals remain compact inside full WCAG-sized pointer targets.
  expect(markerTargets.every(({ targetWidth, targetHeight }) => targetWidth >= 24 && targetHeight >= 24)).toBe(true);
  expect(markerTargets.every(({ visualWidth }) => visualWidth <= 11)).toBe(true);

  const search = page.getByLabel('Search loaded commits by message, SHA, or author');
  await search.fill('lane rendering');
  const searchMarker = markers.getByRole('button', { name: 'Search · Refine graph lane rendering' });
  await expect(searchMarker).toBeVisible();
  await searchMarker.click();
  await expect(page.locator('.commit-row.selected')).toContainText('Refine graph lane rendering');
  await expect(markers.getByRole('button', { name: 'Selected · Refine graph lane rendering' })).toBeVisible();

  await page.getByRole('button', { name: 'Configure graph columns' }).click();
  await page.getByRole('checkbox', { name: 'Scroll Markers' }).uncheck();
  await expect(markers).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Commit graph scroll markers' })).toHaveCount(0);
});

test('exposes commit actions without requiring a right click', async ({ page }) => {
  const row = page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"]');
  const actions = row.getByRole('button', { name: 'Commit actions for Polish repository activity drawer' });

  await row.hover();
  await expect(row).toHaveClass(/branch-highlighted/);
  expect(await page.locator('.commit-row.branch-highlighted').count()).toBeGreaterThan(1);
  await expect(actions).toHaveCSS('opacity', '1');
  await expect(actions.locator('gc-icon svg')).toBeVisible();
  await expect(actions).toHaveAttribute('aria-haspopup', 'menu');
  await expect(actions).toHaveAttribute('aria-expanded', 'false');
  await actions.click();

  const menu = page.getByRole('menu').filter({ hasText: 'Polish repository activity drawer' });
  await expect(menu).toBeVisible();
  const commitIdentifier = menu.locator('.context-heading code');
  await expect(commitIdentifier).toHaveText('f19b263a');
  await expect(commitIdentifier).toHaveCSS('font-family', /mono/i);
  await expect(menu.locator('.context-divider')).toHaveCount(3);
  await expect(menu.getByRole('menuitem', { name: 'Checkout this commit' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Copy commit SHA' })).toBeFocused();
  await expect(actions).toHaveAttribute('aria-expanded', 'true');
  await expect(actions).toHaveClass(/menu-open/);
  await expect(actions).toHaveCSS('opacity', '1');
  await expect(row).toHaveClass(/selected/);
  const [menuBox, inspectorBox] = await Promise.all([
    menu.boundingBox(),
    page.locator('.detail-panel:not(.panel-hidden)').boundingBox(),
  ]);
  expect(menuBox).not.toBeNull();
  expect(inspectorBox).not.toBeNull();
  expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(inspectorBox!.x + 1);
  await expect(page.locator('.commit-row.branch-highlighted')).toHaveCount(0);
  await expect(page.locator('.commit-row.branch-dimmed')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(actions).toHaveAttribute('aria-expanded', 'false');
  await expect(actions).not.toHaveClass(/menu-open/);
  await expect(actions).toBeFocused();
  await expect(row).toHaveClass(/branch-highlighted/);
  expect(await page.locator('.commit-row.branch-highlighted').count()).toBeGreaterThan(1);
});

test('compares a graph commit with the current working directory', async ({ page }) => {
  const row = page.locator('[data-commit-oid="160acd10ef9e0c202cd3985aa41ee45d971bbb11"]');
  await row.click({ button: 'right' });
  const menu = page.getByRole('menu').filter({ hasText: 'Add hunk-level staging actions' });
  await menu.getByRole('menuitem', { name: 'Compare with working directory' }).click();

  const panel = page.locator('.commit-panel');
  await expect(panel.getByText('Commit compared with WIP')).toBeVisible();
  await expect(panel.getByLabel('Selected commit range')).toContainText('Viewing working directory changes since this commit');
  await expect(panel.locator('.comparison-commit-card')).toHaveCount(2);
  await expect(panel.locator('.comparison-commit-card').first()).toContainText('Add hunk-level staging actions');
  await expect(panel.locator('.working-tree-target')).toContainText('Working directory');
  await expect(panel.getByText('Changed Files (4)')).toBeVisible();
  await expect(page.locator('.commit-row.selected')).toHaveCount(2);

  const comparisonFile = panel.locator('.comparison-files .commit-file').filter({ hasText: 'app.component.html' });
  await expect(comparisonFile).toHaveAttribute('aria-label', 'Open diff for apps/desktop/src/app/app.component.html');
  await expect(comparisonFile.locator('.commit-file-open')).toBeVisible();
  const [comparisonFileNameBox, comparisonDirectoryBox] = await Promise.all([
    comparisonFile.locator('.current-path strong').boundingBox(),
    comparisonFile.locator('.current-path small').boundingBox(),
  ]);
  expect(comparisonFileNameBox).not.toBeNull();
  expect(comparisonDirectoryBox).not.toBeNull();
  expect(comparisonFileNameBox!.y).toBeLessThan(comparisonDirectoryBox!.y);
  await comparisonFile.click();
  const diffViewer = page.getByRole('region', { name: 'Diff viewer' });
  await expect(diffViewer).toBeVisible();
  await expect(diffViewer).toContainText('160acd10 → WIP');
});

test('selects WIP and a commit for comparison with Ctrl-click', async ({ page }) => {
  const wip = page.locator('.wip-row').first();
  const wipNode = wip.locator('.wip-node');
  const commit = page.locator('[data-commit-oid="7c17b9d37d6a36dc9477e611109136f86477041a"]');

  await expect(wip).toHaveClass(/selected/);
  await commit.click({ modifiers: ['Control'] });
  await expect(page.locator('.commit-panel').getByText('Commit compared with WIP')).toBeVisible();
  await expect(wip).toHaveClass(/range-selected/);
  await expect(commit).toHaveClass(/range-selected/);
  await expect(page.locator('.commit-row.range-selected')).toHaveCount(2);

  await wipNode.click();
  await expect(wip).toHaveClass(/selected/);
  await expect(page.locator('.commit-row.range-selected')).toHaveCount(0);

  await commit.click();
  await wipNode.click({ modifiers: ['Control'] });
  await expect(page.locator('.commit-panel').getByText('Commit compared with WIP')).toBeVisible();
  await expect(page.locator('.commit-row.range-selected')).toHaveCount(2);
});

test('presents a selected revision range from its older base to newer target', async ({ page }) => {
  const newer = page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"]');
  const older = page.locator('[data-commit-oid="83e6d15fb82672899688b93f59251dfc669888a3"]');

  await newer.click();
  await older.click({ modifiers: ['Control'] });

  const cards = page.getByLabel('Selected commit range').locator('.comparison-commit-card');
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText('Merge feature/partial-staging');
  await expect(cards.first().locator('> b')).toHaveText('FROM');
  await expect(cards.last()).toContainText('Polish repository activity drawer');
  await expect(cards.last().locator('> b')).toHaveText('TO');

  const connector = await cards.last().evaluate((card) => {
    const line = getComputedStyle(card, '::before');
    return {
      lineContent: line.content,
      lineHeight: Number.parseFloat(line.height),
      lineWidth: Number.parseFloat(line.width),
      shape: line.clipPath,
    };
  });
  expect(connector.lineContent).not.toBe('none');
  expect(connector.lineHeight).toBeGreaterThanOrEqual(7);
  expect(connector.lineWidth).toBeGreaterThanOrEqual(6);
  expect(connector.shape).toContain('polygon');
});

test('keeps the current branch lane aligned and continuous through WIP rows', async ({ page }) => {
  const wipNode = page.locator('.wip-row').first().locator('.wip-node');
  const headNode = page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"] .author-node');
  const laneOffset = await wipNode.getAttribute('data-lane-offset');
  expect(laneOffset).not.toBeNull();
  const currentLanePaths = page.locator(`.wip-edges path[data-lane-offset="${laneOffset}"]`);

  await expect(currentLanePaths).toHaveCount(2);
  const [wipBox, headBox, firstPathBox, secondPathBox] = await Promise.all([
    wipNode.boundingBox(),
    headNode.boundingBox(),
    currentLanePaths.nth(0).boundingBox(),
    currentLanePaths.nth(1).boundingBox(),
  ]);

  expect(wipBox).not.toBeNull();
  expect(headBox).not.toBeNull();
  expect(firstPathBox).not.toBeNull();
  expect(secondPathBox).not.toBeNull();
  expect(Math.abs((wipBox!.x + wipBox!.width / 2) - (headBox!.x + headBox!.width / 2))).toBeLessThan(0.6);
  expect(Math.abs((firstPathBox!.x + firstPathBox!.width / 2) - (wipBox!.x + wipBox!.width / 2))).toBeLessThan(0.6);
  expect(firstPathBox!.y + firstPathBox!.height).toBeGreaterThanOrEqual(secondPathBox!.y);
});

test('highlights a hovered commit ancestry without losing graph topology', async ({ page }) => {
  const hovered = page.locator('[data-commit-oid="160acd10ef9e0c202cd3985aa41ee45d971bbb11"]');
  const parent = page.locator('[data-commit-oid="ca5fa80bf46c95b6c8d4296d47f3fd9e1e77d5c2"]');
  const unrelated = page.locator('[data-commit-oid="7c17b9d37d6a36dc9477e611109136f86477041a"]');

  await hovered.hover();
  await expect(hovered).toHaveClass(/branch-highlighted/);
  await expect(parent).toHaveClass(/branch-highlighted/);
  await expect(unrelated).toHaveClass(/branch-dimmed/);
  await expect(hovered.locator('.graph-edges path')).not.toHaveCount(0);
  await expect(unrelated).toHaveCSS('opacity', '1');
  await expect(unrelated.locator('.subject')).toHaveCSS('opacity', '0.72');
  await expect(unrelated.locator('.commit-description')).toHaveCSS('opacity', '0.86');
  await expect(unrelated.locator('.graph-cell')).toHaveCSS('opacity', '0.38');

  await page.mouse.move(0, 0);
  const graphBranch = unrelated.getByRole('button', { name: 'Graph reference feature/partial-staging, local branch' });
  await graphBranch.focus();
  await expect(graphBranch).toBeFocused();
  await expect(unrelated).toHaveClass(/branch-highlighted/);
  await expect(parent).toHaveClass(/branch-highlighted/);
  await expect(hovered).toHaveClass(/branch-dimmed/);
});

test('keeps the selected commit distinct while previewing branch ancestry', async ({ page }) => {
  const selected = page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"]');
  const parent = page.locator('[data-commit-oid="83e6d15fb82672899688b93f59251dfc669888a3"]');
  const otherBranch = page.locator('[data-commit-oid="7c17b9d37d6a36dc9477e611109136f86477041a"]');

  await selected.click();
  await selected.hover();
  await expect(selected).toHaveClass(/selected/);
  await expect(selected).toHaveClass(/branch-highlighted/);
  const [selectedBackground, parentBackground] = await Promise.all([
    selected.evaluate((element) => getComputedStyle(element).backgroundColor),
    parent.evaluate((element) => getComputedStyle(element).backgroundColor),
  ]);
  expect(selectedBackground).not.toBe(parentBackground);
  await expect(selected).toHaveCSS('box-shadow', /rgb\(165, 154, 255\)/);

  await otherBranch.hover();
  await expect(selected).toHaveClass(/branch-dimmed/);
  await expect(selected).toHaveCSS('opacity', '1');
  await expect(selected).toHaveCSS('filter', 'none');
});

test('avoids transient graph flashes while crossing sidebar branches', async ({ page }) => {
  const branch = page.getByRole('button', { name: /Local branch feature\/partial-staging/ });
  const tip = page.locator('[data-commit-oid="7c17b9d37d6a36dc9477e611109136f86477041a"]');

  await branch.dispatchEvent('mouseenter');
  await expect(tip).not.toHaveClass(/branch-highlighted/);
  await branch.dispatchEvent('mouseleave');
  await page.waitForTimeout(180);
  await expect(tip).not.toHaveClass(/branch-highlighted/);

  await branch.dispatchEvent('mouseenter');
  await expect(tip).toHaveClass(/branch-highlighted/);
  await branch.dispatchEvent('mouseleave');
  await expect(tip).not.toHaveClass(/branch-highlighted/);
});

test('reveals the nearest containing branch for an unlabeled commit', async ({ page }) => {
  await page.goto('/?ghost-branch');
  const hint = page.getByRole('button', { name: /Nearest containing branch/ });

  await expect(hint).toBeVisible();
  await expect(hint).toContainText('feature/partial-staging');
  await expect(hint).toHaveAttribute(
    'title',
    'Nearest containing branch: feature/partial-staging. Double-click or press Enter to checkout.',
  );
  await expect(hint.locator('.ghost-pill')).toHaveCSS('border-top-style', 'dashed');

  await page.locator('[data-commit-oid="7c17b9d37d6a36dc9477e611109136f86477041a"]').click();
  await expect(hint).toBeHidden();
});

test('keeps browser-only repository limitations explicit', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('git-khronos.recent-repositories.v1', JSON.stringify([
      '/home/maya/projects/atlas-ui',
      '/home/maya/projects/chronos-api',
      '/home/maya/sandboxes/release-candidate',
      '/mnt/work/client-portal',
    ]));
    localStorage.setItem('git-khronos.favorite-repositories.v1', JSON.stringify([
      '/home/maya/projects/atlas-ui',
      '/home/maya/projects/chronos-api',
    ]));
  });
  await page.reload();
  const newTab = page.locator('.new-tab');
  await newTab.click();

  const dialog = page.getByRole('dialog', { name: 'Repository management' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Sample-data preview')).toBeVisible();
  await expect(dialog.getByText('task dev')).toBeVisible();
  const openRepository = dialog.getByRole('button', { name: /Open a repository/ });
  await expect(openRepository).toBeDisabled();
  await expect(openRepository.locator('strong')).toHaveCSS('font-size', '13px');
  await expect(openRepository.locator('small')).toHaveCSS('font-size', '12px');
  await expect(dialog.locator('.repository-action-disclosure')).toHaveCount(2);

  const browseTab = dialog.getByRole('tab', { name: 'Browse' });
  const cloneTab = dialog.getByRole('tab', { name: 'Clone' });
  const initTab = dialog.getByRole('tab', { name: 'Initialize' });
  await expect(dialog.locator('.manager-favorites .manager-repository-row')).toHaveCount(2);
  await expect(dialog.locator('.manager-recents .manager-repository-row')).toHaveCount(2);
  await expect(dialog.locator('.manager-recents')).not.toContainText('atlas-ui');
  await expect(dialog.locator('.manager-recents')).not.toContainText('chronos-api');
  await expect(dialog.locator('.manager-repository-main').first()).toHaveCSS('border-top-width', '0px');
  await expect(dialog.locator('.manager-favorite-toggle').first()).toHaveCSS('border-top-width', '0px');
  await expect(browseTab).toHaveAttribute('aria-selected', 'true');
  await expect(browseTab).toBeFocused();
  await expect(browseTab).toHaveCSS('font-size', '13px');
  await expect(browseTab).toHaveCSS('border-left-width', '0px');

  await dialog.getByRole('button', { name: /^Clone a repository/ }).click();
  await expect(dialog.getByLabel('Repository URL')).toBeFocused();
  await expect(cloneTab).toHaveAttribute('aria-selected', 'true');
  await expect(cloneTab).toHaveClass(/active/);
  await expect(cloneTab).toHaveCSS('border-bottom-color', 'rgb(84, 214, 173)');
  await expect(browseTab).not.toHaveClass(/active/);
  await expect(browseTab).toHaveCSS('border-bottom-color', 'rgba(0, 0, 0, 0)');
  await browseTab.click();
  await dialog.getByRole('button', { name: /^Initialize a repository/ }).click();
  await expect(dialog.locator('.repository-form .path-picker button')).toBeFocused();
  await expect(initTab).toHaveAttribute('aria-selected', 'true');
  await expect(browseTab).toHaveAttribute('aria-selected', 'false');
  await expect(dialog.locator('.repository-dialog-tabs button.active')).toHaveText('Initialize');
  await browseTab.click();
  await expect(browseTab).toBeFocused();

  await browseTab.press('ArrowRight');
  await expect(cloneTab).toBeFocused();
  await expect(cloneTab).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByRole('heading', { name: 'Clone a Repository' })).toBeVisible();
  await expect(dialog.locator('.repository-destination')).toHaveCount(0);
  await expect(dialog.getByRole('group', { name: 'Clone options' })).toBeVisible();
  await expect(dialog.locator('.form-readiness')).toHaveText('Enter a repository URL to continue');
  await expect(dialog.getByLabel('Repository URL')).toHaveCSS('font-size', '13px');
  await expect(dialog.getByRole('button', { name: 'Clone repository' })).toHaveCSS('font-size', '13px');
  await cloneTab.press('End');
  await expect(initTab).toBeFocused();
  await expect(initTab).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByRole('heading', { name: 'Initialize a Repository' })).toBeVisible();
  await expect(dialog.locator('.repository-destination')).toHaveCount(0);
  await expect(dialog.locator('.form-readiness')).toHaveText('Choose where to create the repository');
  await initTab.press('ArrowRight');
  await expect(browseTab).toBeFocused();
  await expect(browseTab).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(newTab).toBeFocused();
});

test('expands summarized untracked directories instead of opening an invalid file diff', async ({ page }) => {
  await page.goto('/?untracked-directory-preview');
  const directory = page.getByTitle('Show files in generated/');
  await expect(directory).toContainText('generated');
  await directory.click();

  await expect(page.getByTitle('View changes in generated/example.txt')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('keeps repository management navigation visible while long lists scroll', async ({ page }) => {
  await page.setViewportSize({ width: 550, height: 560 });
  await page.evaluate(() => localStorage.setItem(
    'git-khronos.favorite-repositories.v1',
    JSON.stringify(Array.from({ length: 24 }, (_, index) => `/home/maya/projects/favorite-${index + 1}`)),
  ));
  await page.reload();
  await expect(page.locator('.app-shell')).toBeVisible();
  await page.locator('.new-tab').click();

  const dialog = page.getByRole('dialog', { name: 'Repository management' });
  const header = dialog.locator('.repository-dialog-header');
  const tabs = dialog.getByRole('tablist', { name: 'Repository actions' });
  const repositoryList = dialog.locator('.repository-manager-body');
  const [headerBefore, tabsBefore] = await Promise.all([header.boundingBox(), tabs.boundingBox()]);
  expect(headerBefore).not.toBeNull();
  expect(tabsBefore).not.toBeNull();
  expect(await repositoryList.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);

  await repositoryList.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect.poll(() => repositoryList.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const [headerAfter, tabsAfter] = await Promise.all([header.boundingBox(), tabs.boundingBox()]);
  expect(headerAfter).not.toBeNull();
  expect(tabsAfter).not.toBeNull();
  expect(Math.abs(headerAfter!.y - headerBefore!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(tabsAfter!.y - tabsBefore!.y)).toBeLessThanOrEqual(1);
  const close = dialog.getByRole('button', { name: 'Close repository management' });
  await expect(close).toBeVisible();
  await expect(close).toHaveCSS('border-top-style', 'solid');
  expect(await close.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  expect(await close.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return Math.min(box.width, box.height);
  })).toBeGreaterThanOrEqual(30);
  await expect(dialog.getByRole('tab', { name: 'Browse' })).toBeVisible();
});

test('keeps repository form actions visible while advanced options scroll', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 500 });
  await page.locator('.new-tab').click();

  const dialog = page.getByRole('dialog', { name: 'Repository management' });
  await dialog.getByRole('tab', { name: 'Clone' }).click();
  await dialog.getByRole('checkbox', { name: /Shallow clone/ }).check();

  const body = dialog.locator('.repository-form-body');
  const footer = dialog.locator('.repository-form footer');
  const [dialogBox, footerBefore] = await Promise.all([dialog.boundingBox(), footer.boundingBox()]);
  expect(dialogBox).not.toBeNull();
  expect(footerBefore).not.toBeNull();
  expect(await body.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  expect(footerBefore!.y + footerBefore!.height).toBeLessThanOrEqual(dialogBox!.y + dialogBox!.height + 1);
  await expect(dialog.getByRole('button', { name: 'Clone repository', exact: true })).toBeVisible();

  await body.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const footerAfter = await footer.boundingBox();
  expect(footerAfter).not.toBeNull();
  expect(Math.abs(footerAfter!.y - footerBefore!.y)).toBeLessThanOrEqual(1);
  await expect(dialog.getByRole('tab', { name: 'Clone' })).toBeVisible();
});

test('navigates activity scopes as a familiar tab strip', async ({ page }) => {
  const notificationButton = page.getByRole('button', { name: 'Activity notifications' });
  await notificationButton.click();
  const drawer = page.getByRole('region', { name: 'Activity logs' });
  const applicationTab = drawer.getByRole('tab', { name: 'Application' });
  const repositoryTab = drawer.getByRole('tab', { name: 'Repository' });

  await expect(drawer.locator('.activity-drawer-mark')).toBeVisible();
  await expect(drawer.locator('header strong')).toHaveCSS('font-size', '13px');
  await expect(drawer.locator('header small')).toHaveCSS('font-size', '12px');
  await expect(applicationTab).toHaveCSS('font-size', '13px');
  await expect(applicationTab).toHaveCSS('border-left-width', '0px');
  await expect(drawer.locator('.activity-empty strong')).toHaveCSS('font-size', '13px');
  await expect(drawer.locator('.activity-empty small')).toHaveCSS('font-size', '12px');
  const close = drawer.getByRole('button', { name: 'Close Activity Logs' });
  await expect(close).toHaveCSS('border-top-style', 'solid');
  expect(await close.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  expect(await close.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return Math.min(box.width, box.height);
  })).toBeGreaterThanOrEqual(29);
  await expect(applicationTab).toHaveAttribute('aria-selected', 'true');
  await expect(applicationTab).toBeFocused();
  await applicationTab.press('ArrowRight');
  await expect(repositoryTab).toBeFocused();
  await expect(repositoryTab).toHaveAttribute('aria-selected', 'true');
  await expect(drawer.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'activity-tab-repository');
  await repositoryTab.press('ArrowLeft');
  await expect(applicationTab).toBeFocused();
  await expect(applicationTab).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(notificationButton).toBeFocused();
});

test('shows activity outcomes as text with readable theme-paired surfaces', async ({ page }) => {
  const themeSurfaces: string[] = [];
  for (const theme of ['chronos', 'midnight']) {
    await page.evaluate((value) => localStorage.setItem('git-khronos.ui.theme', value), theme);
    await page.reload();
    await expect(page.locator('.commit-row').first()).toBeVisible();
    await page.evaluate(() => {
      const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
      const timestamp = new Date('2026-10-13T12:34:56.789Z').toISOString();
      git.activityLogs.set([
        { id: 1, timestamp, description: 'Fetching updates', durationMs: null, status: 'running', repositoryId: null, detail: null, operationId: 'op-1', cancelable: true },
        { id: 2, timestamp, description: 'Fetched updates', durationMs: 42, status: 'success', repositoryId: null, detail: null, operationId: 'op-2', cancelable: false },
        { id: 3, timestamp, description: 'Push rejected', durationMs: 80, status: 'error', repositoryId: null, detail: 'Authentication failed', operationId: 'op-3', cancelable: false },
        { id: 4, timestamp, description: 'Fetch stopped', durationMs: 12, status: 'cancelled', repositoryId: null, detail: null, operationId: 'op-4', cancelable: false },
      ]);
    });

    await page.getByRole('button', { name: 'Activity notifications' }).click();
    const drawer = page.getByRole('region', { name: 'Activity logs' });
    await expect(drawer.getByText('Running', { exact: true })).toBeVisible();
    await expect(drawer.getByText('Success', { exact: true })).toBeVisible();
    await expect(drawer.getByText('Failed', { exact: true })).toBeVisible();
    await expect(drawer.getByText('Cancelled', { exact: true })).toBeVisible();
    await expect(drawer.getByText('42 ms', { exact: true })).toBeVisible();
    await expect(drawer.locator('.activity-line > i')).toHaveCount(4);
    await expect(drawer.locator('.activity-line > i').first()).toHaveAttribute('aria-hidden', 'true');

    const surface = await drawer.evaluate((element) => getComputedStyle(element).backgroundColor);
    themeSurfaces.push(surface);
    for (const { foreground, background } of [
      { foreground: 'header small', background: 'header' },
      { foreground: '[role="tab"]:not(.active)', background: 'nav' },
      { foreground: '.activity-line time', background: '.activity-drawer' },
      { foreground: '.activity-line.running code b', background: '.activity-drawer' },
      { foreground: '.activity-line.success code b', background: '.activity-drawer' },
      { foreground: '.activity-line.error code b', background: '.activity-drawer' },
      { foreground: '.activity-line.cancelled code b', background: '.activity-drawer' },
      { foreground: '.activity-line.error > span > small', background: '.activity-drawer' },
    ]) {
      const colors = await drawer.locator(foreground).first().evaluate((element, backgroundSelector) => ({
        foreground: getComputedStyle(element).color,
        background: getComputedStyle(element.closest(backgroundSelector)!).backgroundColor,
      }), background);
      expect(await cssContrastRatio(page, colors.foreground, colors.background),
        `${foreground} should meet WCAG AA contrast in ${theme}`).toBeGreaterThanOrEqual(4.5);
    }
    await drawer.getByRole('button', { name: 'Close Activity Logs' }).click();
  }
  expect(themeSurfaces[0]).not.toBe(themeSurfaces[1]);
});

test('resizes activity logs with pointer, buttons, and keyboard while preserving a safe viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.getByRole('button', { name: 'Activity notifications' }).click();
  const drawer = page.getByRole('region', { name: 'Activity logs' });
  const resizer = drawer.getByRole('separator', { name: 'Resize activity logs' });
  const shorter = drawer.getByRole('button', { name: 'Make Activity Logs shorter' });
  const taller = drawer.getByRole('button', { name: 'Make Activity Logs taller' });

  await expect(drawer).toHaveCSS('height', '285px');
  await taller.click();
  await expect(drawer).toHaveCSS('height', '325px');
  await shorter.click();
  await expect(drawer).toHaveCSS('height', '285px');

  await resizer.focus();
  await resizer.press('ArrowUp');
  await expect(drawer).toHaveCSS('height', '309px');
  await expect(resizer).toHaveAttribute('aria-valuenow', '309');

  const handle = await resizer.boundingBox();
  expect(handle).not.toBeNull();
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y - 46);
  await page.mouse.up();
  await expect(drawer).toHaveCSS('height', '361px');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('git-khronos.ui.activity-log-height'))).toBe('361');

  await drawer.getByRole('button', { name: 'Close Activity Logs' }).click();
  await page.reload();
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.getByRole('button', { name: 'Activity notifications' }).click();
  await expect(page.getByRole('region', { name: 'Activity logs' })).toHaveCSS('height', '361px');

  await page.setViewportSize({ width: 600, height: 300 });
  await expect(page.getByRole('region', { name: 'Activity logs' })).toHaveCSS('height', '190px');
  await expect(page.getByRole('separator', { name: 'Resize activity logs' })).toHaveAttribute('aria-valuemax', '190');
  await page.setViewportSize({ width: 1200, height: 800 });
  await expect(page.getByRole('region', { name: 'Activity logs' })).toHaveCSS('height', '361px');
  await expect(page.getByRole('separator', { name: 'Resize activity logs' })).toHaveAttribute('aria-valuemax', '690');
});

test('opens commit details, tree files, and the focused diff through normal clicks', async ({ page }) => {
  await page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"]').click();

  const commitPanel = page.locator('.commit-panel');
  await expect(commitPanel).toContainText('Polish repository activity drawer');
  const inspectorTitle = commitPanel.locator('.commit-inspector-copy b');
  await expect(inspectorTitle).toHaveText('Commit details');
  await expect(commitPanel.locator('.commit-overview h2')).toHaveText('Polish repository activity drawer');
  await expect(commitPanel.locator('.commit-detail-refs .current-ref')).toBeVisible();
  await expect(commitPanel.locator('.commit-detail-refs .current-ref')).toHaveClass(/lane-color-0/);
  const signature = commitPanel.getByLabel('Verified signature');
  await expect(signature).toBeVisible();
  await expect(signature).toContainText('Maya Chen <maya@example.test>');
  await expect(signature).toContainText('A1B2C3D4E5F60718');
  await expect(commitPanel.getByText('Changed Files (3)')).toBeVisible();
  const changedFilesList = commitPanel.locator('.commit-file-list');
  const changedFilesListMaxHeight = await changedFilesList.evaluate((element) => Number.parseFloat(getComputedStyle(element).maxHeight));
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  expect(changedFilesListMaxHeight).toBeCloseTo(Math.min(320, Math.max(190, viewportHeight * .35)), 0);
  await expect(commitPanel.locator('.file-change-summary')).toHaveAttribute('aria-label', '52 additions and 13 deletions');
  await expect(commitPanel.locator('.file-line-stats').first()).toHaveText('+16−5');
  const quickActions = commitPanel.getByRole('navigation', { name: 'Selected commit actions' });
  await expect(quickActions.getByRole('button', { name: 'Compare selected commit with working directory' })).toBeVisible();
  await expect(quickActions.getByRole('button', { name: 'Cherry-pick' })).toBeVisible();
  await expect(commitPanel.getByRole('button', { name: 'More commit actions' })).toBeVisible();
  await expect(commitPanel.getByRole('button', { name: 'Commit actions', exact: true })).toHaveCount(0);
  const cherryPick = quickActions.getByRole('button', { name: 'Cherry-pick' });
  await cherryPick.click();
  const historyConfirmation = page.getByRole('alertdialog');
  await expect(historyConfirmation).toContainText("Apply this commit's changes");
  await expect(historyConfirmation.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(historyConfirmation).toHaveCount(0);
  await expect(cherryPick).toBeFocused();
  await expect(page.getByRole('region', { name: 'Diff viewer' })).toHaveCount(0);
  const references = commitPanel.getByLabel('Commit references');
  await expect(references).toContainText('main');
  await expect(references).not.toContainText('origin/main');
  const firstChangedFile = commitPanel.locator('.commit-file-path').first();
  await expect(firstChangedFile.locator('.current-path small')).toHaveText('apps/desktop/src/app/');
  await expect(firstChangedFile.locator('.current-path strong')).toHaveText('app.component.html');
  const [changedFileNameBox, changedFileDirectoryBox] = await Promise.all([
    firstChangedFile.locator('.current-path strong').boundingBox(),
    firstChangedFile.locator('.current-path small').boundingBox(),
  ]);
  expect(changedFileNameBox).not.toBeNull();
  expect(changedFileDirectoryBox).not.toBeNull();
  expect(changedFileNameBox!.y).toBeLessThan(changedFileDirectoryBox!.y);
  const commitFileFilter = commitPanel.getByRole('searchbox', { name: 'Filter changed files' });
  await commitFileFilter.fill('interface-notes');
  await expect(commitPanel.locator('.file-filter-count')).toHaveText('1');
  await expect(commitPanel.locator('.commit-file')).toHaveCount(1);
  await expect(commitPanel.locator('.commit-file-path .current-path strong')).toHaveText('interface-notes.md');
  await commitPanel.getByRole('button', { name: 'Clear file filter' }).click();
  const graphAuthorColor = await page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"] .author-node').evaluate((node) => getComputedStyle(node).getPropertyValue('--author-color').trim());
  const inspectorAuthorColor = await commitPanel.locator('.author-card .large-avatar').first().evaluate((node) => getComputedStyle(node).getPropertyValue('--author-color').trim());
  expect(graphAuthorColor).not.toBe('');
  expect(inspectorAuthorColor).toBe(graphAuthorColor);

  const currentBranchReference = references.locator('.ref-pill.head');
  await expect(currentBranchReference.locator('.ref-sync')).toHaveText('↑1');
  await currentBranchReference.click({ button: 'right' });
  const branchMenu = page.getByRole('menu').filter({ hasText: 'main' });
  await expect(branchMenu.getByRole('menuitem', { name: 'Current branch' })).toBeVisible();
  await expect(branchMenu.getByRole('menuitem', { name: 'Current branch' })).toBeDisabled();
  await expect(branchMenu.getByRole('menuitem', { name: 'Copy branch name' })).toBeFocused();
  await expect(branchMenu.getByRole('menuitem', { name: 'Checkout branch' })).toHaveCount(0);
  await expect(branchMenu.getByRole('menuitem', { name: /^Fast-forward main to main$/ })).toHaveCount(0);
  await expect(branchMenu.getByRole('menuitem', { name: /^Merge main into main$/ })).toHaveCount(0);
  await expect(branchMenu.getByRole('menuitem', { name: /^Squash main into main$/ })).toHaveCount(0);
  await expect(branchMenu.getByRole('menuitem', { name: /^Rebase main onto main/ })).toHaveCount(0);
  await expect(branchMenu.getByRole('menuitem', { name: 'Edit entire history, including root…' })).toBeVisible();
  await page.keyboard.press('Escape');

  const moreCommitActions = commitPanel.getByRole('button', { name: 'More commit actions' });
  await expect(moreCommitActions).toHaveAttribute('aria-expanded', 'false');
  await moreCommitActions.click();
  const commitMenu = page.getByRole('menu').filter({ hasText: 'Polish repository activity drawer' });
  await expect(commitMenu.getByRole('menuitem', { name: 'Checkout this commit' })).toBeFocused();
  await expect(moreCommitActions).toHaveAttribute('aria-expanded', 'true');
  await expect(moreCommitActions).toHaveClass(/menu-open/);
  await page.keyboard.press('Escape');
  await expect(moreCommitActions).toHaveAttribute('aria-expanded', 'false');
  await expect(moreCommitActions).toBeFocused();

  const layout = commitPanel.getByRole('group', { name: 'Changed files layout' });
  await layout.getByRole('button', { name: 'Tree' }).click();
  await expect(commitPanel.locator('.file-tree-directory').first()).toBeVisible();
  await commitPanel.locator('.tree-commit-file').first().click();

  const diffViewer = page.getByLabel('Diff viewer');
  await expect(diffViewer).toBeVisible();
  const visibleCommitContext = commitPanel.locator('.commit-overview');
  await expect.poll(() => commitPanel.evaluate((element) => element.scrollTop)).toBe(0);
  await expect(visibleCommitContext).toBeInViewport();
  await expect(visibleCommitContext.locator('.commit-body')).toHaveText('Make operation history easier to scan and diagnose.');
  await expect(commitPanel.locator('.commit-inspector-revision')).toHaveText('f19b263a');
  await expect(diffViewer.locator('.focus-diff-view')).toHaveCSS('font-size', '13px');
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(commitPanel).toBeVisible();
  const [diffToolbarBox, diffIdentityBox, diffModeBox] = await Promise.all([
    diffViewer.locator('.diff-workspace-toolbar').boundingBox(),
    diffViewer.locator('.diff-file-identity').boundingBox(),
    diffViewer.getByRole('group', { name: 'Diff layout' }).boundingBox(),
  ]);
  expect(diffToolbarBox).not.toBeNull();
  expect(diffIdentityBox).not.toBeNull();
  expect(diffModeBox).not.toBeNull();
  expect(diffToolbarBox!.height).toBeGreaterThanOrEqual(75);
  expect(diffModeBox!.y).toBeGreaterThanOrEqual(diffIdentityBox!.y + diffIdentityBox!.height - 1);
  await expect(diffViewer.getByRole('button', { name: 'Hunk' })).toBeVisible();
  await expect(diffViewer.getByRole('button', { name: 'Inline' })).toBeVisible();
  await expect(diffViewer.getByRole('button', { name: 'Split' })).toBeVisible();
  await expect(diffViewer.getByRole('button', { name: 'Hunk' })).toHaveAttribute('title', 'Grouped changes with working-tree hunk actions');
  await expect(diffViewer.getByRole('button', { name: 'Inline' })).toHaveAttribute('title', 'Compact unified file changes');
  await expect(diffViewer.getByRole('button', { name: 'Split' })).toHaveAttribute(
    'title',
    'Compare before and after; stacks vertically in narrow workspaces',
  );
  const minimapTarget = diffViewer.getByRole('button', { name: 'Jump to change 1' });
  const minimapTargetBounds = await minimapTarget.boundingBox();
  expect(minimapTargetBounds).not.toBeNull();
  expect(minimapTargetBounds!.width).toBeGreaterThanOrEqual(24);
  expect(minimapTargetBounds!.height).toBeGreaterThanOrEqual(24);
  await minimapTarget.focus();
  await expect(minimapTarget).toBeFocused();
  const fileView = diffViewer.getByRole('group', { name: 'File view' });
  const diffView = fileView.getByRole('button', { name: 'Diff', exact: true });
  const historyView = fileView.getByRole('button', { name: 'History', exact: true });
  const blameView = fileView.getByRole('button', { name: 'Blame', exact: true });
  await expect(diffView).toHaveAttribute('aria-pressed', 'true');
  await expect(historyView).toHaveAttribute('aria-pressed', 'false');
  await expect(blameView).toHaveAttribute('aria-pressed', 'false');
  await historyView.click();
  await expect(diffViewer.getByRole('region', { name: 'File history' })).toBeVisible();
  await expect(historyView).toHaveAttribute('aria-pressed', 'true');
  await historyView.click();
  await expect(diffViewer.getByRole('region', { name: 'File history' })).toBeVisible();
  await diffView.click();
  await expect(diffViewer.getByRole('region', { name: 'File history' })).toBeHidden();
  await expect(diffView).toHaveAttribute('aria-pressed', 'true');
  const backToGraph = diffViewer.getByRole('button', { name: 'Back to commit graph' });
  const closeDiff = diffViewer.getByRole('button', { name: 'Close diff' });
  await expect(backToGraph).toBeVisible();
  await expect(backToGraph).toContainText('Graph');
  await expect(closeDiff).toBeVisible();
  await expect(closeDiff).toHaveAttribute('title', 'Close diff (Esc)');
  await expect(diffViewer.locator('.diff-file-status')).toHaveText('M');
  await expect(diffViewer.locator('.diff-file-status')).toHaveAttribute('aria-label', 'Change status: Modified');
  await expect(diffViewer.locator('.diff-file-change-stats')).toHaveText('+16−5');
  await expect(diffViewer.locator('.diff-file-change-stats')).toHaveAttribute('aria-label', '16 additions and 5 deletions');
  expect(await diffViewer.locator('.diff-file-identity strong').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  const [diffViewportBox, narrowestDiffRowWidth] = await Promise.all([
    diffViewer.locator('.focus-diff-view').boundingBox(),
    diffViewer.locator('.focus-diff-line').evaluateAll((rows) =>
      Math.min(...rows.map((row) => row.getBoundingClientRect().width))),
  ]);
  expect(diffViewportBox).not.toBeNull();
  expect(Math.abs(narrowestDiffRowWidth - diffViewportBox!.width)).toBeLessThanOrEqual(1);
  const fileNavigation = diffViewer.getByRole('navigation', { name: 'Navigate changed files' });
  const previousFile = fileNavigation.getByRole('button', { name: 'Previous changed file' });
  const nextFile = fileNavigation.getByRole('button', { name: 'Next changed file' });
  await expect(fileNavigation).toContainText('1 of 3 files');
  await expect(previousFile).toBeDisabled();
  await expect(nextFile).toBeEnabled();
  const filePicker = fileNavigation.getByRole('button', { name: 'Choose changed file, 1 of 3' });
  await filePicker.click();
  const fileMenu = diffViewer.getByRole('menu', { name: 'Changed files' });
  await expect(fileMenu).toBeVisible();
  const [fileMenuBox, diffViewerBox, sidebarBox] = await Promise.all([
    fileMenu.boundingBox(),
    diffViewer.boundingBox(),
    page.locator('.sidebar').boundingBox(),
  ]);
  expect(fileMenuBox).not.toBeNull();
  expect(diffViewerBox).not.toBeNull();
  expect(sidebarBox).not.toBeNull();
  expect(fileMenuBox!.x).toBeGreaterThanOrEqual(diffViewerBox!.x);
  expect(fileMenuBox!.x).toBeGreaterThanOrEqual(sidebarBox!.x + sidebarBox!.width);
  const fileChoices = fileMenu.getByRole('menuitemradio');
  await expect(fileChoices).toHaveCount(3);
  await expect(fileChoices.first()).toHaveAttribute('aria-checked', 'true');
  await expect(fileChoices.first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(fileChoices.nth(1)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(fileMenu).toBeHidden();
  await expect(filePicker).toBeFocused();
  await filePicker.click();
  await fileChoices.nth(1).click();
  await expect(fileNavigation).toContainText('2 of 3 files');
  await expect(fileNavigation.getByRole('button', { name: 'Choose changed file, 2 of 3' })).toBeFocused();
  await page.keyboard.press('Alt+ArrowUp');
  await expect(fileNavigation).toContainText('1 of 3 files');
  await nextFile.click();
  await expect(fileNavigation).toContainText('2 of 3 files');
  await expect(diffViewer.locator('.diff-file-identity')).toHaveAttribute('title', 'apps/desktop/src/app/app.component.ts');
  await expect(diffViewer.locator('.diff-file-identity strong')).toHaveText('app.component.ts');
  await page.keyboard.press('Alt+ArrowDown');
  await expect(fileNavigation).toContainText('3 of 3 files');
  await expect(nextFile).toBeDisabled();
  await page.keyboard.press('Alt+ArrowUp');
  await expect(fileNavigation).toContainText('2 of 3 files');
  await closeDiff.click();
  await expect(diffViewer).toBeHidden();
  const selectedFile = commitPanel.locator('.commit-file.selected');
  await expect(selectedFile).toBeFocused();
  await selectedFile.click();
  await expect(diffViewer).toBeVisible();
  await backToGraph.click();
  await expect(diffViewer).toBeHidden();
  await selectedFile.click();
  await expect(diffViewer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(diffViewer).toBeHidden();
  await expect(selectedFile).toBeFocused();
});

test('keeps selected commit quick-action labels readable at the minimum desktop width', async ({ page }) => {
  await page.setViewportSize({ width: 780, height: 640 });
  await page.goto('/?worktree-tabs');
  await page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"] .commit-main').click({ position: { x: 80, y: 20 } });

  const inspector = page.locator('.commit-panel');
  const inspectorHeading = inspector.locator('.commit-inspector-copy b');
  await expect(inspectorHeading).toHaveText('Commit details');
  expect(await inspectorHeading.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(inspector.locator('.inspector-commit-position')).toBeHidden();
  await expect(inspector.getByRole('navigation', { name: /Navigate commit history, commit \d+ of \d+/ })).toBeVisible();
  await expect(inspector.getByRole('button', { name: 'Select newer commit' })).toBeVisible();
  await expect(inspector.getByRole('button', { name: 'Select older commit' })).toBeVisible();
  await expect(inspector.getByRole('button', { name: 'Close commit panel' })).toBeVisible();

  const actions = page.getByRole('navigation', { name: 'Selected commit actions' });
  await expect(actions.getByRole('button', { name: 'Compare selected commit with working directory' })).toBeVisible();
  await expect(actions.getByRole('button', { name: 'Cherry-pick' })).toBeVisible();
  for (const label of await actions.locator('button > span').all()) {
    expect(await label.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  }
});

test('uses the full compact viewport for a commit diff and returns to its inspector', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 640 });
  await page.goto('/');

  await page.getByRole('button', { name: 'Close commit panel' }).click();
  await page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"]').click();
  const commitPanel = page.locator('.commit-panel');
  const compactCommitTitle = commitPanel.locator('.commit-panel-title');
  await expect(compactCommitTitle.locator('.commit-inspector-copy b')).toHaveText('Commit details');
  await expect(compactCommitTitle.locator('.commit-inspector-revision')).toHaveText('f19b263a');
  expect(await compactCommitTitle.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  const selectedFile = commitPanel.locator('.commit-file').first();
  await expect(selectedFile).toBeVisible();
  const [sidebarLauncherBox, inspectorHeadingBox] = await Promise.all([
    page.getByRole('button', { name: 'Open left panel' }).boundingBox(),
    commitPanel.locator('.commit-inspector-heading').boundingBox(),
  ]);
  expect(sidebarLauncherBox).not.toBeNull();
  expect(inspectorHeadingBox).not.toBeNull();
  expect(sidebarLauncherBox!.x + sidebarLauncherBox!.width).toBeLessThanOrEqual(inspectorHeadingBox!.x);
  await selectedFile.click();

  const diffViewer = page.getByLabel('Diff viewer');
  await expect(diffViewer).toBeVisible();
  const [diffBox, viewportWidth] = await Promise.all([
    diffViewer.boundingBox(),
    page.evaluate(() => window.innerWidth),
  ]);
  expect(diffBox).not.toBeNull();
  expect(diffBox!.x).toBe(0);
  expect(diffBox!.width).toBe(viewportWidth);
  await expect(diffViewer.getByRole('button', { name: 'Back to commit graph' })).toBeVisible();
  await expect(diffViewer.getByRole('button', { name: 'Close diff' })).toBeVisible();
  await expect(diffViewer.locator('.diff-file-change-stats')).toHaveText('+16−5');
  const compactCommitContext = diffViewer.locator('.diff-source-context');
  await expect(compactCommitContext).toBeVisible();
  await expect(compactCommitContext).toHaveText('Polish repository activity drawer');
  await expect(compactCommitContext).toHaveAttribute('title', 'Polish repository activity drawer');
  expect(await diffViewer.locator('.diff-file-identity small').evaluate((element) =>
    element.scrollWidth <= element.clientWidth,
  )).toBe(true);

  await page.setViewportSize({ width: 540, height: 640 });
  await expect(diffViewer.locator('.diff-file-change-stats')).toBeHidden();
  await expect(compactCommitContext).toBeVisible();
  expect(await diffViewer.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

  await diffViewer.getByRole('button', { name: 'Close diff' }).click();
  await expect(diffViewer).toBeHidden();
  await expect(commitPanel).toBeVisible();
  await expect(selectedFile).toBeFocused();
});

test('navigates Path and Tree file layouts as roving segmented controls', async ({ page }) => {
  const workingLayout = page.getByRole('group', { name: 'File list layout' });
  const workingPath = workingLayout.getByRole('button', { name: 'Path' });
  const workingTree = workingLayout.getByRole('button', { name: 'Tree' });
  await expect(workingPath).toHaveAttribute('aria-pressed', 'true');
  await expect(workingPath).toHaveAttribute('tabindex', '0');
  await expect(workingTree).toHaveAttribute('tabindex', '-1');
  await workingPath.focus();
  await workingPath.press('ArrowRight');
  await expect(workingTree).toBeFocused();
  await expect(workingTree).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.commit-panel .file-tree-directory').first()).toBeVisible();

  await page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"]').click();
  const commitPanel = page.locator('.commit-panel');
  const commitLayout = commitPanel.getByRole('group', { name: 'Changed files layout' });
  const commitPath = commitLayout.getByRole('button', { name: 'Path' });
  const commitTree = commitLayout.getByRole('button', { name: 'Tree' });
  await expect(commitTree).toHaveAttribute('aria-pressed', 'true');
  await commitTree.focus();
  await commitTree.press('ArrowLeft');
  await expect(commitPath).toBeFocused();
  await expect(commitPath).toHaveAttribute('aria-pressed', 'true');
  await expect(commitPanel.locator('.commit-file:not(.tree-commit-file)').first()).toBeVisible();
});

test('selects individual changed lines for partial staging and discard', async ({ page }) => {
  await page.getByTitle('View changes in apps/desktop/src/app/app.component.html').click();
  const diff = page.getByLabel('Diff viewer');
  await expect(diff).toBeVisible();

  const addedLineSelector = diff.getByRole('button', { name: /Select added line/ });
  const selectorBounds = await addedLineSelector.boundingBox();
  expect(selectorBounds).not.toBeNull();
  expect(selectorBounds!.width).toBeGreaterThanOrEqual(24);
  expect(selectorBounds!.height).toBeGreaterThanOrEqual(24);
  await expect(addedLineSelector).toHaveAttribute('aria-pressed', 'false');
  await addedLineSelector.focus();
  await expect(addedLineSelector).toBeFocused();
  await addedLineSelector.press('Enter');
  const actions = diff.getByRole('group', { name: 'Selected line actions' });
  await expect(actions).toContainText('2 selected');
  await expect(diff.getByRole('button', { name: /Deselect added line/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(diff.getByRole('button', { name: /Deselect removed line/ })).toBeVisible();
  await expect(actions.getByRole('button', { name: 'Stage' })).toBeEnabled();
  await expect(actions.getByRole('button', { name: 'Discard' })).toBeEnabled();

  await actions.getByRole('button', { name: 'Clear selected lines' }).click();
  await expect(actions).toBeHidden();
  await diff.getByRole('button', { name: /Select removed line/ }).click();
  const discard = diff.getByRole('group', { name: 'Selected line actions' }).getByRole('button', { name: 'Discard' });
  await discard.click();

  const confirmation = page.getByRole('alertdialog');
  await expect(confirmation).toContainText('Discard selected lines');
  await expect(confirmation).toContainText('2 selected changed lines');
  await expect(confirmation).toContainText('Undo can restore the selection');
  await expect(confirmation.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirmation).toBeHidden();
  await expect(discard).toBeFocused();
});

test('navigates unstaged and staged files from the central diff', async ({ page }) => {
  const openedFile = page.getByTitle('View changes in apps/desktop/src/app/app.component.html');
  await openedFile.click();
  const diff = page.getByLabel('Diff viewer');
  const navigation = diff.getByRole('navigation', { name: 'Navigate changed files' });
  await expect(navigation).toContainText('1 of 4 files');
  await expect(diff.locator('.diff-file-identity')).toHaveAttribute('title', 'apps/desktop/src/app/app.component.html');
  await expect(diff.locator('.diff-file-identity strong')).toHaveText('app.component.html');

  await page.keyboard.press('Alt+ArrowDown');
  await expect(navigation).toContainText('2 of 4 files');
  await expect(diff.locator('.diff-file-identity')).toHaveAttribute('title', 'apps/desktop/src/app/app.component.scss');
  await expect(diff.locator('.diff-file-identity strong')).toHaveText('app.component.scss');
  await page.keyboard.press('Alt+ArrowDown');
  await page.keyboard.press('Alt+ArrowDown');
  await expect(navigation).toContainText('4 of 4 files');
  await expect(diff.locator('.diff-file-identity')).toHaveAttribute('title', 'apps/desktop/src/app/app.component.ts');
  await expect(diff.locator('.diff-file-identity strong')).toHaveText('app.component.ts');
  await expect(diff.locator('.diff-file-identity small')).toContainText('Staged Changes');
  await expect(navigation.getByRole('button', { name: 'Next changed file' })).toBeDisabled();

  const selectedFile = page.locator('.commit-panel .file-row.selected .file-name-button');
  await expect(selectedFile).toHaveAttribute('title', 'View staged changes in apps/desktop/src/app/app.component.ts');
  await diff.getByRole('button', { name: 'Close diff' }).click();
  await expect(diff).toBeHidden();
  await expect(selectedFile).toBeFocused();
});

test('jumps from commit details to a parent commit', async ({ page }) => {
  await page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"]').click();

  const commitPanel = page.locator('.commit-panel');
  const parent = commitPanel.getByRole('button', { name: /Jump to parent commit 83e6d15/ });
  await expect(parent).toContainText('83e6d15f');
  await expect(parent).toContainText('Merge feature/partial-staging');
  expect(await parent.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await parent.click();

  await expect(page.locator('[data-commit-oid="83e6d15fb82672899688b93f59251dfc669888a3"]')).toHaveClass(/selected/);
  await expect(commitPanel).toContainText('Merge feature/partial-staging');

  const child = commitPanel.getByRole('button', { name: /Jump to child commit f19b263/ });
  await expect(child).toContainText('f19b263a');
  await expect(child).toContainText('Polish repository activity drawer');
  await child.click();
  await expect(page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"]')).toHaveClass(/selected/);
  await expect(commitPanel).toContainText('Polish repository activity drawer');
});

test('persists the selected interface zoom preset', async ({ page }) => {
  const zoom = page.getByLabel('Interface zoom', { exact: true });
  const zoomControls = page.getByLabel('Interface zoom controls');
  const decreaseZoom = page.getByRole('button', { name: 'Decrease zoom' });
  const increaseZoom = page.getByRole('button', { name: 'Increase zoom' });
  const resetZoom = page.getByRole('button', { name: 'Reset zoom to 100 percent' });
  await expect(zoomControls).toHaveCSS('height', '26px');
  await expect(zoomControls.locator('.zoom-label')).toHaveText('Zoom');
  await zoom.focus();
  await expect(zoom).toHaveCSS('outline-style', 'solid');
  for (const control of [decreaseZoom, increaseZoom, resetZoom]) {
    await expect.poll(() => control.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return Math.min(box.width, box.height);
    })).toBeGreaterThanOrEqual(24);
  }
  await expect(decreaseZoom).toBeEnabled();
  await expect(resetZoom).toBeDisabled();
  expect(await decreaseZoom.evaluate((element) => Number.parseFloat(getComputedStyle(element).opacity))).toBeGreaterThanOrEqual(.7);

  await decreaseZoom.click();
  await expect(zoom.locator('option:checked')).toHaveText('90%');
  await expect(resetZoom).toBeEnabled();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('git-khronos.ui.zoom'))).toBe('90');

  await decreaseZoom.click();
  await expect(zoom.locator('option:checked')).toHaveText('80%');
  await decreaseZoom.click();
  await expect(zoom.locator('option:checked')).toHaveText('75%');
  await expect(decreaseZoom).toBeDisabled();

  await resetZoom.click();
  await expect(zoom.locator('option:checked')).toHaveText('100%');
  await expect(resetZoom).toBeDisabled();

  await zoom.selectOption({ label: '125%' });
  await expect(zoom.locator('option:checked')).toHaveText('125%');
  await expect(decreaseZoom).toBeEnabled();
  await expect(resetZoom).toBeEnabled();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('git-khronos.ui.zoom'))).toBe('125');

  await page.reload();
  const restoredZoom = page.getByLabel('Interface zoom', { exact: true });
  await expect(restoredZoom.locator('option:checked')).toHaveText('125%');

  await page.keyboard.press('Control+=');
  await expect(restoredZoom.locator('option:checked')).toHaveText('140%');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('git-khronos.ui.zoom'))).toBe('140');

  await page.keyboard.press('Control+-');
  await expect(restoredZoom.locator('option:checked')).toHaveText('125%');

  await page.keyboard.press('Control+0');
  await expect(restoredZoom.locator('option:checked')).toHaveText('100%');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('git-khronos.ui.zoom'))).toBe('100');

  await page.evaluate(() => localStorage.setItem('git-khronos.ui.zoom', 'invalid'));
  await page.reload();
  await expect(page.getByLabel('Interface zoom', { exact: true }).locator('option:checked')).toHaveText('100%');

  await page.evaluate(() => localStorage.setItem('git-khronos.ui.zoom', '  '));
  await page.reload();
  await expect(page.getByLabel('Interface zoom', { exact: true }).locator('option:checked')).toHaveText('100%');
});

test('reserves status-bar space for the persistent zoom controls', async ({ page }) => {
  const environment = page.locator('.status-version');
  await expect(environment).toHaveText('Preview');
  await expect(environment).toHaveAttribute('title', 'Browser preview environment');

  for (const width of [1440, 820, 700, 500, 420, 360]) {
    await page.setViewportSize({ width, height: 720 });
    const zoomBox = await page.getByLabel('Interface zoom controls').boundingBox();
    expect(zoomBox).not.toBeNull();
    if (width > 420) await expect(page.locator('.zoom-label')).toBeVisible();
    else await expect(page.locator('.zoom-label')).toBeHidden();
    const statusHeight = await page.locator('.statusbar').evaluate((element) => element.getBoundingClientRect().height);
    for (const selector of ['.status-branch', '.status-sync.outgoing', '.status-changes', '.activity-status', '.status-version']) {
      const item = page.locator(selector);
      if (await item.count() && await item.first().isVisible()) {
        const box = await item.first().boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x + box!.width, `${selector} should end before persistent zoom controls`).toBeLessThanOrEqual(zoomBox!.x - 8);
        if (await item.first().evaluate((element) => element instanceof HTMLButtonElement)) {
          expect(box!.width, `${selector} should retain a 24px pointer target`).toBeGreaterThanOrEqual(24);
          expect(box!.height, `${selector} should retain a 24px pointer target`).toBeGreaterThanOrEqual(24);
        }
        const height = box!.height;
        expect(height, `${selector} should remain on one compact status line`).toBeLessThan(statusHeight);
      }
    }
  }
});

test('keeps core repository text readable at 100 percent zoom', async ({ page }) => {
  await page.getByLabel('Interface zoom', { exact: true }).selectOption({ label: '100%' });
  const selectors = [
    '.commit-row .subject',
    '.commit-row .commit-description',
    '.sidebar .sidebar-heading',
    '.sidebar .branch-item',
    '.tool-button small',
    '.toolbar-sync-badge',
    '.ref-pill .ref-sync',
    '.reference-stack-label',
    '.commit-panel .file-row',
    '.commit-form input[name="summary"]',
    '.commit-field > span',
    '.statusbar',
    '.status-version.preview',
    '.zoom-label',
  ];

  for (const selector of selectors) {
    const size = await page.locator(selector).first().evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).fontSize));
    expect(size, `${selector} should remain readable without zoom`).toBeGreaterThanOrEqual(12);
  }
});

test('keeps secondary workspace text legible and respects reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const workspaceSelectors = [
    '.workspace-toggle > small',
    '.repo-tab.has-changes i',
    '.toolbar-nav-button .branch-state-summary',
    '.worktree-list-main small',
    '.wip-nav.selected small',
    '.remote-location-heading > b',
    '.graph-columns .column-heading-label',
    '.toolbar-nav-button small',
    '.file-path-prefix',
    '.submodule-manager small',
    '.wip-row .row-author',
    '.wip-row .row-date',
    '[data-commit-oid="83e6d15fb82672899688b93f59251dfc669888a3"] .author-node',
  ];
  const inspectorSelectors = [
    '.commit-row.selected .commit-description',
    '.commit-row.selected .row-author',
    '.commit-row.selected .row-date',
    '.commit-signature small',
  ];
  const assertContrast = async (selectors: string[], theme: string) => {
    for (const selector of selectors) {
      const ratio = await page.locator(selector).first().evaluate((element) => {
        const channels = (value: string) => {
          const parsed = (value.match(/[\d.]+/g) ?? []).map(Number);
          return value.startsWith('color(srgb')
            ? [(parsed[0] ?? 0) * 255, (parsed[1] ?? 0) * 255, (parsed[2] ?? 0) * 255, parsed[3] ?? 1]
            : [parsed[0] ?? 0, parsed[1] ?? 0, parsed[2] ?? 0, parsed[3] ?? 1];
        };
        const luminance = ([red, green, blue]: number[]) => {
          const linear = [red, green, blue].map((channel) => {
            const normalized = channel / 255;
            return normalized <= .04045 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4;
          });
          return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
        };
        const foreground = channels(getComputedStyle(element).color);
        let backgroundElement: Element | null = element;
        let background = [0, 0, 0, 0];
        while (backgroundElement && (background[3] ?? 0) === 0) {
          background = channels(getComputedStyle(backgroundElement).backgroundColor);
          backgroundElement = backgroundElement.parentElement;
        }
        const foregroundLuminance = luminance(foreground);
        const backgroundLuminance = luminance(background);
        return (Math.max(foregroundLuminance, backgroundLuminance) + .05)
          / (Math.min(foregroundLuminance, backgroundLuminance) + .05);
      });
      expect(ratio, `${selector} should meet WCAG AA contrast in ${theme}`).toBeGreaterThanOrEqual(4.5);
    }
  };
  for (const theme of ['chronos', 'midnight']) {
    await page.evaluate((value) => localStorage.setItem('git-khronos.ui.theme', value), theme);
    await page.reload();
    await expect(page.locator('.commit-row').first()).toBeVisible();
    await assertContrast(workspaceSelectors, theme);
    await page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"]').click();
    await expect(page.locator('.commit-panel')).toContainText('Polish repository activity drawer');
    await assertContrast(inspectorSelectors, theme);
  }

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: /Switch branch, current main/ }).click();
  const motionDurations = await page.locator('.toolbar-nav-menu').evaluate((element) => {
    const style = getComputedStyle(element);
    const milliseconds = (value: string) => value.split(',').map((duration) => {
      const normalized = duration.trim();
      return normalized.endsWith('ms') ? Number.parseFloat(normalized) : Number.parseFloat(normalized) * 1000;
    });
    return {
      animation: milliseconds(style.animationDuration),
      iterations: style.animationIterationCount,
      transition: milliseconds(getComputedStyle(element.querySelector('button')!).transitionDuration),
    };
  });
  expect(motionDurations.animation.every((duration) => duration <= .01)).toBe(true);
  expect(motionDurations.transition.every((duration) => duration <= .01)).toBe(true);
  expect(motionDurations.iterations).toBe('1');
});

test('reveals changed files without scrolling in a compact-height commit inspector', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 600 });
  await page.locator('.commit-row[data-commit-oid]').filter({ hasText: 'Refine graph lane rendering' }).click();

  const inspector = page.locator('.commit-panel');
  const firstChangedFile = inspector.locator('.commit-file').first();
  const unsignedSignature = inspector.getByLabel('Unsigned', { exact: true });
  await expect(firstChangedFile).toBeVisible();
  await expect(unsignedSignature).toBeVisible();
  await expect(unsignedSignature).toContainText('No cryptographic signature is stored in this commit.');
  await expect(inspector.locator('.commit-relations')).toContainText('Parents');
  await expect(inspector.locator('.commit-relations')).toContainText('Children');

  const [fileBounds, statusbarBounds] = await Promise.all([
    firstChangedFile.boundingBox(),
    page.locator('.statusbar').boundingBox(),
  ]);
  expect(fileBounds).not.toBeNull();
  expect(statusbarBounds).not.toBeNull();
  expect(fileBounds!.y + fileBounds!.height).toBeLessThanOrEqual(statusbarBounds!.y);
});

test('keeps the commit inspector usable in a compact desktop window', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 720 });
  await expect(page.locator('.sidebar')).toBeHidden();
  const sidebarLauncher = page.getByRole('button', { name: 'Open left panel' });
  await expect(sidebarLauncher).toBeVisible();
  await sidebarLauncher.click();
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.getByRole('button', { name: 'Close left panel' }).click();
  await expect(page.locator('.sidebar')).toBeHidden();

  const inspector = page.locator('.commit-panel');
  await expect(inspector).toBeVisible();
  await expect(inspector).toHaveCSS('opacity', '1');
  const inspectorLayer = await inspector.evaluate((element) => Number.parseInt(getComputedStyle(element).zIndex, 10));
  const graphOverlayLayers = await page.locator('.graph-scroll-markers, .history-return-head').evaluateAll((elements) =>
    elements.map((element) => Number.parseInt(getComputedStyle(element).zIndex, 10) || 0));
  expect(inspectorLayer).toBeGreaterThan(Math.max(...graphOverlayLayers));
  const animatedOpacityValues = await inspector.evaluate((element) => element.getAnimations()
    .flatMap((animation) => (animation.effect as KeyframeEffect | null)?.getKeyframes() ?? [])
    .map((frame) => frame.opacity)
    .filter((opacity) => opacity !== undefined));
  expect(animatedOpacityValues).toEqual([]);
  await expect(inspector).toHaveCSS('transform', 'none');
  const box = await inspector.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.round(box!.width)).toBeGreaterThanOrEqual(300);
  expect(Math.round(box!.width)).toBeLessThanOrEqual(355);
  expect(await inspector.evaluate((element) => element.scrollWidth)).toBe(await inspector.evaluate((element) => element.clientWidth));
  const layoutViewportWidth = await page.evaluate(() => document.documentElement.clientWidth);
  expect(Math.round(box!.x + box!.width)).toBe(layoutViewportWidth);
  await expect(page.locator('.history-panel')).toBeVisible();
  await expect(page.locator('.toolbar-actions .tool-button small').first()).toBeHidden();
  const compactPaths = page.locator('.file-name-button.path-display').filter({ has: page.locator('.file-path-name') });
  await expect(compactPaths.nth(0).locator('.file-path-name')).toHaveText('app.component.html');
  await expect(compactPaths.nth(1).locator('.file-path-name')).toHaveText('app.component.scss');
  const compactPathLayout = await compactPaths.nth(0).evaluate((button) => {
    const prefix = button.querySelector<HTMLElement>('.file-path-prefix')!;
    const name = button.querySelector<HTMLElement>('.file-path-name')!;
    const buttonBounds = button.getBoundingClientRect();
    const nameBounds = name.getBoundingClientRect();
    return {
      prefixTruncated: prefix.scrollWidth > prefix.clientWidth,
      nameVisible: name.clientWidth === name.scrollWidth,
      nameInsideButton: nameBounds.left >= buttonBounds.left && nameBounds.right <= buttonBounds.right,
    };
  });
  expect(compactPathLayout).toEqual({
    prefixTruncated: true,
    nameVisible: true,
    nameInsideButton: true,
  });
  const compactCommitOptions = await inspector.locator('.commit-options .commit-option').evaluateAll((options) => options.map((option) => {
    const bounds = option.getBoundingClientRect();
    return { x: Math.round(bounds.x), y: Math.round(bounds.y), height: Math.round(bounds.height) };
  }));
  expect(compactCommitOptions).toHaveLength(4);
  expect(new Set(compactCommitOptions.map(({ x }) => x)).size).toBe(2);
  expect(compactCommitOptions.every(({ height }) => height >= 24)).toBe(true);
  expect(compactCommitOptions[1].x).toBeGreaterThan(compactCommitOptions[0].x);
  expect(compactCommitOptions[1].y).toBe(compactCommitOptions[0].y);
  expect(compactCommitOptions[2].y).toBeGreaterThan(compactCommitOptions[0].y);
  const summaryLabel = inspector.getByText('Summary', { exact: true });
  const descriptionLabel = inspector.getByText('Description', { exact: true });
  await expect(summaryLabel).toBeVisible();
  await expect(descriptionLabel).toBeVisible();
  await summaryLabel.click();
  await expect(inspector.locator('#commit-summary')).toBeFocused();
  await expect(inspector.locator('#commit-summary')).toHaveCSS('outline-width', '2px');
  await descriptionLabel.click();
  await expect(inspector.locator('#commit-description')).toBeFocused();
  await expect(inspector.locator('#commit-description')).toHaveCSS('outline-width', '2px');
  const compactCommitButton = await inspector.locator('.commit-form .primary').boundingBox();
  expect(compactCommitButton).not.toBeNull();
  expect(compactCommitButton!.y + compactCommitButton!.height).toBeLessThanOrEqual(720 - 26);
  await expect(inspector.locator('.commit-form .primary')).toBeDisabled();
  await expect(inspector.locator('.commit-form .primary')).toHaveCSS('opacity', '1');
  await expect(inspector.locator('.commit-form .primary gc-icon')).toBeVisible();

  await page.setViewportSize({ width: 1024, height: 700 });
  const [shortCommitButton, shortStatusBar] = await Promise.all([
    inspector.locator('.commit-form .primary').boundingBox(),
    page.locator('.statusbar').boundingBox(),
  ]);
  expect(shortCommitButton).not.toBeNull();
  expect(shortStatusBar).not.toBeNull();
  expect(shortCommitButton!.y + shortCommitButton!.height).toBeLessThanOrEqual(shortStatusBar!.y);
  await inspector.locator('.commit-form input[name="summary"]').fill('Prepare compact commit action');
  await expect(inspector.locator('.commit-form .primary')).toBeEnabled();
  await expect(inspector.locator('.commit-form .primary')).toHaveCSS('background-color', 'rgb(84, 214, 173)');
  await inspector.locator('.commit-form input[name="summary"]').fill('');

  await page.getByRole('button', { name: 'Close commit panel' }).click();
  await expect(inspector).toBeHidden();

  await page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"]').click();
  await expect(inspector).toBeVisible();
  await expect(inspector).toContainText('Polish repository activity drawer');
  const compactQuickActionLabels = inspector.locator('.commit-quick-actions button > span');
  await expect(compactQuickActionLabels).toHaveCount(2);
  expect(await compactQuickActionLabels.evaluateAll((labels) => labels.every((label) => label.scrollWidth <= label.clientWidth))).toBe(true);
  const compactChangedFiles = inspector.locator('.commit-file-list .commit-file');
  await expect(compactChangedFiles).toHaveCount(3);
  const compactFileListMaxHeight = await inspector.locator('.commit-file-list').evaluate((element) => Number.parseFloat(getComputedStyle(element).maxHeight));
  const compactViewportHeight = await page.evaluate(() => window.innerHeight);
  expect(compactFileListMaxHeight).toBeCloseTo(Math.min(320, Math.max(190, compactViewportHeight * .35)), 0);
  const [secondChangedFile, compactCommitStatusBar] = await Promise.all([
    compactChangedFiles.nth(1).boundingBox(),
    page.locator('.statusbar').boundingBox(),
  ]);
  expect(secondChangedFile).not.toBeNull();
  expect(compactCommitStatusBar).not.toBeNull();
  expect(secondChangedFile!.y + secondChangedFile!.height).toBeLessThanOrEqual(compactCommitStatusBar!.y);

  await page.getByRole('button', { name: 'Close commit panel' }).click();
  await expect(inspector).toBeHidden();
  await page.getByRole('button', { name: 'Show Commit Panel', exact: true }).click();
  await expect(inspector).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.getByRole('button', { name: /Open working directory changes/ }).click();
  await expect(inspector.locator('.commit-options .commit-option')).toHaveCount(4);
  const wideCommitOptions = await inspector.locator('.commit-options .commit-option').evaluateAll((options) => options.map((option) => {
    const bounds = option.getBoundingClientRect();
    return { x: Math.round(bounds.x), y: Math.round(bounds.y) };
  }));
  expect(wideCommitOptions[1].x).toBeGreaterThan(wideCommitOptions[0].x);
  expect(wideCommitOptions[1].y).toBe(wideCommitOptions[0].y);
});

test('persists automatic remote refresh without implying a pull', async ({ page }) => {
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  await page.getByRole('dialog', { name: 'Preferences' }).getByRole('tab', { name: /^Git/ }).click();
  const interval = page.getByLabel('Automatic fetch interval');
  await expect(interval.locator('option:checked')).toHaveText('Every 5 minutes');
  await expect(page.getByText('It never pulls or changes working files.')).toBeVisible();

  await interval.selectOption({ label: 'Every 15 minutes' });
  await expect.poll(() => page.evaluate(() => localStorage.getItem('git-khronos.remote.auto-fetch-minutes'))).toBe('15');
  await page.reload();
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  await page.getByRole('dialog', { name: 'Preferences' }).getByRole('tab', { name: /^Git/ }).click();
  await expect(page.getByLabel('Automatic fetch interval').locator('option:checked')).toHaveText('Every 15 minutes');
});

test('guides an unpublished branch through remote selection', async ({ page }) => {
  await page.goto('/?unpublished-branch');

  const publish = page.getByRole('button', { name: 'Publish feature/partial-staging to origin' });
  await expect(publish).toContainText('Publish');
  await publish.click();

  const dialog = page.getByRole('dialog', { name: 'Publish feature/partial-staging' });
  await expect(dialog).toContainText('remember the selected remote as its upstream');
  const remote = dialog.getByLabel('Publish remote');
  await expect(remote.locator('option')).toHaveText(['origin', 'upstream']);
  await expect(remote.locator('option:checked')).toHaveText('origin');
  await expect(dialog.getByRole('button', { name: 'Publish Branch' })).toBeEnabled();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('routes an unpublished branch without remotes into remote setup', async ({ page }) => {
  await page.goto('/?unpublished-branch&no-remotes');
  await page.getByRole('button', { name: 'Publish feature/partial-staging to a remote' }).click();

  const publishDialog = page.getByRole('dialog', { name: 'Publish feature/partial-staging' });
  await expect(publishDialog).toContainText('No remotes are configured');
  await expect(publishDialog.getByRole('button', { name: 'Publish Branch' })).toBeDisabled();
  await publishDialog.getByRole('button', { name: 'Add Remote' }).click();

  await expect(page.getByRole('dialog', { name: 'Add Remote' })).toBeVisible();
  await expect(page.getByLabel('Name')).toHaveValue('origin');
});

test('keeps focused file changes inside the center workspace', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?compare-commits&diff-viewer=split');

  const sidebar = page.locator('.sidebar');
  const diff = page.getByLabel('Diff viewer');
  const commitPanel = page.locator('.commit-panel');
  await expect(diff).toBeVisible();
  await expect(sidebar).toBeVisible();
  await expect(commitPanel).toBeVisible();
  await expect(page.getByLabel('Diff layout').getByRole('button', { name: 'Split' })).toHaveClass(/active/);
  await expect(page.locator('.split-diff-body')).toHaveCSS('font-size', '13px');
  const currentFile = commitPanel.locator('.commit-file.selected');
  await expect(currentFile).toHaveCount(1);
  await expect(currentFile).toHaveAttribute('aria-current', 'true');
  const currentFileStyle = await currentFile.evaluate((element) => {
    const style = getComputedStyle(element);
    return { backgroundColor: style.backgroundColor, boxShadow: style.boxShadow };
  });
  expect(currentFileStyle.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(currentFileStyle.boxShadow).toContain('inset');
  const anotherFile = commitPanel.locator('.commit-file:not(.selected)').first();
  if (await anotherFile.count()) {
    await expect(anotherFile).not.toHaveAttribute('aria-current', 'true');
  }
  const fileIdentity = diff.locator('.diff-file-identity');
  const fullPath = await fileIdentity.getAttribute('title');
  expect(fullPath).toBeTruthy();
  await expect(fileIdentity.locator('strong')).toHaveText(fullPath!.split('/').at(-1)!);
  await expect(diff.getByRole('button', { name: `Copy path for ${fullPath}` })).toHaveAttribute('title', 'Copy full file path');
  expect(await fileIdentity.locator('strong').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await diff.locator('.diff-workspace-toolbar').evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(75);
  const [backBox, identityBox, closeBox, pickerBox, layoutBox, actionsBox] = await Promise.all([
    diff.getByRole('button', { name: 'Back to commit graph' }).boundingBox(),
    fileIdentity.boundingBox(),
    diff.getByRole('button', { name: 'Close diff' }).boundingBox(),
    diff.locator('.diff-file-picker').boundingBox(),
    diff.getByRole('group', { name: 'Diff layout' }).boundingBox(),
    diff.locator('.diff-workspace-actions').boundingBox(),
  ]);
  expect(backBox).not.toBeNull();
  expect(identityBox).not.toBeNull();
  expect(closeBox).not.toBeNull();
  expect(pickerBox).not.toBeNull();
  expect(layoutBox).not.toBeNull();
  expect(actionsBox).not.toBeNull();
  const verticalCenter = (box: NonNullable<typeof backBox>) => box.y + box.height / 2;
  expect(Math.abs(verticalCenter(identityBox!) - verticalCenter(backBox!))).toBeLessThanOrEqual(1);
  expect(Math.abs(verticalCenter(closeBox!) - verticalCenter(backBox!))).toBeLessThanOrEqual(1);
  expect(pickerBox!.y).toBeGreaterThanOrEqual(backBox!.y + backBox!.height - 1);
  expect(Math.abs(verticalCenter(layoutBox!) - verticalCenter(pickerBox!))).toBeLessThanOrEqual(1);
  expect(Math.abs(verticalCenter(actionsBox!) - verticalCenter(pickerBox!))).toBeLessThanOrEqual(1);

  const [sidebarBox, diffBox, commitPanelBox] = await Promise.all([
    sidebar.boundingBox(),
    diff.boundingBox(),
    commitPanel.boundingBox(),
  ]);
  expect(sidebarBox).not.toBeNull();
  expect(diffBox).not.toBeNull();
  expect(commitPanelBox).not.toBeNull();
  expect(diffBox!.x).toBeGreaterThanOrEqual(sidebarBox!.x + sidebarBox!.width - 1);
  expect(diffBox!.x + diffBox!.width).toBeLessThanOrEqual(commitPanelBox!.x + 1);

});

test('adapts split comparison to the center pane without losing the preferred layout', async ({ page }) => {
  await page.setViewportSize({ width: 780, height: 650 });
  await page.goto('/?compare-commits&diff-viewer=split');

  const layout = page.getByRole('group', { name: 'Diff layout' });
  const split = layout.getByRole('button', { name: 'Split' });
  const firstPair = page.locator('.split-row').first();
  const before = firstPair.locator('.split-side').first();
  const after = firstPair.locator('.split-side').nth(1);
  await expect(split).toHaveAttribute('aria-pressed', 'true');
  await expect(split).toHaveAccessibleDescription('Before and after comparison. In narrow workspaces, panels are stacked vertically.');
  await expect(split.locator('.diff-mode-split-compact')).toBeVisible();
  await expect(split.locator('.diff-mode-split-wide')).toBeHidden();
  await split.click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('git-khronos.diff.view-mode'))).toBe('split');
  await expect(page.locator('.split-diff-stacked-head')).toBeVisible();
  await expect(page.getByLabel('Before and after file changes')).toBeVisible();
  expect(await before.evaluate((element) => getComputedStyle(element, '::before').content)).toContain('Before');
  expect(await after.evaluate((element) => getComputedStyle(element, '::before').content)).toContain('After');

  const [narrowBefore, narrowAfter] = await Promise.all([before.boundingBox(), after.boundingBox()]);
  expect(narrowBefore).not.toBeNull();
  expect(narrowAfter).not.toBeNull();
  expect(Math.abs(narrowAfter!.x - narrowBefore!.x)).toBeLessThanOrEqual(1);
  expect(narrowAfter!.y).toBeGreaterThanOrEqual(narrowBefore!.y + narrowBefore!.height - 1);

  await page.setViewportSize({ width: 700, height: 650 });
  const toolbar = page.locator('.diff-workspace-toolbar');
  expect(await toolbar.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  const [compactLayout, compactActions] = await Promise.all([
    layout.boundingBox(),
    page.locator('.diff-workspace-actions').boundingBox(),
  ]);
  expect(compactLayout).not.toBeNull();
  expect(compactActions).not.toBeNull();
  expect(compactLayout!.x + compactLayout!.width).toBeLessThanOrEqual(compactActions!.x + 1);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('.split-diff-stacked-head')).toBeHidden();
  await expect(split.locator('.diff-mode-split-wide')).toBeVisible();
  await expect(split.locator('.diff-mode-split-compact')).toBeHidden();
  const [wideBefore, wideAfter] = await Promise.all([before.boundingBox(), after.boundingBox()]);
  expect(wideBefore).not.toBeNull();
  expect(wideAfter).not.toBeNull();
  expect(Math.abs(wideAfter!.y - wideBefore!.y)).toBeLessThanOrEqual(1);
  expect(wideAfter!.x).toBeGreaterThanOrEqual(wideBefore!.x + wideBefore!.width - 1);
  await expect(split).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => localStorage.getItem('git-khronos.diff.view-mode'))).toBe('split');
});

test('includes the active split diff in F6 workspace navigation', async ({ page }) => {
  await page.goto('/?compare-commits&diff-viewer=split');

  const references = page.getByRole('complementary', { name: 'Repository references' });
  const splitDiff = page.getByRole('region', { name: 'Before and after source lines', exact: true });
  await references.focus();
  await expect(references).toBeFocused();

  await page.keyboard.press('F6');
  await expect(splitDiff).toBeFocused();
  await expect(splitDiff).toHaveClass(/workspace-focus-region/);
  await expect(splitDiff).toHaveCSS('outline-style', 'solid');
  await expect(splitDiff).toHaveCSS('outline-width', '2px');
});

test('navigates diff layouts as a roving segmented control', async ({ page }) => {
  await page.goto('/?compare-commits&diff-viewer=split');
  const layout = page.getByRole('group', { name: 'Diff layout' });
  const hunk = layout.getByRole('button', { name: 'Hunk' });
  const inline = layout.getByRole('button', { name: 'Inline' });
  const split = layout.getByRole('button', { name: 'Split' });

  await expect(split).toHaveAttribute('aria-pressed', 'true');
  await expect(split).toHaveAttribute('tabindex', '0');
  await expect(hunk).toHaveAttribute('tabindex', '-1');
  await split.focus();
  await split.press('ArrowLeft');
  await expect(inline).toBeFocused();
  await expect(inline).toHaveAttribute('aria-pressed', 'true');
  await inline.press('Home');
  await expect(hunk).toBeFocused();
  await expect(hunk).toHaveAttribute('aria-pressed', 'true');
  await hunk.press('End');
  await expect(split).toBeFocused();
  await expect(split).toHaveAttribute('aria-pressed', 'true');

  const history = page.getByRole('button', { name: 'History', exact: true });
  await history.click();
  await expect(history).toHaveAttribute('aria-pressed', 'true');
  await hunk.click();
  await expect(history).toHaveAttribute('aria-pressed', 'false');
});

test('remembers the preferred diff layout across files and reloads', async ({ page }) => {
  await page.goto('/?compare-commits&diff-viewer=hunk');
  const layout = page.getByRole('group', { name: 'Diff layout' });
  await layout.getByRole('button', { name: 'Split' }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('git-khronos.diff.view-mode'))).toBe('split');

  await page.goto('/');
  await page.getByTitle('View changes in apps/desktop/src/app/app.component.html').click();
  await expect(page.getByRole('group', { name: 'Diff layout' }).getByRole('button', { name: 'Split' })).toHaveAttribute('aria-pressed', 'true');
});

test('navigates diff changes with familiar review shortcuts', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?compare-commits&diff-viewer=split');
  const navigation = page.getByLabel('Navigate changes', { exact: true });
  const previous = navigation.getByRole('button', { name: 'Previous change' });
  const next = navigation.getByRole('button', { name: 'Next change' });

  await expect(previous).toHaveAttribute('aria-keyshortcuts', 'Shift+F7');
  await expect(next).toHaveAttribute('aria-keyshortcuts', 'F7');
  await expect(navigation).toContainText('1 / 3');
  await page.keyboard.press('F7');
  await expect(navigation).toContainText('2 / 3');
  await page.keyboard.press('Shift+F7');
  await expect(navigation).toContainText('1 / 3');

  await page.keyboard.press('Control+/');
  const shortcuts = page.getByRole('dialog', { name: 'Keyboard Shortcuts' });
  await expect(shortcuts.getByText('Previous diff change')).toBeVisible();
  await expect(shortcuts.getByText('Next diff change')).toBeVisible();
});

test('keeps compact diff change navigation visible on common desktop widths', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?compare-commits&diff-viewer=split');

  const compactNavigation = page.getByRole('navigation', { name: 'Navigate changes compact' });
  await expect(compactNavigation).toBeVisible();
  await expect(compactNavigation).toContainText('1 / 3');
  await compactNavigation.getByRole('button', { name: 'Next change' }).click();
  await expect(compactNavigation).toContainText('2 / 3');
  await page.keyboard.press('Shift+F7');
  await expect(compactNavigation).toContainText('1 / 3');

  const compactWrap = page.locator('.diff-footer-wrap-toggle');
  await expect(compactWrap).toBeVisible();
  await expect(compactWrap).toHaveAttribute('aria-pressed', 'false');
  await compactWrap.click();
  await expect(compactWrap).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Diff viewer')).toHaveClass(/word-wrap/);

  await page.setViewportSize({ width: 780, height: 560 });
  await page.goto('/?compare-commits&diff-viewer=split');
  const minimumToolbar = page.locator('.diff-workspace-toolbar');
  const minimumBack = page.getByRole('button', { name: 'Back to commit graph' });
  const minimumIdentity = page.locator('.diff-file-identity');
  const minimumFooter = page.locator('.diff-workspace-footer');
  await expect(minimumBack.locator('span')).toBeVisible();
  await expect(minimumBack).toContainText('Graph');
  await expect(page.getByRole('navigation', { name: 'Navigate changes compact' })).toBeVisible();
  await expect(page.locator('.diff-footer-wrap-toggle')).toBeVisible();
  const [minimumBackBox, minimumIdentityBox] = await Promise.all([
    minimumBack.boundingBox(),
    minimumIdentity.boundingBox(),
  ]);
  expect(minimumBackBox).not.toBeNull();
  expect(minimumIdentityBox).not.toBeNull();
  expect(minimumBackBox!.x + minimumBackBox!.width).toBeLessThanOrEqual(minimumIdentityBox!.x);
  expect(await minimumToolbar.evaluate((toolbar) => toolbar.scrollWidth <= toolbar.clientWidth)).toBe(true);
  expect(await minimumFooter.evaluate((footer) => footer.scrollWidth <= footer.clientWidth)).toBe(true);
});

test('preserves a readable responsive diff while keeping commit context visible', async ({ page }) => {
  for (const width of [1051, 1050, 1024, 820]) {
    await page.setViewportSize({ width, height: 768 });
    await page.goto('/?compare-commits&diff-viewer=split');

    const [sidebarBox, diffBox, commitPanelBox] = await Promise.all([
      page.locator('.sidebar').boundingBox(),
      page.getByLabel('Diff viewer').boundingBox(),
      page.locator('.commit-panel').boundingBox(),
    ]);
    expect(diffBox).not.toBeNull();
    expect(commitPanelBox).not.toBeNull();
    if (width > 1050) {
      expect(sidebarBox).not.toBeNull();
      expect(Math.abs(diffBox!.x - (sidebarBox!.x + sidebarBox!.width))).toBeLessThanOrEqual(1);
    } else {
      if (width <= 1050) expect(sidebarBox).toBeNull();
      else expect(sidebarBox).not.toBeNull();
      expect(diffBox!.x).toBeLessThanOrEqual(1);
      if (sidebarBox) expect(diffBox!.x).toBeLessThan(sidebarBox.x + sidebarBox.width);
      const [sidebarLauncherBox, backToGraphBox] = await Promise.all([
        page.getByRole('button', { name: 'Open left panel' }).boundingBox(),
        page.getByRole('button', { name: 'Back to commit graph' }).boundingBox(),
      ]);
      expect(sidebarLauncherBox).not.toBeNull();
      expect(backToGraphBox).not.toBeNull();
      expect(sidebarLauncherBox!.x + sidebarLauncherBox!.width).toBeLessThan(backToGraphBox!.x);
    }
    expect(Math.abs(diffBox!.x + diffBox!.width - commitPanelBox!.x)).toBeLessThanOrEqual(1);
    expect(diffBox!.width).toBeGreaterThanOrEqual(515);
    await expect(page.getByRole('button', { name: 'Back to commit graph' }).locator('span')).toBeVisible();
    expect(await page.locator('.diff-file-identity strong').evaluate((element) =>
      element.scrollWidth <= element.clientWidth,
    )).toBe(true);
    const closeBox = await page.getByLabel('Diff viewer').getByRole('button', { name: 'Close diff' }).boundingBox();
    expect(closeBox).not.toBeNull();
    expect(closeBox!.x + closeBox!.width).toBeLessThanOrEqual(diffBox!.x + diffBox!.width - 8);
  }
});

test('persists diff viewer typography and wrapping preferences', async ({ page }) => {
  await page.locator('button.chrome-icon[title="Preferences"]').click();
  const preferences = page.getByRole('dialog', { name: 'Preferences' });
  await preferences.getByRole('tab', { name: /Diff Viewer/ }).click();
  await expect(preferences.getByLabel('Diff viewer font size').locator('option:checked')).toHaveText('13 px');
  await preferences.getByLabel('Diff viewer font size').selectOption({ label: '14 px' });
  await preferences.getByLabel('Diff viewer tab width').selectOption({ label: '8 spaces' });
  await preferences.getByLabel('Wrap long lines by default').check();
  await page.getByRole('button', { name: 'Close preferences' }).click();

  await page.goto('/?compare-commits&diff-viewer=split');
  const diff = page.getByLabel('Diff viewer');
  await expect(diff).toHaveClass(/word-wrap/);
  await expect(page.locator('.split-diff-body')).toHaveCSS('font-size', '14px');
  await expect(page.locator('.split-diff-body')).toHaveCSS('tab-size', '8');
  await expect.poll(() => page.evaluate(() => ({
    fontSize: localStorage.getItem('git-khronos.diff.font-size'),
    tabSize: localStorage.getItem('git-khronos.diff.tab-size'),
    wordWrap: localStorage.getItem('git-khronos.diff.word-wrap'),
  }))).toEqual({ fontSize: '14', tabSize: '8', wordWrap: 'true' });
});
