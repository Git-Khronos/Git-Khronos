import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    const fixture = { calls: [] as any[], fail: false, hold: false, resolve: null as any,
      failure: null as any, holdDepth: false, resolveDepth: null as any, rejectDepth: null as any,
      shallow: { shallow: false, boundaryCommits: 0 } as any };
    (window as any).__fetchFixture = fixture;
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string, args: any) => {
        fixture.calls.push({ command, args });
        if (command === 'fetch_branches' || command === 'fetch_repository') {
          if (fixture.fail) return Promise.reject(fixture.failure ?? { kind: 'gitTransportFailure',
            message: "Fetch failed at remote 'origin'; earlier remotes may already be updated. Refresh and retry." });
          if (fixture.hold) return new Promise((_resolve, reject) => {
            fixture.resolve = () => reject({ kind: 'operationCancelled',
              message: 'Fetch was cancelled. Earlier remotes may already be updated; review the refreshed graph.' });
          });
          return Promise.resolve(git.repository());
        }
        if (command === 'shallow_history_state') {
          if (fixture.holdDepth) return new Promise((resolve, reject) => {
            fixture.resolveDepth = resolve;
            fixture.rejectDepth = reject;
          });
          return Promise.resolve(fixture.shallow);
        }
        if (command === 'cancel_git_operation') {
          fixture.resolve?.();
          return Promise.resolve(true);
        }
        if (command === 'refresh_repository' || command === 'refresh_repository_metadata') return Promise.resolve(git.repository());
        if (command === 'refresh_repository_status') return Promise.resolve(git.repository().status);
        return Promise.reject(new Error(`Unexpected command ${command}`));
      },
    };
  });
}

async function openOptions(page: Page): Promise<void> {
  const fetchOptions = page.getByRole('button', { name: 'Fetch options', exact: true });
  if (await fetchOptions.isVisible()) {
    await fetchOptions.click();
  } else {
    await page.getByRole('button', { name: 'More repository actions', exact: true }).click();
  }
  await page.getByRole('menuitem', { name: /Fetch branches with options/ }).click();
  await expect(page.getByRole('dialog', { name: 'Fetch branches with options' })).toBeVisible();
}

test('Fetch Options stays actionable when remote status changes before the menu redraws', async ({ page }) => {
  await setup(page);
  const opener = page.getByRole('button', { name: 'Fetch options', exact: true });
  await opener.click();
  const item = page.getByRole('menuitem', { name: /Fetch branches with options/ });
  await expect(item).toBeVisible();
  // Deliver the click between a background state update and Angular's redraw.
  await item.evaluate((button: HTMLButtonElement) => {
    const { git } = (window as any).ng.getComponent(document.querySelector('gc-root'));
    git.backgroundFetchFailures.set({
      [git.repository().id]: { message: 'Remote status changed', requiresFetchAll: false },
    });
    button.click();
  });
  const dialog = page.getByRole('dialog', { name: 'Fetch branches with options' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  const commands = await page.evaluate(() => (window as any).__fetchFixture.calls.map((call: any) => call.command));
  expect(commands).not.toContain('fetch_branches');
  expect(commands).not.toContain('fetch_repository');
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
});

test('a retired Fetch Options menu cannot open a review in a new visit of the same menu', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Fetch options', exact: true }).click();
  const item = page.getByRole('menuitem', { name: /Fetch branches with options/ });
  await expect(item).toBeVisible();
  const openedFromRetiredMenu = await item.evaluate((button: HTMLButtonElement) => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const oldVisit = app.toolbarOverlays.activeOverlay();
    app.toolbarOverlays.close('fetch');
    app.toolbarOverlays.open({ kind: 'fetch', scope: oldVisit.scope }, oldVisit.returnFocus);
    button.click();
    return !!app.fetchRequest();
  });
  expect(openedFromRetiredMenu).toBe(false);
  await item.click();
  await expect(page.getByRole('dialog', { name: 'Fetch branches with options' })).toBeVisible();
});

test('scoped fetch defaults to one remote without pruning and sends cancellable typed options', async ({ page }) => {
  await setup(page);
  await openOptions(page);
  const dialog = page.getByRole('dialog', { name: 'Fetch branches with options' });
  await expect(dialog).toContainText('Local branches, tags, index and working files are unchanged');
  await expect(dialog.getByRole('checkbox')).not.toBeChecked();
  await expect(dialog.getByLabel('Fetch from')).toHaveValue('origin');
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await dialog.getByLabel('Fetch from').selectOption('upstream');
  await dialog.getByRole('button', { name: 'Fetch branches', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const call = await page.evaluate(() => (window as any).__fetchFixture.calls.find((call: any) => call.command === 'fetch_branches'));
  expect(call.args).toMatchObject({ repoId: expect.any(String), operationId: expect.any(String),
    options: { remote: 'upstream', prune: false } });
});

test('fetches one named branch without pruning, changing depth, or clearing a whole-remote failure', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const { git } = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const repo = git.repository();
    git.repositories.set([{ ...repo, remotes: repo.remotes.filter((remote: any) => remote.name === 'origin') }]);
    git.backgroundFetchFailures.set({ [repo.id]: { message: 'Previous fetch failed', requiresFetchAll: false } });
    (window as any).__fetchFixture.shallow = { shallow: true, boundaryCommits: 1 };
  });
  await openOptions(page);
  const dialog = page.getByRole('dialog', { name: 'Fetch branches with options' });
  await dialog.getByRole('checkbox', { name: 'Remove stale remote-tracking branches' }).check();
  await dialog.getByRole('radio', { name: 'Download complete history' }).check();
  const scope = dialog.getByLabel('Branches to fetch');
  await scope.selectOption('one');
  await expect(dialog.getByRole('group', { name: 'History depth' })).toHaveCount(0);
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  const submit = dialog.getByRole('button', { name: 'Fetch this branch' });
  await expect(submit).toBeDisabled();
  await dialog.getByLabel('Remote branch name').fill('release/1.0');
  await expect(dialog).toContainText('origin/release/1.0');
  await dialog.getByLabel('Fetch from').selectOption('');
  await expect(dialog.getByRole('alert')).toContainText('Choose one remote');
  await expect(submit).toBeDisabled();
  await scope.selectOption('all');
  await expect(dialog.getByRole('checkbox')).not.toBeChecked();
  await expect(dialog.getByRole('radio', { name: 'Keep the current depth' })).toBeChecked();
  await scope.selectOption('one');
  await dialog.getByLabel('Fetch from').selectOption('origin');
  await submit.click();
  await expect(dialog).toHaveCount(0);
  const calls = await page.evaluate(() => (window as any).__fetchFixture.calls.filter((call: any) => call.command.startsWith('fetch_')));
  expect(calls).toHaveLength(1);
  expect(calls[0].args.options).toEqual({ remote: 'origin', prune: false, branch: 'release/1.0' });
  await expect(page.locator('.auto-fetch-status')).toHaveText('Fetch failed');
});

async function openRemoteBranchFetch(page: Page) {
  const actions = page.getByRole('button', { name: 'Remote branch actions for origin/docs', exact: true });
  await actions.focus();
  await actions.press('Enter');
  const menu = page.getByRole('menu', { name: 'Actions for remote branch origin/docs' });
  await menu.getByRole('menuitem', { name: 'Fetch this branch only…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Fetch remote branch', exact: true });
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  return { actions, dialog };
}

test('remote branch action reviews an exact fetch without a checkout or editable target', async ({ page }) => {
  await setup(page);
  const { actions, dialog } = await openRemoteBranchFetch(page);
  await expect(dialog).toContainText('origin/docs');
  await expect(dialog).toContainText('This does not check out the branch');
  await expect(dialog.getByRole('combobox')).toHaveCount(0);
  await expect(dialog.getByRole('textbox')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__fetchFixture.calls.filter((call: any) =>
    /fetch|checkout|shallow_history_state/.test(call.command)))).toEqual([]);
  await dialog.getByRole('button', { name: 'Fetch this branch' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(actions).toBeFocused();
  const commands = await page.evaluate(() => (window as any).__fetchFixture.calls.filter((call: any) =>
    /fetch|checkout/.test(call.command)).map((call: any) => ({ command: call.command, options: call.args.options })));
  expect(commands).toEqual([{ command: 'fetch_branches', options: { remote: 'origin', branch: 'docs', prune: false } }]);
});

for (const change of ['fetch URL', 'workspace'] as const) {
  test(`remote branch fetch refuses an old click after changing the ${change}`, async ({ page }) => {
    await setup(page);
    const { dialog } = await openRemoteBranchFetch(page);
    await dialog.getByRole('button', { name: 'Fetch this branch' }).evaluate((button: HTMLButtonElement, change) => {
      const { git } = (window as any).ng.getComponent(document.querySelector('gc-root'));
      const repo = git.repository();
      if (change === 'workspace') {
        git.activeWorkspaceId.set('other-workspace-same-fetch-checkout');
      } else {
        git.repositories.update((repos: any[]) => repos.map(candidate => candidate.id !== repo.id ? candidate : {
          ...candidate, remotes: candidate.remotes.map((remote: any) => remote.name === 'origin'
            ? { ...remote, fetchUrl: '/owned/replacement.git' } : remote),
        }));
      }
      button.click();
    }, change);
    if (change === 'workspace') await expect(dialog).toHaveCount(0);
    else {
      await expect(dialog.getByRole('alert')).toContainText('fetch URL changed');
      await expect(dialog.getByRole('button', { name: 'Fetch this branch' })).toBeDisabled();
    }
    expect(await page.evaluate(() => (window as any).__fetchFixture.calls.some((call: any) => call.command === 'fetch_branches'))).toBe(false);
  });
}

test('all-remotes pruning requires opt-in and discloses branch-only and partial completion scope', async ({ page }) => {
  await setup(page);
  await openOptions(page);
  const dialog = page.getByRole('dialog', { name: 'Fetch branches with options' });
  await dialog.getByLabel('Fetch from').selectOption('');
  await expect(dialog).toContainText('earlier remotes may already be updated');
  await dialog.getByRole('checkbox').check();
  await dialog.getByText('Advanced scope', { exact: true }).click();
  await expect(dialog.locator('.form-disclosure-body li')).toHaveCount(3);
  await expect(dialog.locator('summary')).toBeVisible();
  await expect(dialog).toContainText('not custom fetch refspecs or mirror settings');
  await expect(dialog).toContainText('never fetches or prunes tags');
  await dialog.getByRole('button', { name: 'Fetch branches', exact: true }).click();
  const call = await page.evaluate(() => (window as any).__fetchFixture.calls.find((call: any) => call.command === 'fetch_branches'));
  expect(call.args.options).toEqual({ remote: null, prune: true });
});

for (const scope of ['all remotes', 'one of two', 'only configured remote']) {
  test(`successful Fetch options resumes a paused background fetch only if it covers the repository: ${scope}`, async ({ page }) => {
    await setup(page);
    await page.evaluate(onlyOne => {
      const { git } = (window as any).ng.getComponent(document.querySelector('gc-root'));
      const source = git.repository();
      if (onlyOne) git.repositories.set([{ ...source, remotes: source.remotes.filter((remote: any) => remote.name === 'origin') }]);
      git.backgroundFetchFailures.set({
        [source.id]: { message: 'Owned previous authentication failure', requiresFetchAll: false },
        other: { message: 'Other tab failure', requiresFetchAll: false },
      });
    }, scope === 'only configured remote');
    const background = page.locator('.auto-fetch-status');
    await expect(background).toHaveText('Fetch failed');
    await openOptions(page);
    const dialog = page.getByRole('dialog', { name: 'Fetch branches with options' });
    await dialog.getByLabel('Fetch from').selectOption(scope === 'all remotes' ? '' : 'origin');
    await dialog.getByRole('button', { name: 'Fetch branches', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    if (scope === 'one of two') await expect(background).toHaveText('Fetch failed');
    else await expect(background).not.toHaveText('Fetch failed');
    expect(await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root'))
      .git.backgroundFetchErrors().other?.message)).toBe('Other tab failure');
  });
}

test('failed fetch retains scope and focuses its explicit native error for retry', async ({ page }) => {
  await setup(page);
  await openOptions(page);
  const dialog = page.getByRole('dialog', { name: 'Fetch branches with options' });
  await dialog.getByRole('checkbox').check();
  await page.evaluate(() => { (window as any).__fetchFixture.fail = true; });
  await dialog.getByRole('button', { name: 'Fetch branches', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('earlier remotes may already be updated');
  await expect(dialog.getByRole('alert')).toBeFocused();
  await expect(dialog.getByRole('checkbox')).toBeChecked();
  await page.evaluate(() => { (window as any).__fetchFixture.fail = false; });
  await dialog.getByRole('button', { name: 'Fetch branches', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test('compact dialog traps focus, resets prune on reopen, and returns toolbar focus', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 640 });
  await setup(page);
  await openOptions(page);
  const dialog = page.getByRole('dialog', { name: 'Fetch branches with options' });
  await dialog.getByRole('checkbox').check();
  const confirm = dialog.getByRole('button', { name: 'Fetch branches', exact: true });
  await confirm.focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByLabel('Fetch from')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(confirm).toBeFocused();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'More repository actions', exact: true })).toBeFocused();
  await openOptions(page);
  await expect(dialog.getByRole('checkbox')).not.toBeChecked();
});

test('repository switch retires the old fetch review without dispatch', async ({ page }) => {
  await setup(page);
  await openOptions(page);
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    const repository = git.repository();
    git.repositories.update((items: any[]) => [...items, { ...repository, id: 'different', name: 'Different' }]);
    git.activeRepositoryId.set('different');
  });
  const dialog = page.getByRole('dialog', { name: 'Fetch branches with options' });
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__fetchFixture.calls.some((call: any) => call.command === 'fetch_branches'))).toBe(false);
});

test('pending fetch disables scope changes and exposes cancellation by operation id', async ({ page }) => {
  await setup(page);
  await openOptions(page);
  await page.evaluate(() => { (window as any).__fetchFixture.hold = true; });
  const dialog = page.getByRole('dialog', { name: 'Fetch branches with options' });
  await dialog.getByRole('button', { name: 'Fetch branches', exact: true }).click();
  await expect(dialog.getByLabel('Fetch from')).toBeDisabled();
  await expect(dialog.getByRole('checkbox')).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel operation' }).click();
  await expect(dialog.getByRole('status')).toContainText('cancelled');
  await expect(dialog.getByRole('status')).toBeFocused();
  await expect(dialog.getByLabel('Fetch from')).toBeEnabled();
  const calls = await page.evaluate(() => (window as any).__fetchFixture.calls);
  expect(calls.find((call: any) => call.command === 'cancel_git_operation').args.operationId)
    .toBe(calls.find((call: any) => call.command === 'fetch_branches').args.operationId);
});

test('Fetch All command palette action really fetches all rather than the current remote', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Command palette', exact: true }).click();
  await page.getByRole('combobox', { name: 'Search commands', exact: true }).fill('Fetch All');
  await page.getByRole('option', { name: /^Fetch All/ }).click();

  const observedFetch = () => page.evaluate(() => (window as any).__fetchFixture.calls.find((call: any) => call.command === 'fetch_repository'));
  await expect.poll(observedFetch).toBeDefined();
  const call = await observedFetch();
  expect(call.args.remote).toBeUndefined();
});

test('no-remotes state explains why scoped fetch is unavailable', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    const id = git.activeRepositoryId();
    git.repositories.update((repositories: any[]) => repositories.map((repository) =>
      repository.id === id ? { ...repository, remotes: [] } : repository));
  });
  await openOptions(page);
  const dialog = page.getByRole('dialog', { name: 'Fetch branches with options' });
  await expect(dialog.getByRole('alert')).toContainText('add a remote before fetching');
  await expect(dialog.getByRole('button', { name: 'Fetch branches', exact: true })).toBeDisabled();
});

test('complete history hides depth choices; shallow history requires one remote and sends typed deepen options', async ({ page }) => {
  await setup(page);
  await openOptions(page);
  const dialog = page.getByRole('dialog', { name: 'Fetch branches with options' });
  await expect.poll(() => page.evaluate(() => (window as any).__fetchFixture.calls.some((call: any) => call.command === 'shallow_history_state'))).toBe(true);
  await expect(dialog.getByRole('group', { name: 'History depth' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.evaluate(() => { (window as any).__fetchFixture.shallow = { shallow: true, boundaryCommits: 1 }; });
  await openOptions(page);
  const history = dialog.getByRole('group', { name: 'History depth' });
  await expect(history).toContainText('behind 1 boundary commit.');
  await expect(history.getByRole('radio', { name: 'Keep the current depth' })).toBeChecked();
  await expect(history.getByLabel('Commits to deepen by')).toBeDisabled();
  await history.getByRole('radio', { name: /Deepen by/ }).check();
  await history.getByLabel('Commits to deepen by').fill('0');
  await expect(history.getByRole('alert')).toContainText('whole number');
  const submit = dialog.getByRole('button', { name: 'Fetch and extend history' });
  await expect(submit).toBeDisabled();
  await history.getByLabel('Commits to deepen by').fill('25');
  await dialog.getByLabel('Fetch from').selectOption('');
  await expect(history.getByRole('alert')).toContainText('Choose one remote');
  await expect(submit).toBeDisabled();
  await dialog.getByLabel('Fetch from').selectOption('upstream');
  await submit.click();
  await expect(dialog).toHaveCount(0);
  const call = await page.evaluate(() => (window as any).__fetchFixture.calls.find((call: any) => call.command === 'fetch_branches'));
  expect(call.args.options).toEqual({ remote: 'upstream', prune: false, history: { mode: 'deepen', commits: 25 } });
});

for (const ending of ['partial', 'complete'] as const) {
  test(`depth review rechecks after a failed fetch and handles an updated ${ending} checkout`, async ({ page }) => {
    await setup(page);
    await page.evaluate(() => { (window as any).__fetchFixture.shallow = { shallow: true, boundaryCommits: 3 }; });
    await openOptions(page);
    const dialog = page.getByRole('dialog', { name: 'Fetch branches with options' });
    const controls = dialog.getByRole('group', { name: 'History depth' });
    await controls.getByRole('radio', { name: /Deepen by/ }).check();
    await controls.getByLabel('Commits to deepen by').fill('7');
    await page.evaluate(() => {
      const fixture = (window as any).__fetchFixture;
      fixture.holdDepth = true;
      fixture.fail = true;
      fixture.failure = { kind: 'historyDepthPartial', message: 'Git extended only part of the shallow history.' };
    });
    const submit = dialog.getByRole('button', { name: 'Fetch and extend history' });
    await submit.click();
    await expect(dialog.getByText('Checking current history depth…')).toBeVisible();
    await expect(submit).toBeDisabled();
    await dialog.dispatchEvent('submit', { bubbles: true, cancelable: true });
    const fetchOptions = () => page.evaluate(() => (window as any).__fetchFixture.calls
      .filter(({ command }: any) => command === 'fetch_branches').map(({ args }: any) => args.options));
    const first = { remote: 'origin', prune: false, history: { mode: 'deepen', commits: 7 } };
    expect(await fetchOptions()).toEqual([first]);

    if (ending === 'partial') {
      await page.evaluate(() => (window as any).__fetchFixture.rejectDepth(new Error('Owned depth read failure')));
      await expect(dialog.getByText('Current history depth could not be checked.', { exact: false })).toBeVisible();
      await expect(controls).toContainText('At the last check, older commits were missing behind 3 boundary commits.');
      await expect(submit).toBeDisabled();
      await dialog.getByRole('button', { name: 'Check history depth again' }).click();
      await expect(dialog.getByText('Checking current history depth…')).toBeVisible();
    }
    await page.evaluate(complete => {
      const fixture = (window as any).__fetchFixture;
      fixture.fail = false;
      fixture.resolveDepth({ shallow: !complete, boundaryCommits: complete ? 0 : 1 });
    }, ending === 'complete');
    if (ending === 'complete') {
      await expect(dialog.getByText('History is now complete.', { exact: false })).toBeVisible();
      await expect(submit).toBeDisabled();
      await dialog.getByRole('button', { name: 'Review fetch without changing depth' }).click();
      expect(await fetchOptions()).toEqual([first]);
      await dialog.getByRole('button', { name: 'Fetch branches', exact: true }).click();
    } else {
      await expect(controls).toContainText('Older commits are missing behind 1 boundary commit.');
      await expect(controls.getByLabel('Commits to deepen by')).toHaveValue('7');
      await submit.click();
    }
    await expect(dialog).toHaveCount(0);
    expect(await fetchOptions()).toEqual([first, ending === 'partial' ? first : { remote: 'origin', prune: false }]);
  });
}

test('a native shallow boundary is visible in history and opens depth review without fetching', async ({ page }) => {
  await setup(page);
  const { boundary, graft } = await page.evaluate(() => {
    const { git } = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const repo = git.repository();
    (window as any).__fetchFixture.shallow = { shallow: true, boundaryCommits: 1 };
    const [first, second] = repo.commits.filter((commit: any) =>
      !repo.stashes.some((stash: any) => stash.oid === commit.oid));
    git.repositories.update((items: any[]) => items.map(item => item !== repo ? item : {
      ...repo, commits: repo.commits.map((commit: any) => commit === first
        ? { ...commit, parents: [], shallowBoundary: true }
        : commit === second ? { ...commit, decorations: [...commit.decorations, 'grafted'] } : commit),
    }));
    return { boundary: first.oid, graft: second.oid };
  });
  const row = page.locator(`[data-commit-oid="${boundary}"]`);
  await expect(row).toHaveAttribute('aria-label', /shallow history boundary/);
  await expect(row.getByText('Shallow boundary', { exact: true })).toBeVisible();
  await row.getByText('Shallow boundary', { exact: true }).click({ button: 'right' });
  const menu = page.locator('.commit-context-menu');
  await menu.getByRole('menuitem', { name: 'Review history depth…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Fetch branches with options' });
  await expect(dialog.getByRole('group', { name: 'History depth' })).toBeVisible();
  await expect(dialog.getByRole('radio', { name: 'Keep the current depth' })).toBeChecked();
  expect(await page.evaluate(() => (window as any).__fetchFixture.calls.some((call: any) =>
    call.command === 'fetch_branches' || call.command === 'fetch_repository'))).toBe(false);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(row).toBeFocused();

  const legacy = page.locator(`[data-commit-oid="${graft}"]`);
  await expect(legacy.getByText('Shallow boundary', { exact: true })).toHaveCount(0);
  await legacy.locator('.commit-main').click({ button: 'right' });
  await expect(menu.getByRole('menuitem', { name: 'Checkout this commit' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Review history depth…' })).toHaveCount(0);
});

test('complete-history choice discloses size and a shallow source, then reopens at the current depth', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { (window as any).__fetchFixture.shallow = { shallow: true, boundaryCommits: 3 }; });
  await openOptions(page);
  const dialog = page.getByRole('dialog', { name: 'Fetch branches with options' });
  const history = dialog.getByRole('group', { name: 'History depth' });
  await expect(history).toContainText('3 boundary commits');
  await history.getByRole('radio', { name: 'Download complete history' }).check();
  await expect(history).toContainText('remote is itself shallow');
  await dialog.getByRole('button', { name: 'Fetch and extend history' }).click();
  const call = await page.evaluate(() => (window as any).__fetchFixture.calls.find((call: any) => call.command === 'fetch_branches'));
  expect(call.args.options).toEqual({ remote: 'origin', prune: false, history: { mode: 'complete' } });
  await openOptions(page);
  await expect(history.getByRole('radio', { name: 'Keep the current depth' })).toBeChecked();
});
