import { expect, test } from '@playwright/test';

async function openReview(page: import('@playwright/test').Page, dirty = false) {
  await page.goto(dirty ? '/' : '/?clean-preview');
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
      review: { badOid: pending.badOid, goodOid: pending.goodOid, branch: repository.status.branch, noCheckout: false },
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

test('start bisect on a dirty checkout requires an explicit no-checkout choice', async ({ page }) => {
  const { dialog, start, expected } = await openReview(page, true);
  const keep = dialog.getByRole('checkbox', { name: 'Keep current checkout' });
  await expect(keep).not.toBeChecked();
  await expect(start).toBeDisabled();
  await expect(dialog).toContainText('Git needs a clean working tree to switch commits.');
  await keep.check();
  await expect(start).toBeEnabled();
  await expect(dialog).toContainText('Git records each candidate without checking it out.');
  await keep.uncheck();
  await expect(start).toBeDisabled();
  await keep.check();
  await start.click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__bisectReview.calls)).toEqual([
    { ...expected, review: { ...expected.review, noCheckout: true } },
  ]);
});

test('start bisect rechecks the switch mode when new edits arrive before repaint', async ({ page }) => {
  const { dialog, start } = await openReview(page);
  await expect(start).toBeEnabled();
  await start.evaluate((button: HTMLButtonElement) => {
    const { git, repository } = (window as any).__bisectReview;
    git.repositories.update((items: any[]) => items.map(item => item.id === repository.id
      ? { ...item, status: { ...item.status, entryCount: 1 } } : item));
    button.click();
  });
  await expect(dialog).toBeVisible();
  await expect(start).toBeDisabled();
  expect(await page.evaluate(() => (window as any).__bisectReview.calls)).toEqual([]);
});

test('no-checkout bisect preview keeps HEAD and files unchanged through voting and reset', async ({ page }) => {
  await page.goto('/');
  const current = () => page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const { headOid, status } = app.git.repository();
    return { headOid, branch: status.branch, entries: status.entries };
  });
  const knownGood = page.locator('[data-commit-oid="7c17b9d37d6a36dc9477e611109136f86477041a"]');
  await knownGood.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Start bisect from here…' }).click();
  const checkout = await current();
  expect(checkout.entries.length).toBeGreaterThan(0);
  const dialog = page.getByRole('alertdialog', { name: 'Find the commit that introduced a problem' });
  await dialog.getByRole('checkbox', { name: 'Keep current checkout' }).check();
  await dialog.getByRole('button', { name: 'Start Bisect' }).click();
  const banner = page.getByRole('status', { name: 'Git bisect in progress' });
  await expect(banner).toContainText('Checkout unchanged.');
  const first = await banner.locator('small').getAttribute('title');
  expect(first).not.toBe(checkout.headOid);
  await banner.getByRole('button', { name: 'View candidate' }).click();
  await expect(page.locator('.commit-row.selected')).toHaveAttribute('data-commit-oid', first!);
  await banner.getByRole('button', { name: 'Good', exact: true }).click();
  await expect(banner.locator('small')).not.toHaveAttribute('title', first!);
  expect(await current()).toEqual(checkout);
  await banner.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(banner).toHaveCount(0);
  expect(await current()).toEqual(checkout);
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

test('native bisect terms update the banner and retire a palette vote even when the OID is unchanged', async ({ page }) => {
  const { banner, expected } = await openVote(page, true);
  await page.evaluate(async () => {
    const state = (window as any).__bisectVote;
    const status = state.git.repository().status;
    state.nextStatus = { ...status, bisectCandidate: { ...status.bisectCandidate, terms: { old: 'fast', new: 'slow' } } };
    await state.git.refreshStatusInBackground();
  });
  await expect(banner.getByRole('button', { name: 'Good', exact: true })).toHaveCount(0);
  await banner.getByRole('button', { name: 'fast', exact: true }).click();
  await expect(banner.getByRole('button', { name: 'fast', exact: true })).toBeEnabled();
  await expect.poll(() => page.evaluate(() => (window as any).__bisectVote.calls)).toEqual([
    { ...expected, candidate: { ...expected.candidate, terms: { old: 'fast', new: 'slow' } } },
  ]);

  await page.getByRole('button', { name: 'Command palette', exact: true }).click();
  await page.getByRole('combobox', { name: 'Search commands', exact: true }).fill('Bisect Mark Current Commit slow');
  const action = page.getByRole('option', { name: /Bisect: Mark Current Commit slow/ });
  await expect(action).toBeVisible();
  await action.evaluate((button: HTMLElement) => {
    const state = (window as any).__bisectVote;
    const { git } = state;
    const status = git.repository().status;
    state.nextStatus = { ...status, bisectCandidate: { ...status.bisectCandidate, terms: { old: 'slow', new: 'fast' } } };
    git.repositories.update((items: any[]) => items.map(item => item.id === git.activeRepositoryId()
      ? { ...item, status: state.nextStatus } : item));
    button.click();
  });
  expect(await page.evaluate(() => (window as any).__bisectVote.calls)).toHaveLength(1);
  await page.keyboard.press('Escape');
  await expect(banner.locator('.good')).toHaveText('slow');
  await expect(banner.locator('.bad')).toHaveText('fast');
});

test('a found bisect result replaces the test candidate and stops offering votes', async ({ page }) => {
  await openVote(page, true);
  await page.evaluate(() => {
    const state = (window as any).__bisectVote;
    const { git } = state;
    state.viewed = [];
    git.inspectCommit = (oid: string) => state.viewed.push(oid);
    git.inspectHistoryCommit = async () => null;
    git.repositories.update((items: any[]) => items.map(item => item.id === git.activeRepositoryId()
      ? { ...item, status: { ...item.status, bisectCandidate: undefined,
        bisectResult: { kind: 'found', oid: 'c'.repeat(40), term: 'bad' } } } : item));
  });
  const banner = page.getByRole('status', { name: 'Git bisect result found' });
  await expect(banner).toContainText('First bad commit ccccccc');
  await expect(banner).not.toContainText('Test commit');
  for (const name of ['Good', 'Bad', 'Skip']) {
    await expect(banner.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
  await expect(banner.getByRole('button', { name: 'Reset', exact: true })).toBeEnabled();
  await banner.getByRole('button', { name: 'View result', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__bisectVote.viewed)).toEqual(['c'.repeat(40)]);
});

test('an inconclusive bisect lets the user inspect each possibility instead of voting again', async ({ page }) => {
  await openVote(page, true);
  await page.evaluate(async () => {
    const state = (window as any).__bisectVote;
    const { git } = state;
    state.viewed = [];
    state.outsideGraph = [];
    git.inspectCommit = (oid: string) => state.viewed.push(oid);
    git.inspectHistoryCommit = async (oid: string) => {
      state.outsideGraph.push(oid);
      return null;
    };
    state.nextStatus = { ...git.repository().status, bisectCandidate: undefined,
      bisectResult: { kind: 'ambiguous', term: 'bad', possibleOids: ['c'.repeat(40), 'e'.repeat(40)] } };
    await git.refreshStatusInBackground();
  });

  const banner = page.getByRole('status', { name: 'Git bisect result inconclusive' });
  await expect(banner).toContainText('2 possible first bad commits; some revisions were skipped.');
  await expect(banner.getByRole('button')).toHaveText(['View commit', 'Reset']);
  const options = banner.getByRole('combobox', { name: 'Possible bisect result' });
  await expect(options.locator('option')).toHaveText(['cccccccc', 'eeeeeeee']);
  await options.selectOption('e'.repeat(40));
  await banner.getByRole('button', { name: 'View commit' }).click();
  expect(await page.evaluate(() => {
    const state = (window as any).__bisectVote;
    return { viewed: state.viewed, outsideGraph: state.outsideGraph, selected: state.app.selectedCommit() };
  })).toEqual({ viewed: ['e'.repeat(40)], outsideGraph: ['e'.repeat(40)], selected: 'e'.repeat(40) });

  // A background refresh that changes only the list must not be deduplicated.
  await page.evaluate(async () => {
    const state = (window as any).__bisectVote;
    state.nextStatus = { ...state.nextStatus,
      bisectResult: { kind: 'ambiguous', term: 'bad', possibleOids: ['c'.repeat(40), 'f'.repeat(40)] } };
    await state.git.refreshStatusInBackground();
  });
  await expect(options.locator('option')).toHaveText(['cccccccc', 'ffffffff']);
  await page.getByRole('button', { name: 'Command palette', exact: true }).click();
  const search = page.getByRole('combobox', { name: 'Search commands' });
  await search.fill('Bisect Mark');
  await expect(page.getByRole('option', { name: /Bisect: Mark/ })).toHaveCount(0);
  await search.fill('Bisect Reset');
  await expect(page.getByRole('option', { name: /Bisect: Reset/ })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__bisectVote.calls)).toEqual([]);
});
