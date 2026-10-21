import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.commit-row[data-commit-oid]').first()).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    const original = git.repository();
    const status = { ...original.status, staged: 0, unstaged: 0, untracked: 0, conflicted: 0,
      historyOperation: null, historyNoCommit: false, entryCount: 0, entries: [] };
    const fixture = { original: { ...original, status }, snapshot: { ...original, status },
      calls: [] as any[], conflict: false, refused: false, empty: false };
    git.repositories.update((items: any[]) => items.map(item => item.id === original.id ? fixture.snapshot : item));
    (window as any).__noCommit = fixture;
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string, args: any) => {
        fixture.calls.push({ command, args });
        if (command === 'cherry_pick_commits') {
          if (fixture.refused) return Promise.reject({ kind: 'dirtyWorkingTree', message: 'Commit or stash local changes before replaying changes.' });
          fixture.snapshot = { ...fixture.snapshot, status: { ...status,
            staged: fixture.empty ? 0 : 1, conflicted: fixture.conflict ? 1 : 0,
            historyOperation: fixture.conflict ? 'cherry-pick' : null, historyNoCommit: fixture.conflict,
            entryCount: fixture.empty ? 0 : 1, entries: fixture.empty ? [] : [{ path: 'file.txt', oldPath: null, indexStatus: fixture.conflict ? 'U' : 'M',
              worktreeStatus: fixture.conflict ? 'U' : '.', conflicted: fixture.conflict }] } };
          if (fixture.conflict) return Promise.reject({ kind: 'gitFailure', message: 'Selected changes conflicted. Resolve and stage before continuing.' });
          return Promise.resolve(fixture.snapshot);
        }
        if (command === 'control_history_operation') {
          if (args.action === 'abort') fixture.snapshot = fixture.original;
          else fixture.snapshot = { ...fixture.snapshot, status: { ...fixture.snapshot.status,
            historyOperation: null, historyNoCommit: false,
            ...(args.action === 'continue' ? { conflicted: 0, staged: 2,
              entries: [{ path: 'file.txt', oldPath: null, indexStatus: 'M', worktreeStatus: '.', conflicted: false }],
            } : {}),
          } };
          return Promise.resolve(fixture.snapshot);
        }
        if (command === 'stage_all') {
          fixture.snapshot = { ...fixture.snapshot, status: { ...fixture.snapshot.status, conflicted: 0, staged: 1,
            entries: fixture.snapshot.status.entries.map((entry: any) => ({ ...entry, conflicted: false, indexStatus: 'M', worktreeStatus: '.' })) } };
          return Promise.resolve(fixture.snapshot.status);
        }
        if (command === 'refresh_repository_status') return Promise.resolve(fixture.snapshot.status);
        if (command === 'refresh_repository') return Promise.resolve(fixture.snapshot);
        return Promise.reject(new Error(`Unexpected command ${command}`));
      },
    };
  });
});

async function openReview(page: Page, multi = false): Promise<void> {
  await page.evaluate(multi => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const commits = app.git.repository().commits.filter((commit: any) => commit.parents.length === 1).slice(0, 3).reverse();
    const oids = multi ? commits.map((commit: any) => commit.oid) : [commits[0].oid];
    app.openHistoryConfirmation({ kind: 'cherry-pick', oid: oids[0], oids, label: 'Reviewed no-commit changes' });
  }, multi);
  await expect(page.getByRole('alertdialog')).toBeVisible();
}

for (const multi of [false, true]) {
  test(`${multi ? 'ordered multiple' : 'single'} no-commit applies exact selected OIDs, leaves HEAD and drafts unchanged and reports staged result`, async ({ page }) => {
    await openReview(page, multi);
    const dialog = page.getByRole('alertdialog');
    const option = dialog.getByRole('checkbox', { name: 'Apply changes without creating commits' });
    await expect(option).not.toBeChecked();
    await option.check();
    await expect(dialog).toContainText('HEAD stays unchanged');
    await expect(dialog).toContainText('your own message and identity');
    const captured = await page.evaluate(() => {
      const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
      app.commitMessage.set('Retained explicit commit draft');
      return app.pendingHistoryAction().oids;
    });
    await dialog.locator('.confirm-action').click();
    await expect(dialog).toHaveCount(0);
    const result = await page.evaluate(() => {
      const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
      return { fixture: (window as any).__noCommit, head: app.git.repository().headOid,
        activity: app.git.activity(), draft: app.commitMessage() };
    });
    expect(result.head).toBe(result.fixture.original.headOid);
    expect(result.draft).toBe('Retained explicit commit draft');
    expect(result.activity).toBe('Selected changes staged; no commit created');
    expect(result.fixture.calls.find((call: any) => call.command === 'cherry_pick_commits').args)
      .toEqual({ repoId: result.fixture.original.id, oids: captured, mainline: null, noCommit: true });
    expect(result.fixture.calls.some((call: any) => call.command === 'commit_changes')).toBe(false);
  });
}

test('no-commit refusal retains the explicit choice and no staged application is reported', async ({ page }) => {
  await openReview(page);
  const dialog = page.getByRole('alertdialog');
  await dialog.getByRole('checkbox', { name: 'Apply changes without creating commits' }).check();
  await page.evaluate(() => { (window as any).__noCommit.refused = true; });
  await dialog.locator('.confirm-action').click();
  await expect(dialog.locator('.recovery-error')).toContainText('Commit or stash');
  await expect(dialog.locator('.recovery-error')).toBeFocused();
  await expect(dialog.getByRole('checkbox')).toBeChecked();
  expect(await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.activity()))
    .not.toBe('Selected changes staged; no commit created');
  await page.keyboard.press('Escape');
  await openReview(page);
  await expect(dialog.getByRole('checkbox')).not.toBeChecked();
});

test('empty no-commit effects report unchanged HEAD rather than inventing staged changes or commits', async ({ page }) => {
  await openReview(page);
  const dialog = page.getByRole('alertdialog');
  await dialog.getByRole('checkbox', { name: 'Apply changes without creating commits' }).check();
  await page.evaluate(() => { (window as any).__noCommit.empty = true; });
  await dialog.locator('.confirm-action').click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.activity()))
    .toBe('Selected changes have no effect; HEAD unchanged and no commit created');
});

for (const action of ['continue', 'abort', 'quit'] as const) {
  test(`no-commit conflict ${action} uses explicit recovery without an implicit commit or skip`, async ({ page }) => {
    await openReview(page, true);
    const dialog = page.getByRole('alertdialog');
    await dialog.getByRole('checkbox', { name: 'Apply changes without creating commits' }).check();
    await page.evaluate(() => { (window as any).__noCommit.conflict = true; });
    await dialog.locator('.confirm-action').click();
    await expect(dialog.locator('.recovery-error')).toContainText('conflicted');
    await page.keyboard.press('Escape');
    const progress = page.getByRole('status', { name: 'Git cherry-pick in progress' });
    await expect(progress).toContainText('NO COMMIT');
    await expect(progress.getByRole('button', { name: 'Skip', exact: true })).toHaveCount(0);
    await expect(progress.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
    await page.evaluate(() => {
      const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
      app.changesOpen.set(true);
      app.commitMessage.set('Draft retained across conflict recovery');
    });
    await expect(page.getByRole('button', { name: /Commit changes to/ })).toBeDisabled();
    if (action === 'continue') {
      await page.evaluate(async () => { await (window as any).ng.getComponent(document.querySelector('gc-root')).git.stageAll(); });
      await expect(progress.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
    }
    await progress.getByRole('button', { name: action === 'quit' ? 'Finish manually' : action === 'abort' ? 'Abort' : 'Continue', exact: true }).click();
    await expect(progress).toHaveCount(0);
    const result = await page.evaluate(() => {
      const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
      return { fixture: (window as any).__noCommit, head: app.git.repository().headOid,
        status: app.git.repository().status, draft: app.commitMessage(), activity: app.git.activity() };
    });
    expect(result.head).toBe(result.fixture.original.headOid);
    expect(result.draft).toBe('Draft retained across conflict recovery');
    expect(result.fixture.calls.find((call: any) => call.command === 'control_history_operation').args)
      .toEqual({ repoId: result.fixture.original.id, operation: 'cherry-pick', action });
    expect(result.fixture.calls.some((call: any) => call.command === 'commit_changes')).toBe(false);
    if (action === 'quit') {
      expect(result.status.conflicted).toBe(1);
      expect(result.status.entries[0].conflicted).toBe(true);
      expect(result.status.staged).toBe(1);
    }
    expect(result.activity).toBe(action === 'continue' ? 'Selected changes staged; no commit created'
      : action === 'abort' ? 'No-commit replay aborted; original tracked state restored'
        : 'No-commit sequence ended; current files and staged changes retained');
  });
}

test('marker-only status refresh toggles no-commit controls without losing unchanged repository contents', async ({ page }) => {
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const fixture = (window as any).__noCommit;
    fixture.snapshot = { ...fixture.snapshot, status: { ...fixture.snapshot.status, historyOperation: 'cherry-pick' } };
    app.git.repositories.update((items: any[]) => items.map(item => item.id === fixture.snapshot.id ? fixture.snapshot : item));
  });
  const progress = page.getByRole('status', { name: 'Git cherry-pick in progress' });
  await expect(progress.getByRole('button', { name: 'Skip', exact: true })).toBeVisible();
  for (const enabled of [true, false]) {
    expect(await page.evaluate(async enabled => {
      const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
      const fixture = (window as any).__noCommit;
      fixture.snapshot = { ...fixture.snapshot, status: { ...fixture.snapshot.status, historyNoCommit: enabled } };
      return app.git.refreshStatusInBackground(fixture.snapshot.id, true);
    }, enabled)).toBe(true);
    if (enabled) {
      await expect(progress).toContainText('NO COMMIT');
      await expect(progress.getByRole('button', { name: 'Skip', exact: true })).toHaveCount(0);
      await expect(progress.getByRole('button', { name: 'Finish manually', exact: true })).toBeVisible();
      await expect(page.locator('#commit-readiness')).toHaveText('Finish the no-commit replay from the operation banner before creating another commit.');
      await page.getByLabel('Commit summary').fill('Must not commit during replay');
      await page.getByLabel('Commit summary').press('Enter');
      expect(await page.evaluate(() => (window as any).__noCommit.calls.some((call: any) => call.command === 'commit_changes'))).toBe(false);
    } else {
      await expect(progress).not.toContainText('NO COMMIT');
      await expect(progress.getByRole('button', { name: 'Skip', exact: true })).toBeVisible();
    }
  }
  const result = await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    return { fixture: (window as any).__noCommit, repository: app.git.repository() };
  });
  expect(result.repository.headOid).toBe(result.fixture.original.headOid);
  expect(result.repository.status.entries).toEqual([]);
  expect(result.fixture.calls.every((call: any) => call.command === 'refresh_repository_status')).toBe(true);
});

test('preview Finish manually retains staged and conflicted contents and never pretends to abort', async ({ page }) => {
  const entries = await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const fixture = (window as any).__noCommit;
    const entries = [{ path: 'file.txt', oldPath: null, indexStatus: 'U', worktreeStatus: 'U', conflicted: true }];
    fixture.snapshot = { ...fixture.snapshot, status: { ...fixture.snapshot.status,
      historyOperation: 'cherry-pick', historyNoCommit: true, staged: 1, conflicted: 1, entryCount: 1, entries } };
    app.git.systemInfo.update((info: any) => ({ ...info, appVersion: 'browser preview' }));
    app.git.repositories.update((items: any[]) => items.map(item => item.id === fixture.snapshot.id ? fixture.snapshot : item));
    return entries;
  });
  const progress = page.getByRole('status', { name: 'Git cherry-pick in progress' });
  await progress.getByRole('button', { name: 'Finish manually', exact: true }).click();
  await expect(progress).toHaveCount(0);
  const result = await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    return { fixture: (window as any).__noCommit, repository: app.git.repository(), activity: app.git.activity() };
  });
  expect(result.repository.headOid).toBe(result.fixture.original.headOid);
  expect(result.repository.status.entries).toEqual(entries);
  expect(result.repository.status.staged).toBe(1);
  expect(result.repository.status.conflicted).toBe(1);
  expect(result.activity).toBe('No-commit sequence ended; current files and staged changes retained');
  expect(result.fixture.calls).toEqual([]);
});
