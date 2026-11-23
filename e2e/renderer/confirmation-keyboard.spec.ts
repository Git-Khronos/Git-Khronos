import { expect, test, type Page } from '@playwright/test';

const reviews = ['force-push', 'worktree-removal', 'sparse', 'publish', 'workspace-delete',
  'lfs-prune', 'file', 'branch', 'stored-reference', 'bisect', 'history'] as const;
type Review = typeof reviews[number];

async function openReview(page: Page, review: Review, gap = false) {
  await page.evaluate(({ review, gap }) => {
    const app = (window as any).ng.getComponent(document.querySelector('gk-app'));
    const repository = app.git.repository();
    const oid = repository.commits[0].oid;
    (window as any).__confirmationIntents = [];
    const record = (name: string) => () => (window as any).__confirmationIntents.push(name);
    for (const name of ['commit', 'stageAllAndCommit', 'openCommandPalette', 'closeRepository',
      'confirmForcePush', 'confirmWorktreeRemoval', 'confirmSparseCheckoutAction', 'confirmPublishBranch',
      'confirmWorkspaceDelete', 'confirmLfsPrune', 'confirmLfsRetentionPrune', 'confirmFileAction',
      'confirmBranchAction', 'confirmStoredReferenceDelete', 'confirmBisectStart', 'confirmHistoryAction']) app[name] = record(name);
    for (const name of ['stageAll', 'unstageAll', 'stagePath', 'unstagePath', 'undo', 'redo']) app.git[name] = record(name);
    app.git.undoLabel = () => 'Owned undo';
    app.git.redoLabel = () => 'Owned redo';
    app.changesOpen.set(true);
    const requests: Record<Review, [string, any]> = {
      'force-push': ['pendingForcePush', { repositoryId: repository.id, repositoryPath: repository.path, returnFocus: null,
        branchRef: 'refs/heads/dev', branchName: 'dev',
        remote: 'origin', remoteBranch: 'refs/heads/dev', expectedRemoteOid: oid, expectedHeadOid: oid }],
      'worktree-removal': ['pendingWorktreeAction', { repositoryId: repository.id, repositoryPath: repository.path, returnFocus: null,
        path: '/owned/checkout', branch: 'owned-review', deleteBranch: false, changes: 0 }],
      sparse: ['pendingSparseCheckoutReview', { repositoryId: repository.id, repositoryPath: repository.path, returnFocus: null,
        action: 'disable', paths: [], sparseIndex: false }],
      publish: ['pendingPublishBranch', { repositoryId: repository.id, repositoryPath: repository.path, returnFocus: null, branch: repository.status.branch }],
      'workspace-delete': ['pendingWorkspaceDelete', { id: 'owned-review', name: 'Owned workspace' }],
      'lfs-prune': ['lfsPruneReview', { repositoryId: repository.id, repositoryPath: repository.path, returnFocus: null }],
      file: ['pendingFileAction', { kind: 'ignore', path: 'owned.txt', untracked: true, patternKind: 'extension', repositoryId: repository.id }],
      branch: ['pendingBranchAction', { repositoryId: repository.id, repositoryPath: repository.path, returnFocus: null,
        kind: 'delete', branch: 'owned-review', expectedOid: oid }],
      'stored-reference': ['pendingStoredReferenceDelete', { kind: 'original', repoId: repository.id, repositoryPath: repository.path,
        repositoryVisit: app.git.activeRepositoryReadScope(), reference: 'refs/original/owned-review', oid, returnFocus: null }],
      bisect: ['pendingBisectStart', { checkoutScope: app.git.activeRepositoryReadScope(), repositoryId: repository.id,
        repositoryPath: repository.path, branch: repository.status.branch, goodOid: repository.commits[1].oid,
        goodLabel: 'Known good', badOid: repository.headOid, badLabel: 'Known bad' }],
      history: ['pendingHistoryAction', { kind: 'cherry-pick', oid, oids: [oid], label: 'Owned commit' }],
    };
    app.publishRemote.set('origin');
    if (review === 'force-push') app.forcePushDestination.set({ state: 'd'.repeat(64), destinations: ['Owned destination fixture'] });
    const [signal, request] = requests[review];
    (window as any).__confirmationSignal = signal;
    // The file review must capture the real checkout identity and wait for
    // its deferred details. A manually seeded signal is intentionally stale.
    if (review === 'file') app.openFileConfirmation(request);
    else app[signal].set(request);
    if (gap) {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true, cancelable: true }));
    }
  }, { review, gap });
  const modal = page.locator('[aria-modal=true]').last();
  await expect(modal).toBeVisible();
  return modal;
}

async function intents(page: Page) {
  return page.evaluate(() => (window as any).__confirmationIntents as string[]);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible();
});

for (const review of reviews) {
  test(`${review} keeps background commands out of its confirmation`, async ({ page }) => {
    const modal = await openReview(page, review);
    await modal.getByRole('button', { name: 'Cancel', exact: true }).focus();
    for (const key of ['Control+Enter', 'Control+Shift+Enter', 'Control+p', 'Control+Shift+s', 'Control+z', 'Control+y']) {
      await page.keyboard.press(key);
    }
    expect(await intents(page)).toEqual([]);
    await expect(modal).toBeVisible();
  });

  test(`${review} owns the pre-render keyboard gap`, async ({ page }) => {
    await openReview(page, review, true);
    expect(await intents(page)).toEqual([]);
  });

  test(`${review} dismissal retires keyboard ownership before the next render`, async ({ page }) => {
    const modal = await openReview(page, review);
    await modal.getByRole('button', { name: 'Cancel', exact: true }).focus();
    await page.evaluate(() => {
      const app = (window as any).ng.getComponent(document.querySelector('gk-app'));
      const target = document.activeElement!;
      const signal = (window as any).__confirmationSignal;
      app[signal].set(null);
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true, cancelable: true }));
    });
    expect(await intents(page)).toEqual(['openCommandPalette']);
  });

  test(`${review} keeps Tab in the review and Escape dismisses it`, async ({ page }) => {
    const modal = await openReview(page, review);
    const controls = modal.locator('button:visible:not(:disabled), input:visible:not(:disabled), select:visible:not(:disabled), summary:visible, [tabindex="0"]:visible');
    await controls.last().focus();
    await page.keyboard.press('Tab');
    await expect(controls.first()).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(controls.last()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
    expect(await intents(page)).toEqual([]);
  });

  if (review === 'force-push' || review === 'file' || review === 'history') {
    test(`${review} plain Enter still activates its explicit confirmation`, async ({ page }) => {
      const modal = await openReview(page, review);
      const confirm = modal.locator('button.confirm-action');
      await expect(confirm).toBeEnabled();
      await confirm.focus();
      await page.keyboard.press('Enter');
      expect(await intents(page)).toEqual([review === 'force-push' ? 'confirmForcePush'
        : review === 'file' ? 'confirmFileAction' : 'confirmHistoryAction']);
    });
  }
}
