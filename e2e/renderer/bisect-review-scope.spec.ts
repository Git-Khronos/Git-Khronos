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
