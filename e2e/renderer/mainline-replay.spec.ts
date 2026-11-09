import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.commit-row[data-commit-oid]').first()).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    const repository = git.repository();
    const commit = repository.commits.find((commit: any) => commit.subject === 'Polish repository activity drawer');
    git.repositories.update((repositories: any[]) => repositories.map(item => item.id === repository.id
      ? { ...item, commits: item.commits.map((item: any) => item.oid === commit.oid
        ? { ...item, parents: ['a'.repeat(40), 'b'.repeat(40)] } : item) }
      : item));
    (window as any).__mainline = { oid: commit.oid, repoId: repository.id, calls: [], refused: false };
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string, args: any) => {
        const fixture = (window as any).__mainline;
        fixture.calls.push({ command, args });
        if (['cherry_pick_commits', 'revert_commit', 'checkout_branch'].includes(command)) {
          if (fixture.refused) return Promise.reject({ kind: 'gitFailure', message: 'Hook refused replay. Correct the hook and retry.' });
          if (fixture.deferCheckout && command === 'checkout_branch') {
            return new Promise(resolve => { fixture.resolveCheckout = () => resolve(git.repositories().find((item: any) => item.id === repository.id)); });
          }
          return Promise.resolve(git.repository());
        }
        if (command === 'refresh_repository_status') return Promise.resolve(git.repository().status);
        if (command === 'refresh_repository') return Promise.resolve(git.repository());
        return Promise.reject(new Error(`Unexpected command ${command}`));
      },
    };
  });
});

async function openReplay(page: Page, operation: 'cherry-pick' | 'revert'): Promise<void> {
  await page.getByRole('button', { name: 'Commit actions for Polish repository activity drawer', exact: true }).click();
  await page.getByRole('menuitem', { name: operation === 'cherry-pick' ? 'Cherry-pick commit' : 'Revert commit', exact: true }).click();
}

for (const operation of ['cherry-pick', 'revert'] as const) {
  for (const parent of [1, 2]) {
    test(`${operation} merge requires reviewed parent ${parent}, preserves failure draft and sends exact IPC`, async ({ page }) => {
      await openReplay(page, operation);
      const dialog = page.getByRole('alertdialog');
      const select = dialog.getByLabel('Mainline parent (required)');
      const confirm = dialog.getByRole('button', { name: operation === 'cherry-pick' ? 'Cherry-pick' : 'Revert', exact: true });
      await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
      await expect(confirm).toBeDisabled();
      await expect(select).toHaveValue('0: null');
      await expect(dialog).toContainText('Parent 1 is not selected automatically');
      await expect(dialog).toContainText('saved for recovery before execution');
      await expect(select).toHaveAttribute('aria-describedby', 'history-mainline-hint');
      await expect(select.locator('option').nth(parent)).toHaveAttribute('title', (parent === 1 ? 'a' : 'b').repeat(40));
      await select.selectOption({ index: parent });
      await expect(confirm).toBeEnabled();
      await page.evaluate(() => { (window as any).__mainline.refused = true; });
      await confirm.click();
      await expect(dialog.locator('.recovery-error')).toContainText('Hook refused replay');
      await expect(dialog.locator('.recovery-error')).toBeFocused();
      await expect(dialog).toContainText('A failed hook can leave applied changes staged');
      await expect(select.locator('option:checked')).toContainText(`Parent ${parent}`);
      await expect(dialog).toBeVisible();
      await page.evaluate(() => { (window as any).__mainline.refused = false; });
      await confirm.click();
      await expect(dialog).toHaveCount(0);
      const result = await page.evaluate(() => (window as any).__mainline);
      const calls = result.calls.filter((call: any) => ['cherry_pick_commits', 'revert_commit'].includes(call.command));
      expect(calls).toHaveLength(2);
      expect(calls[0]).toEqual({
        command: operation === 'cherry-pick' ? 'cherry_pick_commits' : 'revert_commit',
        args: { repoId: result.repoId, mainline: parent,
          ...(operation === 'cherry-pick' ? { oids: [result.oid], noCommit: false } : { oid: result.oid }) },
      });
      expect(calls[1]).toEqual(calls[0]);
    });
  }
}

test('merge parent confirmation keeps keyboard navigation and cancellation independent of execution', async ({ page }) => {
  await openReplay(page, 'cherry-pick');
  await page.setViewportSize({ width: 550, height: 700 });
  const dialog = page.getByRole('alertdialog');
  const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
  const select = dialog.getByLabel('Mainline parent (required)');
  await expect(cancel).toBeFocused();
  const bounds = await select.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.width).toBeGreaterThanOrEqual(24);
  expect(bounds!.height).toBeGreaterThanOrEqual(24);
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('checkbox', { name: 'Apply changes without creating commits' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(select).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('button', { name: 'Cherry-pick', exact: true })).toBeEnabled();
  await cancel.focus();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__mainline.calls
    .some((call: any) => ['cherry_pick_commits', 'revert_commit', 'checkout_branch'].includes(call.command)))).toBe(false);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openReplay(page, 'cherry-pick');
  await expect(dialog.getByRole('button', { name: 'Cherry-pick', exact: true })).toBeDisabled();
});

test('mixed cherry-pick selection containing a merge refuses a shared implicit mainline', async ({ page }) => {
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const fixture = (window as any).__mainline;
    app.openHistoryConfirmation({ kind: 'cherry-pick', oid: fixture.oid,
      oids: [app.git.repository().commits.find((commit: any) => commit.oid !== fixture.oid).oid, fixture.oid],
      label: 'Mixed selected commits' });
  });
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByRole('alert')).toContainText('Replay merge commits individually');
  await expect(dialog.getByLabel('Mainline parent (required)')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Cherry-pick 2 commits', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => (window as any).__mainline.calls
    .some((call: any) => ['cherry_pick_commits', 'revert_commit'].includes(call.command)))).toBe(false);
});

test('mainline reference selects the relevant official Git topic without executing replay or losing its choice', async ({ page }) => {
  await openReplay(page, 'revert');
  const confirmation = page.getByRole('alertdialog');
  const parent = confirmation.getByLabel('Mainline parent (required)');
  await parent.selectOption({ index: 2 });
  const opener = confirmation.getByRole('button', { name: 'Learn about merge mainline…', exact: true });
  await opener.click();
  const reference = page.getByRole('dialog', { name: 'Git command reference', exact: true });
  await expect(reference.locator('details[open]')).toContainText('Undo selected commits or a reviewed merge difference');
  await expect(reference.locator('details[open]')).toContainText('does not erase its ancestry');
  await expect(reference.locator('details[open] summary')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(reference).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(parent.locator('option:checked')).toContainText('Parent 2');
  expect(await page.evaluate(() => (window as any).__mainline.calls
    .some((call: any) => ['cherry_pick_commits', 'revert_commit', 'open_external_url'].includes(call.command)))).toBe(false);
});

test('inspector action reviews a searched merge outside the loaded graph instead of losing its parents', async ({ page }) => {
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const fixture = (window as any).__mainline;
    const commit = { ...app.git.repository().commits.find((commit: any) => commit.oid === fixture.oid),
      oid: 'c'.repeat(40), subject: 'Searched merge outside loaded graph' };
    fixture.oid = commit.oid;
    app.externalHistoryCommit.set(commit);
    app.selectedCommit.set(commit.oid);
    app.requestSelectedCommitCherryPick(commit);
  });
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Searched merge outside loaded graph');
  await dialog.getByLabel('Mainline parent (required)').selectOption({ index: 2 });
  await dialog.getByRole('button', { name: 'Cherry-pick', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__mainline.calls.find((call: any) => call.command === 'cherry_pick_commits').args))
    .toMatchObject({ oids: ['c'.repeat(40)], mainline: 2 });
});

test('repository change dismisses merge confirmation and cannot replay captured commits', async ({ page }) => {
  await openReplay(page, 'revert');
  await page.getByRole('alertdialog').getByLabel('Mainline parent (required)').selectOption({ index: 2 });
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const repository = app.git.repository();
    app.git.repositories.update((items: any[]) => [...items, { ...repository, id: 'other-mainline-repository' }]);
    app.git.activeRepositoryId.set('other-mainline-repository');
  });
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__mainline.calls
    .some((call: any) => ['cherry_pick_commits', 'revert_commit'].includes(call.command)))).toBe(false);
});

for (const returnBack of [false, true]) {
  test(`repository switch ${returnBack ? 'away and back' : 'away'} during target checkout invalidates the original review`, async ({ page }) => {
    await page.evaluate(() => {
      const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
      const fixture = (window as any).__mainline;
      fixture.deferCheckout = true;
      app.openHistoryConfirmation({ kind: 'cherry-pick', oid: fixture.oid, oids: [fixture.oid],
        label: 'Merge onto other branch', targetBranch: 'feature/partial-staging' });
    });
    const dialog = page.getByRole('alertdialog');
    await dialog.getByLabel('Mainline parent (required)').selectOption({ index: 1 });
    await dialog.getByRole('button', { name: 'Cherry-pick onto feature/partial-staging', exact: true }).click();
    await expect.poll(() => page.evaluate(() => !!(window as any).__mainline.resolveCheckout)).toBe(true);
    await page.evaluate(() => {
      const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
      const repository = app.git.repository();
      app.git.repositories.update((items: any[]) => [...items, { ...repository, id: 'other-mainline-repository' }]);
      app.git.activeRepositoryId.set('other-mainline-repository');
    });
    await expect(dialog).toHaveCount(0);
    await page.evaluate(returnBack => {
      const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
      if (returnBack) app.git.activeRepositoryId.set((window as any).__mainline.repoId);
      (window as any).__mainline.resolveCheckout();
    }, returnBack);
    await expect.poll(() => page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.busy())).toBe(false);
    expect(await page.evaluate(() => (window as any).__mainline.calls
      .some((call: any) => ['cherry_pick_commits', 'revert_commit'].includes(call.command)))).toBe(false);
  });
}
