import { expect, test } from '@playwright/test';

async function openReview(page: import('@playwright/test').Page) {
  await page.goto('/?clean-preview');
  const knownGood = page.locator('[data-commit-oid="7c17b9d37d6a36dc9477e611109136f86477041a"]');
  await knownGood.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Start bisect from here…' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Find the commit that introduced a problem' });
  await expect(dialog).toBeVisible();
  const expected = await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    const repository = git.repository();
    const pending = app.pendingBisectStart();
    const owned = { app, git, repository, calls: [] as unknown[] };
    (window as any).__bisectReview = owned;
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: unknown) => {
      if (command === 'start_bisect') owned.calls.push(args);
      if (command === 'refresh_repository_status') return Promise.resolve(git.repository().status);
      return Promise.resolve(git.repository());
    } };
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    return {
      repoId: repository.id,
      review: { badOid: pending.badOid, goodOid: pending.goodOid, branch: repository.status.branch },
    };
  });
  return { dialog, start: dialog.getByRole('button', { name: 'Start Bisect', exact: true }), expected };
}

for (const change of ['head', 'same-tip branch', 'tab revisit'] as const) {
  test(`start bisect refuses a stale review after a ${change} change`, async ({ page }) => {
    const { dialog, start } = await openReview(page);
    await start.evaluate((button: HTMLButtonElement, change) => {
      const { git, repository } = (window as any).__bisectReview;
      if (change === 'tab revisit') {
        const other = { ...repository, id: 'other-bisect-checkout', path: '/owned/bisect-other' };
        git.repositories.update((items: any[]) => [...items, other]);
        git.activateRepository(other.id);
        git.activateRepository(repository.id);
      } else {
        git.repositories.update((items: any[]) => items.map(item => item.id !== repository.id ? item :
          change === 'head' ? { ...item, headOid: 'b'.repeat(40) } :
            { ...item, status: { ...item.status, branch: 'same-tip-other-branch' } }));
      }
      // The old control can still be painted until Angular next renders.
      button.click();
    }, change);
    expect(await page.evaluate(() => (window as any).__bisectReview.calls)).toEqual([]);
    await expect(dialog).toContainText('The checkout changed. Close this review and choose the bisect range again.');
    await expect(start).toBeDisabled();
  });
}

test('start bisect sends exactly the two reviewed commits and checkout branch', async ({ page }) => {
  const { dialog, start, expected } = await openReview(page);
  await start.click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__bisectReview.calls)).toEqual([expected]);
});

async function openVote(page: import('@playwright/test').Page, noCheckout = false) {
  await page.goto('/?clean-preview');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  const expected = await page.evaluate(noCheckout => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    const repository = git.repository();
    const candidate = { oid: noCheckout ? 'd'.repeat(40) : repository.headOid, noCheckout };
    const owned = { app, git, calls: [] as unknown[], nextStatus: null as any };
    (window as any).__bisectVote = owned;
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: unknown) => {
      if (command === 'mark_bisect') owned.calls.push(args);
      return Promise.resolve(command === 'refresh_repository_status' ? owned.nextStatus ?? git.repository().status : git.repository());
    } };
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    git.repositories.update((items: any[]) => items.map(item => item.id === repository.id
      ? { ...item, status: { ...item.status, bisectInProgress: true, bisectCandidate: candidate } } : item));
    return { repoId: repository.id, verdict: 'good', candidate };
  }, noCheckout);
  const banner = page.getByRole('status', { name: 'Git bisect in progress' });
  await expect(banner).toBeVisible();
  return { banner, expected };
}

test('a no-checkout bisect displays and votes for BISECT_HEAD rather than HEAD', async ({ page }) => {
  const { banner, expected } = await openVote(page, true);
  await expect(banner).toContainText('Test commit ' + expected.candidate.oid.slice(0, 7));
  await expect(banner).toContainText('Checkout unchanged');
  await banner.getByRole('button', { name: 'Good', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__bisectVote.calls)).toEqual([expected]);
});

test('a retired bisect vote button does not classify a replacement candidate', async ({ page }) => {
  const { banner } = await openVote(page);
  await banner.getByRole('button', { name: 'Good', exact: true }).evaluate((button: HTMLButtonElement) => {
    const { git } = (window as any).__bisectVote;
    git.repositories.update((items: any[]) => items.map(item =>
      item.id === git.activeRepositoryId() ? { ...item, headOid: 'e'.repeat(40),
        status: { ...item.status, bisectCandidate: { oid: 'e'.repeat(40), noCheckout: false } } } : item));
    button.click();
  });
  expect(await page.evaluate(() => (window as any).__bisectVote.calls)).toEqual([]);
  await expect(banner).toContainText('Test commit eeeeeee');
});

test('a background refresh keeps a no-checkout candidate change even when HEAD does not move', async ({ page }) => {
  const { banner } = await openVote(page, true);
  await page.evaluate(async () => {
    const owned = (window as any).__bisectVote;
    owned.nextStatus = { ...owned.git.repository().status, bisectCandidate: { oid: 'f'.repeat(40), noCheckout: true } };
    await owned.git.refreshStatusInBackground();
  });
  await expect(banner).toContainText('Test commit fffffff');
});

test('an old palette action cannot vote after a different candidate appears', async ({ page }) => {
  await openVote(page, true);
  await page.getByRole('button', { name: 'Command palette', exact: true }).click();
  await page.getByRole('combobox', { name: 'Search commands', exact: true }).fill('Bisect Mark Current Commit Good');
  const action = page.getByRole('option', { name: /Bisect: Mark Current Commit Good/ });
  await expect(action).toContainText('ddddddd');
  await action.evaluate((button: HTMLElement) => {
    const { git } = (window as any).__bisectVote;
    git.repositories.update((items: any[]) => items.map(item => item.id === git.activeRepositoryId()
      ? { ...item, status: { ...item.status, bisectCandidate: { oid: 'e'.repeat(40), noCheckout: true } } } : item));
    button.click();
  });
  expect(await page.evaluate(() => (window as any).__bisectVote.calls)).toEqual([]);
});
