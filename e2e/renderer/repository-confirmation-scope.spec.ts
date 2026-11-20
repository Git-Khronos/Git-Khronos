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
  await expect(page.locator('#unstaged-files-list')).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    (window as any).__scopeCalls = [];
    (window as any).__scopeSource = { id: git.repository().id, path: git.repository().path };
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      (window as any).__scopeCalls.push({ command, args });
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
        app.openBranchConfirmation({ kind: 'delete', branch: branch.name + (replacement ? '-replacement' : '') });
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
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    app.sparseCheckoutPaths.set('unreviewed');
    app.sparseCheckoutIndex.set(false);
  });
  await modal.locator('.confirm-action').click();
  expect((await calls(page))[0].args).toMatchObject({ paths: ['src', 'vendor'], sparseIndex: true });
});

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
  await expect.poll(() => page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.busy())).toBe(false);
  await expect(page.locator('[role=alertdialog]')).toHaveCount(0);
  expect(await calls(page)).toHaveLength(1);
});

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
  await expect.poll(() => page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.busy())).toBe(false);
  await expect(page.locator('[role=alertdialog]')).toContainText('/owned/review-B');
  expect(await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).sparseCheckoutPaths())).toBe('replacement-only');
  expect(await calls(page)).toHaveLength(1);
});

for (const review of ['branch', 'worktree'] as const) {
  test(`${review} outgoing force checkbox cannot change a replacement review`, async ({ page }) => {
    await open(page, review);
    if (review === 'worktree') await page.evaluate(() => {
      const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
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
      const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
      return review === 'branch' ? app.forceBranchDelete() : app.forceWorktreeRemoval();
    }, review);
    expect(forced).toBe(false);
    expect(await calls(page)).toEqual([]);
  });
}

test('worktree force choice is captured before closing resets the review', async ({ page }) => {
  await open(page, 'worktree');
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const dirty = { ...app.git.repository().worktrees.find((tree: any) => tree.path === '/owned/reviewed'), changes: 2 };
    app.requestWorktreeRemoval(dirty, false);
  });
  await page.locator('[role=alertdialog] input[type=checkbox]').check();
  await page.locator('[role=alertdialog] .confirm-action').click();
  expect((await calls(page))[0].args).toMatchObject({ path: '/owned/reviewed', force: true });
});
