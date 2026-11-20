import { expect, test, type Page } from '@playwright/test';

type Review = 'publish' | 'force' | 'lfs' | 'retention';
const reviews: Review[] = ['publish', 'force', 'lfs', 'retention'];
const writes = ['publish_branch', 'force_push_repository', 'lfs_prune_objects', 'lfs_prune'];

async function open(page: Page, review: Review) {
  await page.evaluate(review => (window as any).__openRemoteReview(review), review);
  const modal = page.locator('[aria-modal=true]').last();
  await expect(modal).toBeVisible();
  if (review === 'lfs' || review === 'retention') {
    await expect(modal.getByRole('list', { name: 'Reviewed unreferenced LFS objects' })).toBeVisible();
    if (review === 'retention') await modal.locator('summary').click();
  }
  return modal;
}

function selector(review: Review) {
  return review === 'retention' ? '[aria-modal=true] .lfs-retention-prune button' : '[aria-modal=true] .confirm-action';
}

async function calls(page: Page) {
  return page.evaluate(writes => (window as any).__remoteReviewCalls.filter((entry: any) => writes.includes(entry.command)), writes);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'remote review boundary test' }));
    git.repositories.update((items: any[]) => items.map(item => ({ ...item,
      lfs: { available: true, enabled: true, version: 'git-lfs/3.7.1', trackedFiles: 2 } })));
    (window as any).__remoteReviewCalls = [];
    (window as any).__previewReplies = [];
    (window as any).__preview = (letter = 'a') => ({ objects: [{ oid: letter.repeat(64), size: 2048 }],
      totalSize: 2048, remaining: 0, referenced: 1, recent: 0 });
    (window as any).__sourceId = git.repository().id;
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      (window as any).__remoteReviewCalls.push({ command, args });
      if (command === 'lfs_prune_preview') {
        if ((window as any).__holdPreviews) return new Promise((resolve, reject) => {
          (window as any).__previewReplies.push({ resolve: (letter: string) => resolve((window as any).__preview(letter)),
            reject: () => reject({ kind: 'unsafeLfsPrune', message: 'Owned obsolete preview refusal' }) });
        });
        return Promise.resolve((window as any).__preview());
      }
      return Promise.resolve(git.repositories().find((item: any) => item.id === args?.repoId) ?? null);
    } };
    (window as any).__openRemoteReview = (review: Review) => {
      if (review === 'publish') {
        const repository = git.repository();
        git.repositories.update((items: any[]) => items.map(item => item.id === repository.id ? { ...item,
          branches: item.branches.map((branch: any) => branch.current ? { ...branch, upstream: null } : branch) } : item));
        app.pushCurrentBranch();
      } else if (review === 'force') app.requestForcePush();
      else app.requestLfsPrune();
    };
    (window as any).__changeRemoteScope = (kind: string) => {
      const repository = git.repository();
      if (kind === 'repository') {
        const other = { ...repository, id: 'owned-remote-review-B', path: '/owned/remote-review-B' };
        git.repositories.update((items: any[]) => [...items, other]);
        git.activeRepositoryId.set(other.id);
      } else git.repositories.update((items: any[]) => items.map(item => item.id === repository.id
        ? { ...item, path: '/owned/replaced-source-path' } : item));
    };
  });
});

for (const review of reviews) {
  for (const change of ['repository', 'path']) {
    test(`${review} refuses an outgoing confirmation after a ${change} switch`, async ({ page }) => {
      const modal = await open(page, review);
      await page.evaluate(({ change, control }) => {
        const button = document.querySelector<HTMLButtonElement>(control)!;
        (window as any).__changeRemoteScope(change);
        button.click();
      }, { change, control: selector(review) });
      expect(await calls(page)).toEqual([]);
      await expect(modal).not.toBeVisible();
    });
  }

  test(`${review} valid confirmation keeps its reviewed repository`, async ({ page }) => {
    await open(page, review);
    const force = review === 'force' ? await page.evaluate(() => {
      const review = (window as any).ng.getComponent(document.querySelector('gc-root')).pendingForcePush();
      return { remote: review.remote, branch: review.remoteBranch,
        expectedRemoteOid: review.expectedRemoteOid, expectedHeadOid: review.expectedHeadOid };
    }) : null;
    await page.locator(selector(review)).click();
    const actual = await calls(page);
    expect(actual).toHaveLength(1);
    expect(actual[0].args.repoId).toBe(await page.evaluate(() => (window as any).__sourceId));
    if (review === 'force') expect(actual[0].args).toMatchObject(force!);
    if (review === 'lfs') expect(actual[0].args.preview.objects[0].oid).toBe('a'.repeat(64));
  });

  for (const action of ['confirm', 'cancel']) {
    test(`${review} obsolete ${action} cannot consume a replacement`, async ({ page }) => {
      await open(page, review);
      await page.evaluate(({ review, action, control }) => {
        const outgoing = action === 'confirm' ? document.querySelector<HTMLButtonElement>(control)!
          : [...document.querySelectorAll<HTMLButtonElement>('[aria-modal=true] footer button')].find(button => button.textContent?.trim() === 'Cancel')!;
        (window as any).__openRemoteReview(review);
        outgoing.click();
      }, { review, action, control: selector(review) });
      expect(await calls(page)).toEqual([]);
      await expect(page.locator('[aria-modal=true]')).toBeVisible();
    });
  }
}

test('an obsolete publish selector cannot change a replacement draft', async ({ page }) => {
  await open(page, 'publish');
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const outgoing = document.querySelector<HTMLSelectElement>('[name=publishRemote]')!;
    (window as any).__openRemoteReview('publish');
    app.publishRemote.set('replacement-choice');
    outgoing.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).publishRemote())).toBe('replacement-choice');
});

for (const outcome of ['success', 'failure']) {
  test(`an old LFS preview ${outcome} cannot overwrite or close a newer review`, async ({ page }) => {
    await page.evaluate(() => (window as any).__holdPreviews = true);
    await page.evaluate(() => (window as any).__openRemoteReview('lfs'));
    await expect.poll(() => page.evaluate(() => (window as any).__previewReplies.length)).toBe(1);
    await page.evaluate(() => (window as any).__openRemoteReview('lfs'));
    await expect.poll(() => page.evaluate(() => (window as any).__previewReplies.length)).toBe(2);
    await page.evaluate(() => (window as any).__previewReplies[1].resolve('b'));
    await expect(page.locator('.lfs-prune-list')).toContainText('bbbbbbbbbbbb');
    await page.evaluate(outcome => outcome === 'success' ? (window as any).__previewReplies[0].resolve('a')
      : (window as any).__previewReplies[0].reject(), outcome);
    await expect.poll(() => page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.busy())).toBe(false);
    await expect(page.locator('.lfs-prune-list')).toContainText('bbbbbbbbbbbb');
    expect(await calls(page)).toEqual([]);
  });
}

test('an old preview finally block cannot end a newer LFS loading state', async ({ page }) => {
  await page.evaluate(() => (window as any).__holdPreviews = true);
  await page.evaluate(() => (window as any).__openRemoteReview('lfs'));
  await page.evaluate(() => (window as any).__openRemoteReview('lfs'));
  await expect.poll(() => page.evaluate(() => (window as any).__previewReplies.length)).toBe(2);
  await page.evaluate(() => (window as any).__previewReplies[0].resolve('a'));
  await expect.poll(() => page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).lfsPruneReviewing())).toBe(true);
  expect(await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).lfsPrunePreview())).toBeNull();
  await page.evaluate(() => (window as any).__previewReplies[1].resolve('b'));
  await expect(page.locator('.lfs-prune-list')).toContainText('bbbbbbbbbbbb');
});

test('LFS preview arrival does not steal focus from the advanced section', async ({ page }) => {
  await page.evaluate(() => (window as any).__holdPreviews = true);
  await page.evaluate(() => (window as any).__openRemoteReview('lfs'));
  const summary = page.locator('gc-lfs-prune-dialog summary');
  await summary.click();
  await expect(summary).toBeFocused();
  await page.evaluate(() => (window as any).__previewReplies[0].resolve('a'));
  await expect(page.locator('.lfs-prune-list')).toBeVisible();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(summary).toBeFocused();
});

for (const change of ['repository', 'replacement']) {
  test(`an outgoing Add Remote action cannot consume a ${change} publish review`, async ({ page }) => {
    await page.evaluate(() => {
      const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
      git.repositories.update((items: any[]) => items.map(item => ({ ...item, remotes: [] })));
    });
    const modal = await open(page, 'publish');
    await expect(modal.getByRole('button', { name: 'Add Remote', exact: true })).toBeVisible();
    await page.evaluate(change => {
      const outgoing = document.querySelector<HTMLButtonElement>('.publish-empty button')!;
      if (change === 'repository') (window as any).__changeRemoteScope(change);
      else (window as any).__openRemoteReview('publish');
      outgoing.click();
    }, change);
    await expect(page.getByRole('dialog', { name: 'Add Remote', exact: true })).toHaveCount(0);
    if (change === 'replacement') await expect(page.getByRole('dialog', { name: /Publish / })).toBeVisible();
    expect(await calls(page)).toEqual([]);
  });
}

test('a valid Add Remote handoff retains its publish source checkout', async ({ page }) => {
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    git.repositories.update((items: any[]) => items.map(item => ({ ...item, remotes: [] })));
  });
  const modal = await open(page, 'publish');
  await modal.getByRole('button', { name: 'Add Remote', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Add Remote', exact: true });
  await expect(editor).toBeVisible();
  const owner = await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    return app.remoteEditorOwner();
  });
  expect(owner.repositoryId).toBe(await page.evaluate(() => (window as any).__sourceId));
  await expect(editor).toContainText(owner.repositoryPath);
  expect(await calls(page)).toEqual([]);
});
