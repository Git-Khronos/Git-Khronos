import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.locator('.commit-row').first()).toBeVisible();
});

test('uses the Git Chronos identity throughout the application chrome', async ({ page }) => {
  await expect(page).toHaveTitle('Git Chronos');
  await expect(page.locator('.app-menu .brand-mark')).toHaveText('GC');
  await page.getByRole('button', { name: 'Main menu' }).click();
  await expect(page.getByRole('menu', { name: 'Git Chronos menu' })).toContainText('Git Chronos');
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
      minimumGitVersion: '2.34.0',
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
  const openRepository = page.getByRole('button', { name: /Open repository/ });
  await expect(openRepository).toHaveAttribute('aria-keyshortcuts', 'Control+Shift+O Meta+Shift+O');
  await expect(openRepository).toHaveAttribute('title', 'Open a local repository (Ctrl+Shift+O)');
  await expect(openRepository.locator('kbd')).toHaveText('Ctrl ⇧ O');

  await page.setViewportSize({ width: 550, height: 720 });
  await expect(openRepository).toBeVisible();
  expect(await openRepository.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

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

  await openRepository.click();
  let manager = page.getByRole('dialog', { name: 'Repository management' });
  await expect(manager).toBeVisible();
  const browseTab = manager.getByRole('tab', { name: 'Browse' });
  const managerClose = manager.getByRole('button', { name: 'Close repository management' });
  const managerLastEnabled = manager.locator('button:not(:disabled)').last();
  await expect(browseTab).toHaveAttribute('aria-selected', 'true');
  await expect(browseTab).toBeFocused();
  await managerClose.focus();
  await managerClose.press('Shift+Tab');
  await expect(managerLastEnabled).toBeFocused();
  await managerLastEnabled.press('Tab');
  await expect(managerClose).toBeFocused();
  await expect(manager.getByText('Sample-data preview')).toBeVisible();
  await expect(page.getByText('Git needs attention')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(openRepository).toBeFocused();

  const cloneRepository = page.getByRole('button', { name: 'Clone repository' });
  await cloneRepository.click();
  manager = page.getByRole('dialog', { name: 'Repository management' });
  await expect(manager.getByLabel('Repository URL')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(cloneRepository).toBeFocused();

  const initializeRepository = page.getByRole('button', { name: 'Initialize repository' });
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
  await expect(dialog.getByRole('navigation', { name: 'Shortcut categories' })).toBeVisible();
  await expect(close).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Repository' })).toHaveAttribute('aria-current', 'location');

  await close.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Tabs and view' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Tabs and view' }).press('Tab');
  await expect(close).toBeFocused();
  await close.press('Tab');
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
  await expect(page.locator('.repo-tab.active')).toContainText('git-chronos');
  await expect(page.getByLabel('Repository actions')).toBeVisible();
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
  await expect(page.getByLabel('Local branch feature/partial-staging')).toHaveAttribute('title', /Local branch feature\/partial-staging/);
  const featureWorktree = page.getByLabel(/Worktree feature\/partial-staging, \/home\/maya\/projects\/git-chronos-partial-staging/);
  await expect(featureWorktree).toBeVisible();
  await expect(featureWorktree.locator('xpath=..')).toHaveAttribute('title', 'feature/partial-staging · /home/maya/projects/git-chronos-partial-staging');
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
  await page.getByRole('button', { name: 'Pull options' }).click();
  await expect(page.getByRole('menuitem', { name: /Fetch All/ })).toContainText('Remote references not fetched this session');
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
  await expect(page.locator('.grouped-reference-location.remote gc-icon')).toHaveCount(4);
  const sharedTip = page.locator('[data-commit-oid="83e6d15fb82672899688b93f59251dfc669888a3"] .commit-ref-stack');
  const sharedTipRefs = sharedTip.locator('.grouped-reference-location.remote');
  const sharedTipTrigger = sharedTip.locator('.reference-stack-trigger');
  await expect(sharedTipTrigger.locator('.reference-stack-label')).toHaveText('main');
  await expect(sharedTipTrigger).not.toContainText('origin/main');
  await expect(sharedTipTrigger).not.toContainText('upstream/main');
  await expect(sharedTipTrigger.locator('.reference-stack-locations gc-icon')).toHaveCount(2);
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
  await expect(sharedTip.locator('.grouped-reference-label')).toHaveText('main');
  expect(firstRefBox!.width).toBeGreaterThanOrEqual(18);
  expect(secondRefBox!.width).toBeGreaterThanOrEqual(18);
  expect(secondRefBox!.x).toBeGreaterThanOrEqual(firstRefBox!.x + firstRefBox!.width + 1);
  expect(Math.abs(firstRefBox!.y - secondRefBox!.y)).toBeLessThanOrEqual(1);
  await page.mouse.move(0, 0);
  await sharedTipTrigger.focus();
  await expect(sharedTipTrigger).toBeFocused();
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
  await expect(featureReferenceRow.locator('.ref-connector')).toHaveCSS('width', '44px');
  const firstWorkingTreePath = page.locator('.file-name-button.path-display').first();
  await expect(firstWorkingTreePath.locator('.file-path-prefix')).toHaveText('apps/desktop/src/app/');
  await expect(firstWorkingTreePath.locator('.file-path-name')).toHaveText('app.component.html');
  const workingTreeFilter = page.getByRole('searchbox', { name: 'Filter changed files' });
  await expect(workingTreeFilter).toHaveCSS('font-size', '12px');
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
  expect(await headMessage.locator('.commit-description').evaluate((description) => description.clientWidth)).toBeGreaterThan(48);
  await expect(page.locator('[data-commit-oid="7c17b9d37d6a36dc9477e611109136f86477041a"] .commit-main')).toHaveAttribute(
    'title',
    'Refine graph lane rendering\nKeep first-parent histories straight through commit nodes.',
  );
  const mayaGraphColor = await page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"] .author-node').evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(mayaGraphColor).toBe('rgb(140, 115, 50)');
  await expect(page.locator('.identity-chip > span')).toHaveCSS('background-color', mayaGraphColor);

  const signCommit = page.getByLabel('Sign this commit');
  await expect(page.getByLabel('Push after committing')).toBeVisible();
  await expect(page.getByLabel('Amend previous commit')).toBeVisible();
  await expect(page.getByLabel('Skip Git hooks')).toBeVisible();
  await expect(signCommit).toBeVisible();
  await expect(signCommit).not.toBeChecked();
  await expect(signCommit.locator('..')).toHaveAttribute('title', "Override the repository default for this commit using Git's configured signing key and format");
  const commitOptionHeights = await page.locator('.commit-option').evaluateAll((options) =>
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
  await expect(workingTreeActions.getByRole('button', { name: 'Pop latest stash' })).toContainText('Pop');

  const workingDirectoryOptions = page.getByRole('button', { name: 'Working directory options' });
  await expect(workingDirectoryOptions.locator('gc-icon svg')).toBeVisible();
  await expect(workingDirectoryOptions).toHaveAttribute('aria-haspopup', 'menu');
  await expect(workingDirectoryOptions).toHaveAttribute('aria-expanded', 'false');
  await workingDirectoryOptions.click();
  const workingTreeMenu = page.getByRole('menu', { name: 'Working directory options' });
  const refreshWorkingTree = workingTreeMenu.getByRole('menuitem', { name: /Refresh working directory/ });
  const openFileManager = workingTreeMenu.getByRole('menuitem', { name: /Open in file manager/ });
  const openTerminal = workingTreeMenu.getByRole('menuitem', { name: /Open terminal/ });
  await expect(refreshWorkingTree).toBeFocused();
  await expect(openFileManager).toBeVisible();
  await expect(openTerminal).toBeVisible();
  await expect(workingDirectoryOptions).toHaveAttribute('aria-expanded', 'true');
  await expect(workingDirectoryOptions).toHaveClass(/menu-open/);
  await page.keyboard.press('ArrowDown');
  await expect(openFileManager).toBeFocused();
  await page.keyboard.press('End');
  await expect(openTerminal).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(workingTreeMenu).toBeHidden();
  await expect(workingDirectoryOptions).toHaveAttribute('aria-expanded', 'false');
  await expect(workingDirectoryOptions).toBeFocused();
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
  expect(await page.locator('.file-row:has(.stage-box)').evaluateAll((rows) =>
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
  expect(await page.evaluate(() => localStorage.getItem('git-chronos.working-tree.unstaged-file-list-height'))).toBe('175');

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
  expect(await page.evaluate(() => localStorage.getItem('git-chronos.working-tree.unstaged-file-list-height'))).toBeNull();
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
  const pullToggle = page.getByTitle('Pull options');
  await expect(pullToggle).toHaveAttribute('aria-haspopup', 'menu');
  await expect(pullToggle).toHaveAttribute('aria-controls', 'pull-options-menu');
  await expect(pullToggle).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(() => pullToggle.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(24);
  await pullToggle.click();
  const pullMenu = page.getByRole('menu', { name: 'Pull options' });
  await expect(pullMenu).toHaveAttribute('id', 'pull-options-menu');
  await expect(pullToggle).toHaveAttribute('aria-expanded', 'true');
  const fetchAll = pullMenu.getByRole('menuitem', { name: /Fetch All/ });
  await expect(fetchAll).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(pullMenu.getByRole('menuitem', { name: /Fast-forward if possible Merge/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(pullMenu).toHaveCount(0);
  await expect(pullToggle).toBeFocused();

  const pushToggle = page.getByTitle('Push options');
  await expect(pushToggle).toHaveAttribute('aria-haspopup', 'menu');
  await expect(pushToggle).toHaveAttribute('aria-controls', 'push-options-menu');
  await expect.poll(() => pushToggle.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(24);
  await pushToggle.click();
  const pushMenu = page.getByRole('menu', { name: 'Push options' });
  await expect(pushMenu).toHaveAttribute('id', 'push-options-menu');
  await expect(pushMenu.getByRole('menuitem', { name: /^Push/ }).first()).toBeFocused();
  await page.keyboard.press('End');
  await expect(pushMenu.getByRole('menuitem', { name: /Force Push with Lease/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(pushToggle).toBeFocused();

  const branchToggle = page.getByTitle('Branch options');
  await expect(branchToggle).toHaveAttribute('aria-haspopup', 'menu');
  await expect(branchToggle).toHaveAttribute('aria-controls', 'branch-options-menu');
  await expect.poll(() => branchToggle.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(24);
  await branchToggle.click();
  const branchMenu = page.getByRole('menu', { name: 'Branch options' });
  await expect(branchMenu).toHaveAttribute('id', 'branch-options-menu');
  await expect(branchMenu.getByRole('menuitem', { name: /Create branch/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(branchMenu.getByRole('menuitem', { name: /main Current branch/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(branchToggle).toBeFocused();
});

test('keeps expanded aligned references clear of the compact inspector', async ({ page }) => {
  for (const width of [820, 700]) {
    await page.setViewportSize({ width, height: 720 });
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
  }
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

  const paths = await parentCommit.locator('.graph-edges path').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('d') ?? ''));
  expect(paths).toContain(
    `M ${branchOffset} 0 V 8 A 12 12 0 0 1 ${branchOffset - 12} 20 H ${parentOffset + 12}`,
  );
});

test('starts each worktree lane at its own WIP node', async ({ page }) => {
  const rows = page.locator('.wip-row');
  await expect(rows).toHaveCount(2);

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
  expect(expandedSurfaceBox!.y).toBeGreaterThanOrEqual(
    expandedTriggerBox!.y + expandedTriggerBox!.height + 2,
  );

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
  for (const width of [820, 700]) {
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

test('reopens commit details after compact users dismiss the inspector to browse', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 720 });
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
  expect(listBox!.x + listBox!.width).toBeLessThanOrEqual(360);

  await row.click();
  await expect(inspector).toBeVisible();
  await expect(inspector).toContainText('Polish repository activity drawer');
  await expect(page.getByRole('button', { name: 'Close commit panel' })).toBeVisible();
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
      await expect(page.getByRole('button', { name: 'Open left panel' })).toBeVisible();
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
  }

  await page.setViewportSize({ width: 1050, height: 720 });
  await page.goto('/');
  const openSidebar = page.getByRole('button', { name: 'Open left panel' });
  await expect(openSidebar).toBeVisible();
  await openSidebar.click();
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('.sidebar')).toHaveCSS('position', 'fixed');
  await page.getByRole('button', { name: 'Close left panel' }).click();
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect(openSidebar).toBeFocused();
});

test('keeps the smallest toolbar collision-free and expands commit search on demand', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 720 });
  await expect(page.locator('.toolbar-navigation')).toBeHidden();
  await expect(page.locator('.toolbar-actions .tool-button small').filter({ hasText: 'Pull' })).toBeVisible();
  await expect(page.locator('.toolbar-actions .tool-button small').filter({ hasText: 'Terminal' })).toBeVisible();

  await page.setViewportSize({ width: 900, height: 720 });
  const compactSearch = page.locator('.graph-search');
  await expect(compactSearch.locator('kbd')).toBeHidden();
  expect((await compactSearch.locator('input').boundingBox())!.width).toBeGreaterThanOrEqual(110);

  await page.setViewportSize({ width: 700, height: 720 });
  await expect(page.locator('.toolbar-actions .tool-button small').filter({ hasText: 'Pull' })).toBeHidden();

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
    await expect(page.getByTitle(/Open repository terminal/)).toBeVisible();
    await expect(page.locator('.toolbar-utilities .toolbar-panel-button')).toBeVisible();
    await expect(page.locator('.toolbar-actions .tool-button small').filter({ hasText: 'Pull' })).toBeHidden();
    if (width <= 550) {
      expect((await page.locator('.graph-search').boundingBox())!.width).toBeLessThanOrEqual(30);
    }
  }

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

  const search = page.getByLabel('Search commits by message, SHA, or author');
  const searchToggle = page.getByRole('button', { name: 'Focus commit search' });
  await expect.poll(() => searchToggle.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return Math.min(box.width, box.height);
  })).toBeGreaterThanOrEqual(24);
  await expect(searchToggle).toHaveAttribute('aria-expanded', 'false');
  await searchToggle.click();
  await expect(searchToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(search).toBeFocused();
  expect((await search.boundingBox())!.height).toBeGreaterThanOrEqual(24);
  expect((await page.locator('.graph-search').boundingBox())!.width).toBeGreaterThan(200);
  await search.fill('lane rendering');
  await expect(page.locator('.search-result-count')).toHaveText('1 / 1');
  await page.getByRole('button', { name: 'Clear commit search' }).click();
  await page.keyboard.press('Tab');
  await expect(searchToggle).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(async () => (await page.locator('.graph-search').boundingBox())!.width).toBeLessThanOrEqual(30);

  await searchToggle.click();
  await search.press('Escape');
  await expect(searchToggle).toBeFocused();
  await expect(searchToggle).toHaveAttribute('aria-expanded', 'false');
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
  await first.press('ArrowDown');
  await expect(second).toBeFocused();
  await expect(second).toHaveAttribute('aria-pressed', 'true');

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
  const newer = inspector.getByRole('button', { name: 'Select newer commit' });
  const older = inspector.getByRole('button', { name: 'Select older commit' });
  await expect(newer).toBeEnabled();
  await expect(older).toBeEnabled();
  await expect(newer).toHaveAttribute('aria-keyshortcuts', 'ArrowUp K');
  await expect(older).toHaveAttribute('aria-keyshortcuts', 'ArrowDown J');

  await older.click();
  await expect(inspector).toContainText('Persist graph column preferences');
  await expect(page.locator('.commit-row.selected')).toContainText('Persist graph column preferences');
  await newer.click();
  await expect(inspector).toContainText('Refine graph lane rendering');
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

  const menu = page.locator('.context-menu[role="menu"]');
  await expect(menu).toBeVisible();
  expect(await menu.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
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
    .toBe('https://github.com/example/git-chronos/pulls');

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
      url: 'https://gitlab.com/example/platform/git-chronos/-/merge_requests',
    },
    {
      preview: 'bitbucket',
      section: 'Pull Requests',
      action: 'Open pull requests',
      detail: 'origin · Bitbucket',
      url: 'https://bitbucket.org/example/git-chronos/pull-requests',
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
    localStorage.getItem('git-chronos.sidebar.section.worktrees.height'),
  )).toBe('420');
  await expect(section).toHaveClass(/resized/);

  await splitter.dblclick();
  await expect.poll(() => page.evaluate(() =>
    localStorage.getItem('git-chronos.sidebar.section.worktrees.height'),
  )).toBeNull();
  await expect(section).not.toHaveClass(/resized/);
  await expect.poll(() => section.evaluate((element) => (element as HTMLElement).style.height)).toBe('');
});

test('navigates worktree and submodule action menus from the keyboard', async ({ page }) => {
  const worktreeActions = page.locator('.worktree-list-actions').nth(1);
  await expect(worktreeActions).toHaveAttribute('aria-haspopup', 'menu');
  await worktreeActions.click();
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

  await page.locator('.sidebar-heading').first().click({ button: 'right' });
  await page.getByRole('menu', { name: 'Left Panel panes' })
    .getByRole('menuitemcheckbox', { name: 'Submodules' })
    .click();
  await expect(page.getByRole('button', { name: 'Submodules 2' })).toHaveAttribute('aria-expanded', 'true');

  const submoduleActions = page.locator('.submodule-actions').first();
  await expect(submoduleActions).toHaveAttribute('aria-haspopup', 'menu');
  await submoduleActions.click();
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
  await expect(sidebar.getByRole('button', { name: 'Remote 1' })).toBeVisible();

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
  const visibility = row.getByRole('button', { name: 'Hide feature/partial-staging from graph' });

  await expect(branch.locator('button')).toHaveCount(0);
  await expect(visibility).toHaveCSS('opacity', '0');
  await visibility.focus();
  await expect(visibility).toBeFocused();
  await expect(visibility).toHaveCSS('opacity', '1');

  await visibility.press('Enter');
  await expect(branch).toHaveClass(/reference-hidden/);
  await expect(row.getByRole('button', { name: 'Show feature/partial-staging in graph' })).toBeFocused();
  await expect(page.locator('.wip-row.selected').first()).toBeVisible();
  await expect(branch).not.toHaveClass(/tip-selected/);
});

test('uses one roving Tab stop across WIP and commit graph rows', async ({ page }) => {
  const currentWip = page.locator('.wip-row').first();
  const linkedWip = page.locator('.wip-row').nth(1);

  await expect(page.locator('[data-graph-row][tabindex="0"]')).toHaveCount(1);
  await expect(currentWip).toHaveAttribute('tabindex', '0');
  await currentWip.focus();
  await currentWip.press('ArrowDown');
  await expect(linkedWip).toBeFocused();
  await expect(linkedWip).toHaveAttribute('tabindex', '0');
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
  await expect(signing).toContainText('Automatic signing enabled');
  await expect(signing).toContainText('SSH');
  await expect(signing).toContainText('~/.ssh/id_ed25519.pub');
  await signing.getByRole('button', { name: 'Check Signer' }).click();
  await expect(signing.locator('.signing-diagnostic')).toContainText('Signer available');
  await expect(signing.locator('.signing-diagnostic')).toContainText('ssh-keygen');
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

  await expect(close).toBeFocused();
  await close.press('Shift+Tab');
  await expect(preferences.getByRole('button', { name: 'Restore Defaults' })).toBeFocused();
  await preferences.getByRole('button', { name: 'Restore Defaults' }).press('Tab');
  await expect(close).toBeFocused();
  await close.press('Tab');
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
  const commitSummary = page.locator('.commit-form > input');
  const selectedCommit = page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"]');
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
  await expect.poll(() => page.evaluate(() => localStorage.getItem('git-chronos.ui.theme'))).toBe('midnight');

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
  const graphSettings = page.getByRole('dialog', { name: 'Graph layout and columns' });
  await expect(graphSettings).toHaveCSS('background-color', 'rgb(26, 36, 51)');
  await expect(graphSettings).toHaveCSS('border-color', 'rgb(69, 86, 111)');
  await page.keyboard.press('Escape');

  await page.locator('.wip-nav').click();
  await expect(fileToolbar).toHaveCSS('background-color', 'rgb(18, 27, 41)');
  await expect(fileFilter).toHaveCSS('background-color', 'rgb(12, 19, 30)');
  await expect(commitSummary).toHaveCSS('background-color', 'rgb(12, 19, 30)');

  await page.getByTitle('Open repository terminal (Alt+T)').click();
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
  const currentPath = '/home/maya/projects/git-chronos';
  const linkedPath = '/home/maya/projects/git-chronos-partial-staging';
  await page.evaluate(({ currentPath, linkedPath }) => {
    localStorage.setItem('git-chronos.recent-repositories.v1', JSON.stringify([currentPath, linkedPath]));
  }, { currentPath, linkedPath });
  await page.goto('/?worktree-tabs');

  await page.keyboard.press('Control+t');
  const manager = page.getByRole('dialog', { name: 'Repository management' });
  await manager.getByRole('button', { name: 'Add git-chronos-partial-staging to favorites' }).click();
  await expect(manager.getByText('Favorites')).toBeVisible();
  await expect(manager.getByRole('button', { name: /git-chronos-partial-staging/ }).first()).toContainText('Ctrl Alt 1');

  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Alt+1');
  await expect(page.locator('.repo-tab.active')).toContainText('git-chronos-partial-staging');

  await page.reload();
  await page.keyboard.press('Control+t');
  await expect(page.getByRole('dialog', { name: 'Repository management' }).getByText('Favorites')).toBeVisible();
});

test('reorders repository tabs with a persisted drag destination', async ({ page }) => {
  await page.goto('/?worktree-tabs');
  const tabs = page.locator('.repo-tab');
  await expect(tabs).toHaveCount(2);
  await expect(tabs.nth(0)).toContainText('git-chronos');
  await expect(tabs.nth(1)).toContainText('git-chronos-partial-staging');

  await tabs.nth(0).dragTo(tabs.nth(1));
  await expect(tabs.nth(0)).toContainText('git-chronos-partial-staging');
  await expect(tabs.nth(1)).toContainText('git-chronos');
  await expect.poll(() => page.evaluate(() => JSON.parse(
    localStorage.getItem('git-chronos.open-repositories.v1') ?? '[]',
  ))).toEqual([
    '/home/maya/projects/git-chronos-partial-staging',
    '/home/maya/projects/git-chronos',
  ]);
});

test('offers repository tab utilities and batch closing from the tab menu', async ({ page }) => {
  await page.goto('/?worktree-tabs');
  const tabs = page.locator('.repo-tab');
  await expect(tabs).toHaveCount(2);

  await tabs.first().click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Repository actions for git-chronos' });
  await expect(menu).toContainText('/home/maya/projects/git-chronos');
  await expect(menu.locator('.tab-context-heading small')).toHaveCSS('font-size', '12px');
  await expect(menu.locator('.tab-menu-action > small').first()).toHaveCSS('font-size', '12px');
  await expect(menu.getByRole('menuitem', { name: 'Open terminal' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Open in file manager' })).toBeVisible();
  const favorite = menu.getByRole('menuitemcheckbox', { name: 'Add to favorites' });
  await expect(favorite).toHaveAttribute('aria-checked', 'false');
  await favorite.click();
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Remove from favorites' })).toHaveAttribute('aria-checked', 'true');
  await expect(menu.getByRole('menuitem', { name: 'Close repositories to the right 1' })).toBeEnabled();

  await menu.getByRole('menuitem', { name: 'Close repositories to the right 1' }).click();
  await expect(tabs).toHaveCount(1);
  await expect(tabs.first()).toContainText('git-chronos');

  await page.keyboard.press('Control+Shift+T');
  await expect(tabs).toHaveCount(2);
  await tabs.nth(1).click({ button: 'right' });
  const linkedMenu = page.getByRole('menu', { name: 'Repository actions for git-chronos-partial-staging' });
  await linkedMenu.getByRole('menuitem', { name: 'Close other repositories 1' }).click();
  await expect(tabs).toHaveCount(1);
  await expect(tabs.first()).toContainText('git-chronos-partial-staging');
  await expect(tabs.first()).toHaveClass(/active/);
});

test('opens and navigates repository tab actions from the keyboard', async ({ page }) => {
  await page.goto('/?worktree-tabs');
  const tabButton = page.locator('.repo-tab').first().locator('.repo-tab-main');
  await tabButton.focus();
  await page.keyboard.press('Shift+F10');

  const menu = page.getByRole('menu', { name: 'Repository actions for git-chronos' });
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

test('switches repository tabs with standard tablist keys and restores focus after close', async ({ page }) => {
  await page.goto('/?worktree-tabs');
  const tablist = page.getByRole('tablist', { name: 'Open repositories' });
  const first = tablist.getByRole('tab', { name: /git-chronos/ }).first();
  const second = tablist.getByRole('tab', { name: /git-chronos-partial-staging/ });

  await expect(first).toHaveAttribute('aria-selected', 'true');
  await expect(first).toHaveAttribute('tabindex', '0');
  await expect(second).toHaveAttribute('tabindex', '-1');
  await first.focus();
  await first.press('ArrowRight');
  await expect(second).toBeFocused();
  await expect(second).toHaveAttribute('aria-selected', 'true');
  await expect(second).toHaveAttribute('tabindex', '0');
  await expect(first).toHaveAttribute('tabindex', '-1');

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

test('keeps the open-repositories menu inside compact windows', async ({ page }) => {
  await page.setViewportSize({ width: 780, height: 560 });
  await page.goto('/?worktree-tabs');
  await expect(page.locator('.app-shell')).toBeVisible();

  await page.getByRole('button', { name: 'Show all open repositories' }).click();
  const menu = page.getByRole('menu', { name: 'Open repositories' });
  await expect(menu).toBeVisible();
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

test('uses branch-aware labels for grouped worktree tabs at compact widths', async ({ page }) => {
  await page.setViewportSize({ width: 550, height: 700 });
  await page.goto('/?worktree-tabs');

  const tablist = page.getByRole('tablist', { name: 'Open repositories' });
  const main = tablist.getByRole('tab', { name: 'git-chronos, branch main' });
  const feature = tablist.getByRole('tab', { name: 'git-chronos-partial-staging, branch feature/partial-staging' });
  await expect(main).toBeVisible();
  await expect(feature).toBeVisible();
  await expect(main.locator('.repo-tab-full-label')).toBeHidden();
  await expect(feature.locator('.repo-tab-full-label')).toBeHidden();
  await expect(main.locator('.repo-tab-compact-label')).toHaveText('main');
  await expect(feature.locator('.repo-tab-compact-label')).toHaveText('feature/partial-staging');
  await expect(main.locator('.repo-tab-compact-label')).toBeVisible();
  await expect(feature.locator('.repo-tab-compact-label')).toBeVisible();
});

test('reopens the most recently closed repository tab', async ({ page }) => {
  await page.goto('/?worktree-tabs');
  const tabs = page.locator('.repo-tab');
  await expect(tabs).toHaveCount(2);

  await tabs.nth(1).getByRole('button', { name: /Close/ }).click();
  await expect(tabs).toHaveCount(1);

  await page.keyboard.press('Control+Shift+T');
  await expect(tabs).toHaveCount(2);
  await expect(page.locator('.repo-tab.active')).toContainText('git-chronos-partial-staging');

  await page.locator('.repo-tab.active').getByRole('button', { name: /Close/ }).click();
  await tabs.first().getByRole('button', { name: /Close/ }).click();
  const reopenFromWelcome = page.getByRole('button', { name: 'Reopen git-chronos' });
  await expect(reopenFromWelcome).toBeVisible();
  await reopenFromWelcome.click();
  await expect(page.locator('.repo-tab.active')).toContainText('git-chronos');

  await page.keyboard.press('Control+Shift+T');
  await expect(tabs).toHaveCount(2);
  await expect(page.locator('.repo-tab.active')).toContainText('git-chronos-partial-staging');
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
  await page.getByRole('menuitem', { name: /Prune old LFS objects/ }).click();
  const pruneConfirmation = page.getByRole('alertdialog', { name: 'Remove old local objects?' });
  const pruneCancel = pruneConfirmation.getByRole('button', { name: 'Cancel' });
  const pruneConfirm = pruneConfirmation.getByRole('button', { name: 'Prune Objects' });
  await expect(pruneConfirmation).toContainText('git lfs prune');
  await expect(pruneCancel).toBeFocused();
  await pruneCancel.press('Shift+Tab');
  await expect(pruneConfirm).toBeFocused();
  await pruneConfirm.press('Tab');
  await expect(pruneCancel).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(pruneConfirmation).toHaveCount(0);
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
  await expect(editDialog.getByLabel('Fetch URL')).toHaveValue('git@github.com:example/git-chronos.git');
  await expect(editDialog.getByLabel('Fetch URL')).toBeFocused();
  await expect(editDialog).toContainText('Push currently uses git@github.com:example/git-chronos.git.');

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

test('starts with author and date metadata and persists the optional SHA column', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('.graph-columns')).toContainText('AUTHOR');
  await expect(page.locator('.graph-columns')).toContainText('DATE / TIME');
  await expect(page.locator('.graph-columns')).not.toContainText('SHA');
  await page.getByRole('button', { name: 'Configure graph columns' }).click();
  let settings = page.getByRole('dialog', { name: 'Graph layout and columns' });
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
  settings = page.getByRole('dialog', { name: 'Graph layout and columns' });
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
  const settings = page.getByRole('dialog', { name: 'Graph layout and columns' });
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
  const settings = page.getByRole('dialog', { name: 'Graph layout and columns' });
  await expect(settingsButton).toHaveAttribute('aria-expanded', 'true');
  await expect(settings).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await expect(settingsButton).toHaveAttribute('aria-expanded', 'false');
  await expect(settingsButton).toBeFocused();

  await header.getByText('GRAPH', { exact: true }).click({ button: 'right' });
  await expect(settings).toBeVisible();
  await expect(settings).toBeFocused();
  await expect(settings).toContainText('Graph columns');
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
});

test('restores graph layout defaults without resetting unrelated preferences', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Configure graph columns' }).click();
  const settings = page.getByRole('dialog', { name: 'Graph layout and columns' });
  await settings.getByLabel('Compact Graph Column').check();
  await settings.getByLabel('Scroll Markers').uncheck();
  await settings.getByLabel('Date / Time').uncheck();
  await expect(page.locator('.graph-columns')).not.toContainText('DATE / TIME');

  await settings.getByRole('button', { name: 'Restore graph defaults' }).click();
  await expect(settings.getByLabel('Compact Graph Column')).not.toBeChecked();
  await expect(settings.getByLabel('Scroll Markers')).toBeChecked();
  await expect(settings.getByLabel('Author')).toBeChecked();
  await expect(settings.getByLabel('Date / Time')).toBeChecked();
  await expect(settings.getByLabel('SHA')).not.toBeChecked();
  await expect(page.locator('.graph-columns')).toContainText('DATE / TIME');
  await expect(settings).toContainText('Drag column headers to reorder them.');
  await expect.poll(() => page.evaluate(() => ({
    compact: localStorage.getItem('git-chronos.graph.%2Fhome%2Fmaya%2Fprojects%2Fgit-chronos.column.graph.compact'),
    date: localStorage.getItem('git-chronos.graph.%2Fhome%2Fmaya%2Fprojects%2Fgit-chronos.column.date.visible'),
    markers: localStorage.getItem('git-chronos.graph.%2Fhome%2Fmaya%2Fprojects%2Fgit-chronos.scroll-markers'),
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
  await expect(branchSeparator).toHaveAttribute('aria-valuenow', '150');
  expect((await branchSeparator.boundingBox())!.width).toBeGreaterThanOrEqual(12);
  await branchSeparator.focus();
  expect(await branchSeparator.evaluate((element) => getComputedStyle(element, '::after').width)).toBe('3px');
  await page.keyboard.press('ArrowRight');
  await expect(branchSeparator).toHaveAttribute('aria-valuenow', '158');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(branchSeparator).toHaveAttribute('aria-valuenow', '190');
  await page.keyboard.press('Home');
  await expect(branchSeparator).toHaveAttribute('aria-valuenow', '75');
  await page.keyboard.press('End');
  await expect(branchSeparator).toHaveAttribute('aria-valuenow', '800');
  await branchSeparator.dblclick();
  await expect(branchSeparator).toHaveAttribute('aria-valuenow', '150');
  await expect.poll(() => page.evaluate(() => {
    const key = Object.keys(localStorage).find((candidate) => candidate.endsWith('.column.branch.width'));
    return key ? localStorage.getItem(key) : null;
  })).toBe('150');

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
      return Math.abs(header.x + header.width - button.x - button.width - 14);
    }).toBeLessThanOrEqual(1);
  };
  await expectSettingsPinnedRight();
  await expect(messageSeparator).toHaveAttribute('aria-valuemin', '180');
  await expect(messageSeparator).toHaveAttribute('aria-valuemax', '2400');
  const initialMessageWidth = (await messageWidth());
  await expect(messageSeparator).toHaveAttribute('aria-valuenow', String(initialMessageWidth));

  // As the last column, Commit Message resizes from its left edge, so the direction is mirrored.
  const leading = await messageSeparator.evaluate((separator) => separator.classList.contains('leading-edge'));
  const direction = leading ? -1 : 1;
  await messageSeparator.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(messageSeparator).toHaveAttribute('aria-valuenow', String(initialMessageWidth - 8 * direction));
  expect((await messageWidth())).toBe(initialMessageWidth - 8 * direction);
  await page.keyboard.press('Home');
  await expect(messageSeparator).toHaveAttribute('aria-valuenow', '180');
  expect((await messageWidth())).toBe(180);
  await expectSettingsPinnedRight();
  await page.keyboard.press('End');
  if (leading) {
    // A left-edge splitter can only take what the column before it can give up.
    await expect.poll(async () => Number(await messageSeparator.getAttribute('aria-valuenow'))).toBeGreaterThan(180);
    expect(await messageWidth()).toBe(Number(await messageSeparator.getAttribute('aria-valuenow')));
  } else {
    await expect(messageSeparator).toHaveAttribute('aria-valuenow', '2400');
    expect((await messageWidth())).toBe(2400);
  }
  await expectSettingsPinnedRight();
  await page.keyboard.press('Home');
  await expect(messageSeparator).toHaveAttribute('aria-valuenow', '180');

  const handle = await messageSeparator.boundingBox();
  expect(handle).not.toBeNull();
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle!.x + handle!.width / 2 + 40 * direction, handle!.y + handle!.height / 2);
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

test('resizes the date column from its left edge while its right edge stays fixed', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto('/');
  const separator = page.getByRole('separator', { name: 'Resize Date and Time column' });
  const date = page.locator('.graph-columns .draggable-column').filter({ has: separator });
  const author = page.locator('.author-column-heading');
  const message = page.locator('.message-column-heading');
  await expect(separator).toHaveClass(/leading-edge/);
  const box = async (locator: typeof date) => (await locator.boundingBox())!;
  const right = async () => { const b = await box(date); return b.x + b.width; };
  const initialRight = await right();
  const initialAuthor = (await box(author)).width;
  const messageWidth = (await box(message)).width;
  const handle = await box(separator);
  expect(Math.abs(handle.x + handle.width / 2 - (await box(date)).x)).toBeLessThanOrEqual(1);
  const drag = async (delta: number) => {
    const current = await box(separator);
    const x = current.x + current.width / 2;
    const y = current.y + current.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + delta, y, { steps: 4 });
    await page.mouse.up();
  };
  const expectRightFixed = async () => expect(Math.abs(await right() - initialRight)).toBeLessThanOrEqual(1);

  await expect(separator).toHaveAttribute('aria-valuenow', '100');
  await expect(date.locator('.column-heading-label')).toBeVisible();
  await expect(date.locator('.column-heading-icon')).toHaveCount(0);
  await drag(-24);
  await expect(separator).toHaveAttribute('aria-valuenow', '124');
  expect(Math.round((await box(author)).width)).toBe(Math.round(initialAuthor) - 24);
  await expectRightFixed();
  expect(Math.abs((await box(message)).width - messageWidth)).toBeLessThanOrEqual(1);

  // Narrowing stops at the width needed by the rendered dates and times.
  const minimum = Number(await separator.getAttribute('aria-valuemin'));
  expect(minimum).toBeGreaterThan(40);
  expect(minimum).toBeLessThan(100);
  await drag(48);
  await expect(separator).toHaveAttribute('aria-valuenow', String(minimum));
  expect(Math.round((await box(author)).width)).toBe(Math.round(initialAuthor) + 100 - minimum);
  await expectRightFixed();

  await expect(date).toHaveAttribute('title', 'Date / Time');
  await page.reload();
  await expect(separator).toHaveAttribute('aria-valuenow', String(minimum));
  await expectRightFixed();

  await separator.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(separator).toHaveAttribute('aria-valuenow', String(minimum + 8));
  await expectRightFixed();
  await page.keyboard.press('Shift+ArrowRight');
  await expect(separator).toHaveAttribute('aria-valuenow', String(minimum));
  await expectRightFixed();
  await page.keyboard.press('ArrowRight');
  await expect(separator).toHaveAttribute('aria-valuenow', String(minimum));
  await expectRightFixed();

  await separator.dblclick();
  await expect(separator).toHaveAttribute('aria-valuenow', '100');
  expect(Math.round((await box(author)).width)).toBe(Math.round(initialAuthor));
  await expectRightFixed();

  // Space freed before Date / Time is filled by it, so its right edge stays at the panel edge.
  await page.getByRole('separator', { name: 'Resize Author column', exact: true }).focus();
  await page.keyboard.press('Home');
  await expect.poll(async () => Number(await separator.getAttribute('aria-valuenow'))).toBeGreaterThan(100);
  const filled = Number(await separator.getAttribute('aria-valuenow'));
  expect(Math.round((await box(date)).width)).toBe(filled + 26);
  await expectRightFixed();
  // The neighbor's minimum width limits how far the left edge can move.
  await separator.focus();
  await page.keyboard.press('End');
  await expect(separator).toHaveAttribute('aria-valuenow', String(filled));
  await expectRightFixed();
  // The filled width is real: dragging the left edge right narrows Date / Time at once.
  await drag(40);
  await expect(separator).toHaveAttribute('aria-valuenow', String(filled - 40));
  await expectRightFixed();
  await page.keyboard.press('Home');
  await expect(separator).toHaveAttribute('aria-valuenow', String(minimum));
  await expectRightFixed();
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
    'Resize Author column', 'Resize SHA column',
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
    // Leave Date / Time and the last column (SHA) room to give up width to the splitter before them.
    for (const name of ['Resize SHA column', 'Resize Date and Time column']) {
      await page.getByRole('separator', { name, exact: true }).focus();
      await page.keyboard.press('Shift+ArrowLeft');
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
      // Date / Time and the last column resize from a left-edge splitter that keeps their right edge fixed.
      const leadingEdges = await page.locator('.graph-columns > .draggable-column').evaluateAll((columns) =>
        columns.map((column) => column.querySelector('.column-resizer.leading-edge') !== null),
      );
      const leading = leadingEdges[columnIndex];
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
      // Dragging a leading-edge splitter right moves the column's left edge, narrowing it.
      expect(Math.round(after.width), label).toBe(Math.round(before.width) + (leading ? -16 : 16));
      const scrollAfter = await page.locator('.graph-columns').evaluate((header) => header.scrollLeft);
      // Columns are never pinned, so every other column keeps its left edge in the scrolled content.
      expect(Math.abs(after.x + scrollAfter - before.x - scrollBefore - (leading ? 16 : 0)), label).toBeLessThanOrEqual(1);
      const newWidths = await page.locator('.graph-columns > .draggable-column').evaluateAll((columns) =>
        columns.map((column) => Math.round(column.getBoundingClientRect().width)),
      );
      expect(newWidths).toEqual(leading
        ? widths.map((width, index) => width + (index === columnIndex ? -16 : index === columnIndex - 1 ? 16 : 0))
        : widths.map((width, index) =>
          width + (index === columnIndex ? 16 : 0) - (index === columnIndex + 1 && leadingEdges[index] ? 16 : 0)));
      await separator.focus();
      await page.keyboard.press('ArrowLeft');
      // Left widens a leading-edge column and narrows any other.
      expect(Math.round((await heading.boundingBox())!.width)).toBe(Math.round(before.width) + (leading ? -8 : 8));
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
  const leftPanel = page.locator('#repository-reference-panel');
  const leftSplitter = page.getByRole('separator', { name: 'Resize left panel' });
  await expect(leftSplitter).toHaveAttribute('aria-controls', 'repository-reference-panel');
  await expect(leftSplitter).toHaveAttribute('aria-orientation', 'vertical');
  await expect(leftSplitter).toHaveAttribute('aria-valuemin', '170');
  await expect(leftSplitter).toHaveAttribute('aria-valuemax', '420');
  await expect(leftSplitter).toHaveAttribute('aria-valuenow', '250');
  expect((await leftSplitter.boundingBox())!.width).toBeGreaterThanOrEqual(12);
  await leftSplitter.focus();
  expect(await leftSplitter.evaluate((element) => getComputedStyle(element, '::after').width)).toBe('3px');
  await page.keyboard.press('ArrowRight');
  await expect(leftSplitter).toHaveAttribute('aria-valuenow', '260');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(leftSplitter).toHaveAttribute('aria-valuenow', '292');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('git-chronos.panel.sidebar.width'))).toBe('292');
  await page.keyboard.press('Home');
  await expect(leftSplitter).toHaveAttribute('aria-valuenow', '170');
  await page.keyboard.press('End');
  await expect(leftSplitter).toHaveAttribute('aria-valuenow', '420');
  await leftSplitter.dblclick();
  await expect(leftSplitter).toHaveAttribute('aria-valuenow', '250');
  await expect.poll(() => leftPanel.evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(250);

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
  await expect.poll(() => page.evaluate(() => localStorage.getItem('git-chronos.panel.details.width'))).toBe('355');
  await expect.poll(() => commitPanel.evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(355);
});

test('resizes and restores the repository terminal with an accessible splitter', async ({ page }) => {
  const openTerminal = page.getByTitle('Open repository terminal (Alt+T)');
  await expect(openTerminal).toHaveAttribute('aria-pressed', 'false');
  await openTerminal.click();

  let panel = page.getByLabel('Repository terminals');
  let splitter = page.getByRole('separator', { name: 'Resize terminal' });
  await expect(panel).toBeVisible();
  await expect(page.getByTitle('Hide repository terminal (Alt+T)')).toHaveAttribute('aria-pressed', 'true');
  const panelId = await panel.getAttribute('id');
  expect(panelId).toMatch(/^repository-terminal-panel-/);
  await expect(splitter).toHaveAttribute('aria-controls', panelId!);
  await expect(splitter).toHaveAttribute('aria-orientation', 'horizontal');
  await expect(splitter).toHaveAttribute('aria-valuemin', '150');
  expect((await splitter.boundingBox())!.height).toBeGreaterThanOrEqual(12);
  await expect(panel.getByRole('button', { name: 'New terminal tab' })).toHaveAttribute('aria-keyshortcuts', 'Control+Shift+T');
  await expect(panel.getByRole('button', { name: 'Hide terminal panel' })).toBeVisible();
  const minimizeTerminal = panel.getByRole('button', { name: 'Minimize terminal' });
  await expect(minimizeTerminal).toHaveAttribute('aria-expanded', 'true');
  await expect(minimizeTerminal).toHaveAttribute('aria-controls', `${panelId}-body`);
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
    localStorage.getItem('git-chronos.terminal.panel-height'),
  )).toBe('192');
  await expect.poll(() => panel.evaluate((element) => Math.round(element.getBoundingClientRect().height))).toBe(192);

  await page.reload();
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.getByTitle('Open repository terminal (Alt+T)').click();
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
    localStorage.getItem('git-chronos.terminal.panel-height'),
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
  await page.getByTitle('Open repository terminal (Alt+T)').click();
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
});

test('keeps graph headers aligned while wide histories scroll horizontally', async ({ page }) => {
  await page.getByRole('button', { name: 'Configure graph columns' }).click();
  const settings = page.locator('.column-settings');
  await settings.getByLabel('Author').check();
  await settings.getByLabel('SHA').check();
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
  const [headerBoxAfterScroll, settingsBoxAfterScroll] = await Promise.all([
    header.boundingBox(),
    settingsButton.boundingBox(),
  ]);
  expect(headerBoxAfterScroll).not.toBeNull();
  expect(settingsBoxAfterScroll).not.toBeNull();
  expect(Math.abs(settingsBoxAfterScroll!.x + settingsBoxAfterScroll!.width -
    (headerBoxAfterScroll!.x + headerBoxAfterScroll!.width - 14))).toBeLessThanOrEqual(1);
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
  const settingsBoxAtEnd = (await settingsButton.boundingBox())!;
  expect(Math.abs(settingsBoxAtEnd.x - settingsBoxAfterScroll!.x)).toBeLessThanOrEqual(1);
  await settingsButton.focus();
  await page.keyboard.press('Enter');
  await expect(settings).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settingsButton).toBeFocused();
});

test('keeps compact history controls clear of the commit inspector', async ({ page }) => {
  for (const width of [760, 661]) {
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
      (historyBox!.x + historyBox!.width - 14))).toBeLessThanOrEqual(1);

    await settingsButton.click();
    await expect(page.getByRole('dialog', { name: 'Graph layout and columns' })).toBeVisible();
  }
});

test('uses a full-width inspector drawer in ultra-narrow windows', async ({ page }) => {
  for (const width of [660, 550, 420]) {
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
    await expect(page.getByRole('dialog', { name: 'Graph layout and columns' })).toBeVisible();
  }
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
  await expect(graphHeading).toHaveCSS('width', '70px');
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
  await expect(graphHeading).toHaveCSS('width', '70px');
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
  await page.getByLabel('Date / Time').check();
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
  await expect(date.locator('span')).toHaveText(/ago|yesterday|today|tomorrow|in /i);
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
  await expect(page.getByTitle('Command palette (Ctrl+P)')).toHaveAttribute('aria-keyshortcuts', 'Control+P Meta+P');
  await expect(page.getByTitle('Hide Left Panel (Ctrl+J)')).toHaveAttribute('aria-keyshortcuts', 'Control+J Meta+J');
  await expect(page.getByTitle('Open repository terminal (Alt+T)')).toHaveAttribute('aria-keyshortcuts', 'Alt+T');
  await expect(page.getByTitle('Hide Commit Panel (Ctrl+K)')).toHaveAttribute('aria-keyshortcuts', 'Control+K Meta+K');
  await expect(page.getByRole('button', { name: 'Decrease zoom' })).toHaveAttribute('title', 'Decrease zoom (Ctrl+-)');
  await expect(page.getByRole('button', { name: 'Increase zoom' })).toHaveAttribute('title', 'Increase zoom (Ctrl++)');
  await expect(page.getByRole('button', { name: 'Reset zoom to 100 percent' })).toHaveAttribute('title', 'Reset zoom to 100% (Ctrl+0)');
  await expect(page.locator('.graph-search kbd')).toHaveText('Ctrl F');

  await page.getByTitle('Show all open repositories').click();
  const repositoryTabsMenu = page.getByRole('menu', { name: 'Open repositories' });
  const activeRepositoryItem = repositoryTabsMenu.getByRole('menuitemradio', { name: /git-chronos/ });
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
  await expect(palette.locator('.palette-search kbd')).toBeHidden();
  await expect(palette.locator('.palette-footer span').nth(1)).toBeHidden();

  const selectedAction = palette.locator('[role="option"][aria-selected="true"]');
  await expect(selectedAction).toBeEnabled();
  const disabledAction = palette.getByRole('option', { name: /Switch to Default/ });
  await expect(disabledAction).toBeDisabled();
  const selectedId = await selectedAction.getAttribute('id');
  await disabledAction.hover();
  await expect(search).toHaveAttribute('aria-activedescendant', selectedId!);

  await search.press('Shift+Tab');
  const lastEnabledOption = palette.locator('[role="option"]:not(:disabled)').last();
  await expect(lastEnabledOption).toBeFocused();
  await lastEnabledOption.press('Tab');
  await expect(search).toBeFocused();
  await search.press('Tab');
  await expect(close).toBeFocused();
  await close.press('Tab');
  await expect(palette.locator('[role="option"]:not(:disabled)').first()).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();
  await expect(opener).toBeFocused();

  await page.keyboard.press('Control+P');
  await palette.getByRole('combobox', { name: 'Search commands' }).fill('preferences');
  await palette.getByRole('option', { name: /^Open Preferences/ }).click();
  const preferences = page.getByRole('dialog', { name: 'Preferences' });
  await expect(preferences.getByRole('button', { name: 'Close preferences' })).toBeFocused();
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
  await toggle.click();

  const menu = page.getByRole('menu', { name: 'Git Chronos menu' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Manage Repositories/ })).toBeVisible();
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
  await page.keyboard.press('Escape');
  await expect(preferences).toBeHidden();
  await expect(toggle).toBeFocused();

  await toggle.click();
  await menu.getByRole('menuitem', { name: /Keyboard Shortcuts/ }).click();
  const shortcuts = page.getByRole('dialog', { name: 'Keyboard Shortcuts' });
  await expect(shortcuts.getByRole('button', { name: 'Close keyboard shortcuts' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(shortcuts).toBeHidden();
  await expect(toggle).toBeFocused();

  await toggle.click();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeFocused();
});

test('finds and safely preserves commits from recovery history', async ({ page }) => {
  await page.getByRole('button', { name: 'Main menu' }).click();
  await page.getByRole('menu', { name: 'Git Chronos menu' }).getByRole('menuitem', { name: /Recovery History/ }).click();

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
    visibleRight: (() => { const list = document.querySelector('.commit-list')!; return list.getBoundingClientRect().left + list.clientWidth; })(),
  }));
  // Author's right edge is the Date / Time splitter; widening Author scrolls it into view.
  await list.evaluate((element) => { element.scrollLeft = 0; });
  await page.getByRole('separator', { name: 'Resize Date and Time column', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => { const { authorRight, dateLeft, visibleRight } = await edges(); return Math.abs(authorRight - dateLeft) <= 1 && authorRight <= visibleRight; }).toBe(true);
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
  const settings = page.getByRole('dialog', { name: 'Graph layout and columns' });
  const toggle = settings.getByLabel('Horizontal Scrolling');
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('git-chronos.graph.horizontal-scroll'))).toBe('false');
  await expectGraphColumnsFit(page);

  // End on Commit Message takes every other column's spare width, but no more.
  const message = page.getByRole('separator', { name: 'Resize Commit Message column', exact: true });
  await message.focus();
  await page.keyboard.press('End');
  await expectGraphColumnsFit(page);
  const messageMaximum = Number(await message.getAttribute('aria-valuemax'));
  expect(messageMaximum).toBeLessThan(2400);
  await expect(message).toHaveAttribute('aria-valuenow', String(messageMaximum));
  for (const { name, now, min } of (await graphColumnFit(page)).separators) {
    if (name !== 'Resize Commit Message column') expect(now, name).toBe(min);
  }
  await page.keyboard.press('Home');
  await expect(message).toHaveAttribute('aria-valuenow', '180');
  await expectGraphColumnsFit(page);

  // Widening Branch narrows Commit Message first; dragging back within the same drag restores it.
  const branchName = 'Resize Branch and Tag column';
  const authorName = 'Resize Author column';
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) if (key.includes('.column.') && key.endsWith('.width')) localStorage.removeItem(key);
  });
  await page.reload();
  await expect(page.getByRole('separator', { name: branchName, exact: true })).toHaveAttribute('aria-valuenow', '150');
  const startMessage = await separatorWidth(page, 'Resize Commit Message column');
  const startAuthor = await separatorWidth(page, authorName);
  const handle = (await page.getByRole('separator', { name: branchName, exact: true }).boundingBox())!;
  const y = handle.y + handle.height / 2;
  await page.mouse.move(handle.x + handle.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 120, y, { steps: 4 });
  await expect.poll(() => separatorWidth(page, branchName)).toBe(270);
  await expect.poll(() => separatorWidth(page, 'Resize Commit Message column')).toBeLessThan(startMessage);
  expect(await separatorWidth(page, authorName)).toBe(startAuthor);
  await expectGraphColumnsFit(page);
  await page.mouse.move(handle.x + handle.width / 2 + 700, y, { steps: 6 });
  await expectGraphColumnsFit(page);
  expect(await separatorWidth(page, 'Resize Commit Message column')).toBe(180);
  expect(await separatorWidth(page, authorName)).toBeLessThan(startAuthor);
  await page.mouse.move(handle.x + handle.width / 2, y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => separatorWidth(page, branchName)).toBe(150);
  expect(await separatorWidth(page, 'Resize Commit Message column')).toBe(startMessage);
  expect(await separatorWidth(page, authorName)).toBe(startAuthor);

  // The Date / Time left edge still trades width with Author without overflowing.
  const date = page.getByRole('separator', { name: 'Resize Date and Time column', exact: true });
  const startDate = Number(await date.getAttribute('aria-valuenow'));
  await date.focus();
  await page.keyboard.press('Shift+ArrowLeft');
  await expect.poll(() => separatorWidth(page, 'Resize Date and Time column')).toBe(startDate + 32);
  expect(await separatorWidth(page, authorName)).toBe(startAuthor - 32);
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
  await expect.poll(() => page.evaluate(() => localStorage.getItem('git-chronos.graph.horizontal-scroll'))).toBe('true');
  await message.focus();
  await page.keyboard.press('End');
  await expect(message).toHaveAttribute('aria-valuenow', '2400');
  await expect.poll(async () => (await graphColumnFit(page)).overflow).toBeGreaterThan(100);
});

test('keeps fitted graph columns inside the panel when paths are fitted or columns shown', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Configure graph columns' }).click();
  const settings = page.getByRole('dialog', { name: 'Graph layout and columns' });
  await settings.getByLabel('Horizontal Scrolling').uncheck();
  await settings.getByLabel('SHA').check();
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
  await expect.poll(() => page.evaluate(() => localStorage.getItem('git-chronos.graph.horizontal-scroll'))).toBeNull();
});

test('searches and applies the graph author filter', async ({ page }) => {
  await page.getByRole('button', { name: 'Configure graph columns' }).click();
  await page.locator('.column-settings').getByLabel('Author').check();

  const filterButton = page.getByRole('button', { name: 'Filter commits by author' });
  const filterTarget = await filterButton.boundingBox();
  expect(filterTarget?.width).toBeGreaterThanOrEqual(24);
  expect(filterTarget?.height).toBeGreaterThanOrEqual(24);
  await filterButton.click();
  const authorSearch = page.getByRole('searchbox', { name: 'Search authors' });
  await expect(authorSearch).toBeFocused();
  await expect(page.getByRole('dialog', { name: 'Author filter' })).toContainText('All authors');
  // The whole menu is on top: it is not clipped by the column header, so every option is clickable.
  const authorMenu = page.getByRole('dialog', { name: 'Author filter' });
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
  await page.locator('.column-settings').getByLabel('Author').check();

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
  await expect(menu.getByLabel('Create branch here')).toBeVisible();
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

  await source.dragTo(target);
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
  await expect(cancel).toBeFocused();
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
    clientY: 700,
  })));
  const menu = page.locator('.context-menu[role="menu"]').filter({ hasText: 'v0.1.0' });
  await expect(menu).toBeVisible();
  await expect.poll(async () => (await menu.boundingBox())?.y).toBe(700);

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
  }).toEqual({ right: 992, bottom: 992 });
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
  await expect(preview).toContainText('First Git Chronos preview release');
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
  await expect(menu.getByRole('menuitem', { name: 'Create local tracking branch' })).toBeFocused();
  await expect(menu.getByRole('menuitem', { name: 'Copy remote branch name' })).toBeVisible();
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
  await branchToggle.click();
  const picker = page.locator('.branch-nav-menu');
  const search = picker.getByRole('searchbox', { name: 'Filter branches' });
  await expect(search).toBeVisible();
  await expect(search).toBeFocused();
  await expect(picker.getByText('Local branches', { exact: true })).toBeVisible();
  await expect(picker.getByText('Remote branches', { exact: true })).toBeVisible();
  await expect(picker.getByRole('button', { name: /main Current branch · ahead 1/ })).toBeVisible();

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
  const currentBranch = picker.getByRole('button', { name: /main Current branch · ahead 1/ });
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
});

test('selects and persists the remote used for pull and push', async ({ page }) => {
  let remoteToggle = page.getByRole('button', { name: 'Select remote, current origin' });
  await remoteToggle.click();
  let picker = page.getByRole('menu', { name: 'Select remote for pull and push' });
  const origin = picker.getByRole('menuitemradio', { name: /origin/ });
  const upstream = picker.getByRole('menuitemradio', { name: /upstream/ });

  await expect(origin).toBeFocused();
  await expect(origin).toHaveAttribute('aria-checked', 'true');
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
  await expect(picker.getByRole('menuitemradio', { name: /upstream/ })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await expect(remoteToggle).toBeFocused();
});

test('switches complete repository tab sets with persistent workspaces', async ({ page }) => {
  let workspaceToggle = page.getByRole('button', { name: 'Workspace: Default' });
  await workspaceToggle.click();
  let menu = page.getByRole('menu', { name: 'Workspaces' });
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
  await expect(palette.locator('.palette-group-heading').filter({ hasText: 'Workspace' })).toBeVisible();
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
  await expect(palette.locator('.palette-group-heading').filter({ hasText: 'Repository' })).toHaveCount(1);
  await expect(palette.locator('.palette-action-copy small')).toHaveCount(0);

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
  const search = page.getByRole('combobox', { name: 'Search tracked files' });
  await expect(search).toBeFocused();
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
  await history.click();

  const viewer = page.getByLabel('Diff viewer');
  await expect(viewer).toBeVisible();
  await expect(viewer).toContainText('apps/desktop/src/app/app.component.ts');
  await expect(page.getByLabel('File history')).toBeVisible();
  await expect(page.getByLabel('File history').locator('.history-entry')).not.toHaveCount(0);
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
  const search = page.getByLabel('Search commits by message, SHA, or author');
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
  // Targets fill the 12px rail gutter (clear of row actions) and stay 24px tall.
  expect(markerTargets.every(({ targetWidth, targetHeight }) => targetWidth >= 12 && targetHeight >= 24)).toBe(true);
  expect(markerTargets.every(({ visualWidth }) => visualWidth <= 11)).toBe(true);

  const search = page.getByLabel('Search commits by message, SHA, or author');
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

  await panel.locator('.commit-file').filter({ hasText: 'app.component.html' }).click();
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
  const newTab = page.locator('.new-tab');
  await newTab.click();

  const dialog = page.getByRole('dialog', { name: 'Repository management' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Sample-data preview')).toBeVisible();
  await expect(dialog.getByText('task dev')).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Open a repository/ })).toBeDisabled();

  const browseTab = dialog.getByRole('tab', { name: 'Browse' });
  const cloneTab = dialog.getByRole('tab', { name: 'Clone' });
  const initTab = dialog.getByRole('tab', { name: 'Init' });
  await expect(browseTab).toHaveAttribute('aria-selected', 'true');
  await expect(browseTab).toBeFocused();
  await browseTab.press('ArrowRight');
  await expect(cloneTab).toBeFocused();
  await expect(cloneTab).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByRole('heading', { name: 'Clone a Repository' })).toBeVisible();
  await cloneTab.press('End');
  await expect(initTab).toBeFocused();
  await expect(initTab).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByRole('heading', { name: 'Initialize a Repository' })).toBeVisible();
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
    'git-chronos.favorite-repositories.v1',
    JSON.stringify(Array.from({ length: 24 }, (_, index) => `/home/maya/projects/favorite-${index + 1}`)),
  ));
  await page.reload();
  await expect(page.locator('.app-shell')).toBeVisible();
  await page.locator('.new-tab').click();

  const dialog = page.getByRole('dialog', { name: 'Repository management' });
  const header = dialog.locator('.repository-dialog-header');
  const tabs = dialog.getByRole('tablist', { name: 'Repository actions' });
  const [headerBefore, tabsBefore] = await Promise.all([header.boundingBox(), tabs.boundingBox()]);
  expect(headerBefore).not.toBeNull();
  expect(tabsBefore).not.toBeNull();
  expect(await dialog.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);

  await dialog.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect.poll(() => dialog.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const [headerAfter, tabsAfter] = await Promise.all([header.boundingBox(), tabs.boundingBox()]);
  expect(headerAfter).not.toBeNull();
  expect(tabsAfter).not.toBeNull();
  expect(Math.abs(headerAfter!.y - headerBefore!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(tabsAfter!.y - tabsBefore!.y)).toBeLessThanOrEqual(1);
  await expect(dialog.getByRole('button', { name: 'Close repository management' })).toBeVisible();
  await expect(dialog.getByRole('tab', { name: 'Browse' })).toBeVisible();
});

test('navigates activity scopes as a familiar tab strip', async ({ page }) => {
  const notificationButton = page.getByRole('button', { name: 'Activity notifications' });
  await notificationButton.click();
  const drawer = page.getByRole('region', { name: 'Activity logs' });
  const applicationTab = drawer.getByRole('tab', { name: 'Application' });
  const repositoryTab = drawer.getByRole('tab', { name: 'Repository' });

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

test('opens commit details, tree files, and the focused diff through normal clicks', async ({ page }) => {
  await page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"]').click();

  const commitPanel = page.locator('.commit-panel');
  await expect(commitPanel).toContainText('Polish repository activity drawer');
  await expect(commitPanel.locator('.commit-detail-refs .current-ref')).toBeVisible();
  await expect(commitPanel.locator('.commit-detail-refs .current-ref')).toHaveClass(/lane-color-0/);
  const signature = commitPanel.getByLabel('Verified signature');
  await expect(signature).toBeVisible();
  await expect(signature).toContainText('Maya Chen <maya@example.test>');
  await expect(signature).toContainText('A1B2C3D4E5F60718');
  await expect(commitPanel.getByText('Changed Files (3)')).toBeVisible();
  await expect(commitPanel.locator('.file-change-summary')).toHaveAttribute('aria-label', '52 additions and 13 deletions');
  await expect(commitPanel.locator('.file-line-stats').first()).toHaveText('+16−5');
  const quickActions = commitPanel.getByRole('navigation', { name: 'Selected commit actions' });
  await expect(quickActions.getByRole('button', { name: 'Compare WIP' })).toBeVisible();
  await expect(quickActions.getByRole('button', { name: 'Cherry-pick' })).toBeVisible();
  await expect(commitPanel.getByRole('button', { name: 'More commit actions' })).toBeVisible();
  await expect(commitPanel.getByRole('button', { name: 'Commit actions', exact: true })).toHaveCount(0);
  const cherryPick = quickActions.getByRole('button', { name: 'Cherry-pick' });
  await cherryPick.click();
  const historyConfirmation = page.getByRole('alertdialog');
  await expect(historyConfirmation).toContainText('Apply this commit’s changes');
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
  const graphAuthorColor = await page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"] .author-node').evaluate((node) => getComputedStyle(node).backgroundColor);
  await expect(commitPanel.locator('.author-card .large-avatar').first()).toHaveCSS('background-color', graphAuthorColor);

  const currentBranchReference = references.locator('.ref-pill.head');
  await expect(currentBranchReference.locator('.ref-sync')).toHaveText('↑1');
  await currentBranchReference.click({ button: 'right' });
  const branchMenu = page.getByRole('menu').filter({ hasText: 'main' });
  await expect(branchMenu.getByRole('menuitem', { name: 'Checkout branch' })).toBeVisible();
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
  const backToGraph = diffViewer.getByRole('button', { name: 'Back to commit graph' });
  const closeDiff = diffViewer.getByRole('button', { name: 'Close diff' });
  await expect(backToGraph).toBeVisible();
  await expect(backToGraph).toContainText('Graph');
  await expect(closeDiff).toBeVisible();
  await expect(closeDiff).toHaveAttribute('title', 'Close diff (Esc)');
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
  await expect(fileNavigation).toContainText('1 / 3');
  await expect(previousFile).toBeDisabled();
  await expect(nextFile).toBeEnabled();
  await nextFile.click();
  await expect(fileNavigation).toContainText('2 / 3');
  await expect(diffViewer.locator('.diff-file-identity')).toHaveAttribute('title', 'apps/desktop/src/app/app.component.ts');
  await expect(diffViewer.locator('.diff-file-identity strong')).toHaveText('app.component.ts');
  await page.keyboard.press('Alt+ArrowDown');
  await expect(fileNavigation).toContainText('3 / 3');
  await expect(nextFile).toBeDisabled();
  await page.keyboard.press('Alt+ArrowUp');
  await expect(fileNavigation).toContainText('2 / 3');
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

  await diff.getByRole('button', { name: /Select added line/ }).click();
  const actions = diff.getByRole('group', { name: 'Selected line actions' });
  await expect(actions).toContainText('2 selected');
  await expect(diff.getByRole('button', { name: /Deselect added line/ })).toBeVisible();
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
  await expect(navigation).toContainText('1 / 4');
  await expect(diff.locator('.diff-file-identity')).toHaveAttribute('title', 'apps/desktop/src/app/app.component.html');
  await expect(diff.locator('.diff-file-identity strong')).toHaveText('app.component.html');

  await page.keyboard.press('Alt+ArrowDown');
  await expect(navigation).toContainText('2 / 4');
  await expect(diff.locator('.diff-file-identity')).toHaveAttribute('title', 'apps/desktop/src/app/app.component.scss');
  await expect(diff.locator('.diff-file-identity strong')).toHaveText('app.component.scss');
  await page.keyboard.press('Alt+ArrowDown');
  await page.keyboard.press('Alt+ArrowDown');
  await expect(navigation).toContainText('4 / 4');
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
  await commitPanel.getByRole('button', { name: /Jump to parent commit 83e6d15/ }).click();

  await expect(page.locator('[data-commit-oid="83e6d15fb82672899688b93f59251dfc669888a3"]')).toHaveClass(/selected/);
  await expect(commitPanel).toContainText('Merge feature/partial-staging');

  await commitPanel.getByRole('button', { name: /Jump to child commit f19b263/ }).click();
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
  for (const control of [decreaseZoom, increaseZoom, resetZoom]) {
    await expect.poll(() => control.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return Math.min(box.width, box.height);
    })).toBeGreaterThanOrEqual(24);
  }
  await expect(decreaseZoom).toBeDisabled();
  await expect(resetZoom).toBeDisabled();
  expect(await decreaseZoom.evaluate((element) => Number.parseFloat(getComputedStyle(element).opacity))).toBeGreaterThanOrEqual(.7);

  await zoom.selectOption({ label: '125%' });
  await expect(zoom.locator('option:checked')).toHaveText('125%');
  await expect(decreaseZoom).toBeEnabled();
  await expect(resetZoom).toBeEnabled();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('git-chronos.ui.zoom'))).toBe('125');

  await page.reload();
  const restoredZoom = page.getByLabel('Interface zoom', { exact: true });
  await expect(restoredZoom.locator('option:checked')).toHaveText('125%');

  await page.keyboard.press('Control+=');
  await expect(restoredZoom.locator('option:checked')).toHaveText('140%');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('git-chronos.ui.zoom'))).toBe('140');

  await page.keyboard.press('Control+-');
  await expect(restoredZoom.locator('option:checked')).toHaveText('125%');

  await page.keyboard.press('Control+0');
  await expect(restoredZoom.locator('option:checked')).toHaveText('100%');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('git-chronos.ui.zoom'))).toBe('100');
});

test('reserves status-bar space for the persistent zoom controls', async ({ page }) => {
  for (const width of [1440, 820, 700, 500, 420, 360]) {
    await page.setViewportSize({ width, height: 720 });
    const zoomBox = await page.getByLabel('Interface zoom controls').boundingBox();
    expect(zoomBox).not.toBeNull();
    const statusHeight = await page.locator('.statusbar').evaluate((element) => element.getBoundingClientRect().height);
    for (const selector of ['.status-branch', '.status-sync.outgoing', '.status-changes', '.activity-status', '.status-version']) {
      const item = page.locator(selector);
      if (await item.count() && await item.first().isVisible()) {
        const box = await item.first().boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x + box!.width, `${selector} should end before persistent zoom controls`).toBeLessThanOrEqual(zoomBox!.x - 8);
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
    '.commit-form > input',
    '.statusbar',
  ];

  for (const selector of selectors) {
    const size = await page.locator(selector).first().evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).fontSize));
    expect(size, `${selector} should remain readable without zoom`).toBeGreaterThanOrEqual(12);
  }
});

test('keeps secondary workspace text legible and respects reduced motion', async ({ page }) => {
  for (const selector of ['.worktree-list-main small', '.toolbar-nav-button small', '.file-path-prefix']) {
    const ratio = await page.locator(selector).first().evaluate((element) => {
      const channels = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number);
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
    expect(ratio, `${selector} should meet WCAG AA contrast`).toBeGreaterThanOrEqual(4.5);
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
  expect(Math.round(box!.width)).toBeLessThanOrEqual(355);
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
  const compactCommitOptions = await inspector.locator('.commit-option').evaluateAll((options) => options.map((option) => {
    const bounds = option.getBoundingClientRect();
    return { x: Math.round(bounds.x), y: Math.round(bounds.y), height: Math.round(bounds.height) };
  }));
  expect(compactCommitOptions).toHaveLength(4);
  expect(new Set(compactCommitOptions.map(({ x }) => x)).size).toBe(2);
  expect(compactCommitOptions.every(({ height }) => height === 24)).toBe(true);
  expect(compactCommitOptions[1].x).toBeGreaterThan(compactCommitOptions[0].x);
  expect(compactCommitOptions[1].y).toBe(compactCommitOptions[0].y);
  expect(compactCommitOptions[2].y).toBeGreaterThan(compactCommitOptions[0].y);
  const compactCommitButton = await inspector.locator('.commit-form .primary').boundingBox();
  expect(compactCommitButton).not.toBeNull();
  expect(compactCommitButton!.y + compactCommitButton!.height).toBeLessThanOrEqual(720 - 26);

  await page.getByRole('button', { name: 'Close commit panel' }).click();
  await expect(inspector).toBeHidden();

  await page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"]').click();
  await expect(inspector).toBeVisible();
  await expect(inspector).toContainText('Polish repository activity drawer');

  await page.getByRole('button', { name: 'Close commit panel' }).click();
  await expect(inspector).toBeHidden();
  await page.getByRole('button', { name: 'Show Commit Panel', exact: true }).click();
  await expect(inspector).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.getByRole('button', { name: /Open working directory changes/ }).click();
  await expect(inspector.locator('.commit-option')).toHaveCount(4);
  const wideCommitOptions = await inspector.locator('.commit-option').evaluateAll((options) => options.map((option) => {
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
  await expect.poll(() => page.evaluate(() => localStorage.getItem('git-chronos.remote.auto-fetch-minutes'))).toBe('15');
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
  await expect(page.locator('.split-diff-body')).toHaveCSS('font-size', '12px');
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

  const history = page.getByRole('button', { name: 'History' });
  await history.click();
  await expect(history).toHaveAttribute('aria-pressed', 'true');
  await hunk.click();
  await expect(history).toHaveAttribute('aria-pressed', 'false');
});

test('remembers the preferred diff layout across files and reloads', async ({ page }) => {
  await page.goto('/?compare-commits&diff-viewer=hunk');
  const layout = page.getByRole('group', { name: 'Diff layout' });
  await layout.getByRole('button', { name: 'Split' }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('git-chronos.diff.view-mode'))).toBe('split');

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
  const minimumFooter = page.locator('.diff-workspace-footer');
  await expect(page.getByRole('navigation', { name: 'Navigate changes compact' })).toBeVisible();
  await expect(page.locator('.diff-footer-wrap-toggle')).toBeVisible();
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
    }
    expect(Math.abs(diffBox!.x + diffBox!.width - commitPanelBox!.x)).toBeLessThanOrEqual(1);
    expect(diffBox!.width).toBeGreaterThanOrEqual(515);
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
    fontSize: localStorage.getItem('git-chronos.diff.font-size'),
    tabSize: localStorage.getItem('git-chronos.diff.tab-size'),
    wordWrap: localStorage.getItem('git-chronos.diff.word-wrap'),
  }))).toEqual({ fontSize: '14', tabSize: '8', wordWrap: 'true' });
});
