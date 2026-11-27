import { expect, test, type Page } from '@playwright/test';

type Review = 'branch' | 'sparse-set' | 'sparse-disable' | 'worktree';
const reviews: Review[] = ['branch', 'sparse-set', 'sparse-disable', 'worktree'];
const mutations = ['delete_branch', 'sparse_checkout_set', 'sparse_checkout_disable', 'remove_worktree'];

async function open(page: Page, review: Review) {
  await page.evaluate(review => (window as any).__openScopedReview(review), review);
  const modal = page.locator('[role=alertdialog]').last();
  await expect(modal).toBeVisible();
  const source = await page.evaluate(() => (window as any).__scopeSource);
  await expect(modal).toContainText(source.path);
  return modal;
}

async function calls(page: Page) {
  return page.evaluate(mutations => (window as any).__scopeCalls.filter((call: any) => mutations.includes(call.command)), mutations);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gk-app'));
    const git = app.git;
    (window as any).__scopeCalls = [];
    (window as any).__scopeSource = { id: git.repository().id, path: git.repository().path };
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      (window as any).__scopeCalls.push({ command, args });
      if (command === 'refresh_repository' && (window as any).__holdBranchRefresh) {
        return new Promise(resolve => {
          (window as any).__resolveBranchRefresh = () => resolve(git.repository());
        });
      }
      if (command === 'refresh_repository_status' && (window as any).__holdBranchRefresh) {
        return Promise.resolve(git.repository().status);
      }
      if ((window as any).__holdScope === command) return new Promise((resolve, reject) => {
        const snapshot = git.repositories().find((item: any) => item.id === args.repoId);
        (window as any).__resolveScope = () => resolve(snapshot);
        (window as any).__rejectScope = () => reject({ kind: 'branchNotMerged', message: 'Owned unmerged branch' });
      });
      return Promise.reject({ kind: 'ownedProbeRefusal', message: 'Fixture refuses native dispatch' });
    } };
    (window as any).__openScopedReview = (review: string, replacement = false) => {
      const repository = git.repository();
      if (review === 'branch') {
        const branch = repository.branches.find((item: any) => !item.current && !item.remote);
        app.openBranchConfirmation({ kind: 'delete', branch: branch.name + (replacement ? '-replacement' : ''), expectedOid: branch.oid });
      } else if (review.startsWith('sparse')) {
        app.sparseCheckoutPaths.set(replacement ? 'replacement-only' : 'src\nvendor');
        app.sparseCheckoutIndex.set(!replacement);
        if (review === 'sparse-set') app.requestSparseCheckoutUpdate();
        else app.requestSparseCheckoutDisable();
      } else {
        const candidate = { ...repository.worktrees[0], path: replacement ? '/owned/replacement' : '/owned/reviewed',
          branch: replacement ? 'replacement' : 'reviewed', current: false, prunable: false, changes: 0 };
        git.repositories.update((items: any[]) => items.map(item => item.id === repository.id
          ? { ...item, worktrees: [...item.worktrees.filter((tree: any) => tree.path !== candidate.path), candidate] } : item));
        app.requestWorktreeRemoval(candidate, false);
      }
    };
    (window as any).__changeScope = (kind: string) => {
      const repository = git.repository();
      if (kind === 'repository') {
        const other = { ...repository, id: 'owned-review-B', path: '/owned/review-B' };
        git.repositories.update((items: any[]) => [...items, other]);
        git.activeRepositoryId.set(other.id);
      } else git.repositories.update((items: any[]) => items.map(item => item.id === repository.id
        ? { ...item, path: '/owned/same-id-replacement' } : item));
    };
  });
});

for (const force of [false, true]) {
  test(`branch delete refuses a moved tip with force=${force}`, async ({ page }) => {
    const branch = page.getByRole('button', { name: 'Local branch feature/partial-staging', exact: true }).first();
    await branch.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete branch…', exact: true }).click();
    const modal = page.getByRole('alertdialog', { name: 'feature/partial-staging' });
    await expect(modal).toBeVisible();
    if (force) await modal.getByRole('checkbox', { name: /Force delete/ }).check();
    await page.evaluate(() => {
      const app = (window as any).ng.getComponent(document.querySelector('gk-app'));
      const selected = app.git.repository();
      app.git.repositories.update((items: any[]) => items.map(item => item.id !== selected.id ? item : {
        ...item, branches: item.branches.map((branch: any) =>
          branch.name === 'feature/partial-staging' ? { ...branch, oid: 'd'.repeat(40) } : branch),
      }));
    });
    await modal.getByRole('button', { name: 'Delete branch', exact: true }).click();
    expect(await calls(page)).toEqual([]);
    await expect(page.locator('.error-toast')).toContainText('Open the branch menu again');
  });
}

for (const review of reviews) {
  for (const change of ['repository', 'path']) {
    test(`${review} rejects a pre-effect ${change} change`, async ({ page }) => {
      const modal = await open(page, review);
      await page.evaluate(change => {
        const confirm = document.querySelector<HTMLButtonElement>('[role=alertdialog] .confirm-action')!;
        (window as any).__changeScope(change);
        confirm.click();
      }, change);
      expect(await calls(page)).toEqual([]);
      await expect(modal).not.toBeVisible();
    });
  }

  test(`${review} valid confirmation retains its original repoId`, async ({ page }) => {
    const modal = await open(page, review);
    await modal.locator('.confirm-action').click();
    const actual = await calls(page);
    expect(actual).toHaveLength(1);
    const source = await page.evaluate(() => (window as any).__scopeSource);
    expect(actual[0].args.repoId).toBe(source.id);
    if (review === 'branch') expect(actual[0].args.expectedOid).toMatch(/^[0-9a-f]{40}$/);
    if (review === 'sparse-set') expect(actual[0].args).toMatchObject({ paths: ['src', 'vendor'], sparseIndex: true });
    if (review === 'worktree') expect(actual[0].args).toMatchObject({ path: '/owned/reviewed', deleteBranch: false, force: false });
  });

  for (const action of ['confirm', 'cancel']) {
    test(`${review} outgoing ${action} cannot consume a replacement review`, async ({ page }) => {
      await open(page, review);
      await page.evaluate(({ review, action }) => {
        const outgoing = document.querySelector<HTMLButtonElement>(action === 'confirm'
          ? '[role=alertdialog] .confirm-action' : '[role=alertdialog] footer button')!;
        (window as any).__openScopedReview(review, true);
        outgoing.click();
      }, { review, action });
      expect(await calls(page)).toEqual([]);
      await expect(page.locator('[role=alertdialog]')).toBeVisible();
    });
  }
}

test('sparse selection and sparse-index setting are captured when review opens', async ({ page }) => {
  const modal = await open(page, 'sparse-set');
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gk-app'));
    app.sparseCheckoutPaths.set('unreviewed');
    app.sparseCheckoutIndex.set(false);
  });
  await modal.locator('.confirm-action').click();
  expect((await calls(page))[0].args).toMatchObject({ paths: ['src', 'vendor'], sparseIndex: true });
});

for (const switchRepository of [false, true]) {
  test(`outgoing sparse Back to Edit cannot consume the replacement review (switch=${switchRepository})`, async ({ page }) => {
    const modal = await open(page, 'sparse-set');
    await modal.getByRole('button', { name: 'Back to Edit' }).evaluate((outgoing: HTMLButtonElement, switchRepository) => {
      if (switchRepository) (window as any).__changeScope('repository');
      (window as any).__openScopedReview('sparse-set', true);
      outgoing.click();
    }, switchRepository);

    await expect(modal.getByRole('list', { name: 'Selected directories' })).toHaveText('replacement-only');
    await expect(page.getByRole('dialog', { name: 'Preferences' })).toHaveCount(0);
    expect(await calls(page)).toEqual([]);
    await modal.getByRole('button', { name: 'Back to Edit' }).click();
    const editor = page.getByLabel('Sparse checkout directories');
    await expect(editor).toBeFocused();
    await expect(editor).toHaveValue('replacement-only');
    expect(await calls(page)).toEqual([]);
  });
}

for (const [review, action] of [
  ['sparse-set', 'Apply Selection'], ['sparse-set', 'Back to Edit'], ['sparse-disable', 'Restore All Files'],
  ['worktree', 'Remove worktree'],
  ['branch', 'Delete branch'],
] as const) {
  test(`returning to a checkout cannot reuse the previous review: ${review} / ${action}`, async ({ page }) => {
    const modal = await open(page, review);
    await modal.getByRole('button', { name: action }).evaluate((outgoing: HTMLButtonElement) => {
      const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
      const original = git.repository();
      const next = { ...original, id: 'other', path: '/owned/other' };
      git.repositories.update((items: any[]) => [...items, next]);
      git.activateRepository(next.id);
      git.activateRepository(original.id);
      outgoing.click();
    });
    expect(await calls(page)).toEqual([]);
    await expect(modal).toBeHidden();
    await expect(page.getByRole('dialog', { name: 'Preferences' })).toHaveCount(0);
  });
}

for (const revisit of [false, true]) {
  test(`dismissed review restores focus only in the same checkout visit (revisit=${revisit})`, async ({ page }) => {
    await page.evaluate(() => {
      const opener = document.createElement('button');
      opener.textContent = 'Owned review opener';
      document.body.append(opener);
      opener.focus();
      (window as any).__openScopedReview('branch');
    });
    const modal = page.getByRole('alertdialog');
    await expect(modal).toBeVisible();
    await modal.getByRole('button', { name: 'Cancel', exact: true }).evaluate((cancel, revisit) => {
      (cancel as HTMLButtonElement).focus();
      (cancel as HTMLButtonElement).click();
      if (!revisit) return;
      const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
      const original = git.repository();
      const next = { ...original, id: 'focus-other', path: '/owned/focus-other' };
      git.repositories.update((items: any[]) => [...items, next]);
      git.activateRepository(next.id);
      git.activateRepository(original.id);
    }, revisit);
    await expect(modal).toBeHidden();
    const opener = page.getByRole('button', { name: 'Owned review opener', exact: true });
    if (revisit) await expect(opener).not.toBeFocused();
    else await expect(opener).toBeFocused();
  });
}

for (const change of ['revisit', 'replacement'] as const) {
  test(`a history confirmation cannot dispatch after ${change}`, async ({ page }) => {
    await page.evaluate(() => {
      const app = (window as any).ng.getComponent(document.querySelector('gk-app'));
      const oid = app.git.repository().commits.find((commit: any) => commit.parents.length < 2).oid;
      (window as any).__historyCalls = [];
      app.git.cherryPick = (...args: unknown[]) => (window as any).__historyCalls.push(args);
      app.openHistoryConfirmation({ kind: 'cherry-pick', oid, oids: [oid], label: 'Original history review' });
    });
    const dialog = page.locator('gk-history-review-dialog');
    const confirm = dialog.getByRole('button', { name: 'Cherry-pick', exact: true });
    await expect(confirm).toBeEnabled();
    await confirm.evaluate((button, change) => {
      const app = (window as any).ng.getComponent(document.querySelector('gk-app'));
      const git = app.git, original = git.repository();
      if (change === 'revisit') {
        const other = { ...original, id: 'other-history', path: '/owned/other-history' };
        git.repositories.update((items: any[]) => [...items, other]);
        git.activateRepository(other.id);
        git.activateRepository(original.id);
      } else {
        const { oid } = app.pendingHistoryAction();
        app.openHistoryConfirmation({ kind: 'cherry-pick', oid, oids: [oid], label: 'Replacement history review' });
      }
      (button as HTMLButtonElement).click();
    }, change);
    expect(await page.evaluate(() => (window as any).__historyCalls)).toEqual([]);
    if (change === 'revisit') await expect(dialog).toBeHidden();
    else {
      await expect(dialog).toContainText('Replacement history review');
      await confirm.click();
      expect(await page.evaluate(() => (window as any).__historyCalls)).toHaveLength(1);
    }
  });
}

test('an old unmerged-branch result cannot replace a newer review', async ({ page }) => {
  const modal = await open(page, 'branch');
  await page.evaluate(() => (window as any).__holdScope = 'delete_branch');
  await modal.locator('.confirm-action').click();
  await expect.poll(async () => (await calls(page)).length).toBe(1);
  await page.evaluate(() => (window as any).__openScopedReview('branch', true));
  await page.evaluate(() => (window as any).__rejectScope());
  await expect(page.locator('[role=alertdialog] h2')).toContainText('-replacement');
  await expect(page.getByRole('button', { name: 'Delete anyway', exact: true })).toHaveCount(0);
});

test('closing a busy branch review does not replay or reopen its late unmerged refusal', async ({ page }) => {
  const modal = await open(page, 'branch');
  await page.evaluate(() => (window as any).__holdScope = 'delete_branch');
  await modal.locator('.confirm-action').click();
  await expect.poll(async () => (await calls(page)).length).toBe(1);
  await expect(modal.locator('input[type=checkbox]')).toBeDisabled();
  await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.evaluate(() => (window as any).__rejectScope());
  await expect.poll(() => page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gk-app')).git.busy())).toBe(false);
  await expect(page.locator('[role=alertdialog]')).toHaveCount(0);
  expect(await calls(page)).toHaveLength(1);
});

for (const newerError of [null, 'An unrelated action reported a later error.']) {
  test(`branch deletion uses its own refusal when shared error is ${newerError ? 'replaced' : 'cleared'}`, async ({ page }) => {
    const modal = await open(page, 'branch');
    await page.evaluate(() => {
      (window as any).__holdScope = 'delete_branch';
      (window as any).__holdBranchRefresh = true;
    });
    await modal.locator('.confirm-action').click();
    await expect.poll(async () => (await calls(page)).length).toBe(1);
    await page.evaluate(() => (window as any).__rejectScope());
    await expect.poll(() => page.evaluate(() => typeof (window as any).__resolveBranchRefresh)).toBe('function');
    await page.evaluate(newerError => {
      const git = (window as any).ng.getComponent(document.querySelector('gk-app')).git;
      git.error.set(newerError);
      (window as any).__resolveBranchRefresh();
    }, newerError);
    await expect(modal.getByRole('button', { name: 'Delete anyway', exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gk-app')).git.error()))
      .toBe(newerError);
    expect(await calls(page)).toHaveLength(1);
  });
}

test('late sparse completion preserves a newer repository review and its draft', async ({ page }) => {
  const modal = await open(page, 'sparse-set');
  await page.evaluate(() => (window as any).__holdScope = 'sparse_checkout_set');
  await modal.locator('.confirm-action').click();
  await expect.poll(async () => (await calls(page)).length).toBe(1);
  await page.evaluate(() => {
    (window as any).__changeScope('repository');
    (window as any).__openScopedReview('sparse-set', true);
  });
  await expect(page.locator('[role=alertdialog]')).toContainText('/owned/review-B');
  await page.evaluate(() => (window as any).__resolveScope());
  await expect.poll(() => page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gk-app')).git.busy())).toBe(false);
  await expect(page.locator('[role=alertdialog]')).toContainText('/owned/review-B');
  expect(await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gk-app')).sparseCheckoutPaths())).toBe('replacement-only');
  expect(await calls(page)).toHaveLength(1);
});

for (const review of ['branch', 'worktree'] as const) {
  test(`${review} outgoing force checkbox cannot change a replacement review`, async ({ page }) => {
    await open(page, review);
    if (review === 'worktree') await page.evaluate(() => {
      const app = (window as any).ng.getComponent(document.querySelector('gk-app'));
      const dirty = { ...app.git.repository().worktrees.find((tree: any) => tree.path === '/owned/reviewed'), changes: 2 };
      app.requestWorktreeRemoval(dirty, false);
    });
    await expect(page.locator('[role=alertdialog] input[type=checkbox]')).toBeVisible();
    await page.evaluate(review => {
      const input = document.querySelector<HTMLInputElement>('[role=alertdialog] input[type=checkbox]')!;
      (window as any).__openScopedReview(review, true);
      input.checked = true;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, review);
    const forced = await page.evaluate(review => {
      const app = (window as any).ng.getComponent(document.querySelector('gk-app'));
      return review === 'branch' ? app.forceBranchDelete() : app.forceWorktreeRemoval();
    }, review);
    expect(forced).toBe(false);
    expect(await calls(page)).toEqual([]);
  });
}

test('worktree force choice is captured before closing resets the review', async ({ page }) => {
  await open(page, 'worktree');
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gk-app'));
    const dirty = { ...app.git.repository().worktrees.find((tree: any) => tree.path === '/owned/reviewed'), changes: 2 };
    app.requestWorktreeRemoval(dirty, false);
  });
  await page.locator('[role=alertdialog] input[type=checkbox]').check();
  await page.locator('[role=alertdialog] .confirm-action').click();
  expect((await calls(page))[0].args).toMatchObject({ path: '/owned/reviewed', force: true });
});
