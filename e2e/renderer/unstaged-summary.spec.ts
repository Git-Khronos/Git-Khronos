import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gk-app'));
    const git = app.git;
    // Drive status refreshes explicitly in this suite. The ordinary renderer
    // timer can otherwise increment the native call count between assertions.
    app.cancelLiveStatusRefresh();
    app.scheduleLiveStatusRefresh = () => {};
    const state: any = { app, git, requests: [], otherCommands: [] };
    (window as any).__unstagedSummary = state;
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      if (command === 'working_tree_change_summary') return new Promise((resolve, reject) => state.requests.push({ args, resolve, reject }));
      state.otherCommands.push(command);
      if (command === 'refresh_repository_status') return Promise.resolve(structuredClone(git.repository().status));
      return Promise.resolve(git.repository());
    } };
    state.refresh = () => git.repositories.update((items: any[]) => items.map(item => item.id === git.activeRepositoryId()
      ? { ...item, status: { ...item.status } } : item));
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
  });
  await expect.poll(() => page.evaluate(() => (window as any).__unstagedSummary.requests.length)).toBe(1);
});

test('unstaged header shows additions and deletions with binary/partial disclosure', { tag: '@daily-driver-smoke' }, async ({ page }) => {
  await page.evaluate(() => (window as any).__unstagedSummary.requests[0].resolve({ staged: null, unstaged: { additions: 17, deletions: 8, uncountedFiles: 2, partial: true } }));
  const recap = page.locator('.unstaged-section gk-working-tree-summary');
  await expect(recap).toContainText('+17'); await expect(recap).toContainText('−8');
  await expect(recap).toContainText('2 excluded'); await expect(recap).toContainText('(partial)');
  const excluded = recap.getByText('2 excluded', { exact: true });
  await expect(excluded).toHaveCSS('color', 'rgb(146, 145, 165)');
  const additions = recap.getByText('+17', { exact: true });
  const deletions = recap.getByText('−8', { exact: true });
  await expect(additions).toHaveCSS('color', 'rgb(84, 214, 173)');
  await expect(deletions).toHaveCSS('color', 'rgb(255, 107, 131)');
  await page.evaluate(() => { document.documentElement.dataset.theme = 'midnight'; });
  await expect(excluded).toHaveCSS('color', 'rgb(154, 168, 187)');
  await expect(additions).toHaveCSS('color', 'rgb(105, 221, 183)');
  await expect(deletions).toHaveCSS('color', 'rgb(255, 120, 144)');
  await expect(recap.getByText('(partial)', { exact: true })).toHaveCSS('color', 'rgb(154, 168, 187)');
  await expect(recap.locator('[aria-label]')).toHaveAttribute('aria-label', /17 additions and 8 deletions.*2 binary or uncounted.*partial totals/);
  await page.getByRole('button', { name: /^Unstaged Files/ }).click();
  await expect(page.locator('#unstaged-files-list')).toHaveCount(0);
  await expect(recap).toContainText('+17');
  await expect(page.getByRole('button', { name: 'Stage all changes', exact: true })).toBeEnabled();
});

test('a file filter discloses that totals and bulk actions still cover hidden files', async ({ page }) => {
  await page.evaluate(() => (window as any).__unstagedSummary.requests[0].resolve({
    staged: null, unstaged: { additions: 17, deletions: 8, uncountedFiles: 0, partial: false },
  }));
  const section = page.locator('.unstaged-section');
  const recap = section.getByRole('img', { name: /17 additions and 8 deletions/ });
  const stage = section.getByRole('button', { name: 'Stage all changes', exact: true });
  await expect(recap).not.toContainText('All files');
  await page.getByRole('searchbox', { name: 'Filter changed files' }).fill('no-file-should-match-this-query');
  await expect(recap).toContainText('All files');
  await expect(recap).toHaveAccessibleName(/17 additions and 8 deletions.*include files hidden by the filter/);
  await expect(stage).toHaveAttribute('title', 'Stage all changes, including files hidden by the filter');
  await expect(stage).toBeEnabled();
  await page.getByRole('button', { name: 'Clear file filter' }).click();
  await expect(recap).not.toContainText('All files');
  expect(await page.evaluate(() => (window as any).__unstagedSummary.requests.length)).toBe(1);
});

test('large unstaged line totals wrap without overlapping bulk actions in a compact window', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 720 });
  await page.locator('.unstaged-section').evaluate(element => { element.style.width = '250px'; });
  await page.evaluate(() => (window as any).__unstagedSummary.requests[0].resolve({
    staged: null, unstaged: { additions: 123456789012, deletions: 765432109876, uncountedFiles: 123, partial: true },
  }));
  const section = page.locator('.unstaged-section .file-section-title');
  const recap = section.getByRole('img', { name: /123456789012 additions and 765432109876 deletions/ });
  const stage = section.getByRole('button', { name: 'Stage all changes', exact: true });
  const discard = section.getByRole('button', { name: 'Discard all unstaged changes', exact: true });
  await expect(recap).toContainText('123 excluded');
  await expect(stage).toBeVisible();
  await expect(discard).toBeVisible();
  const [header, totals, stageButton, discardButton] = await Promise.all(
    [section, recap, stage, discard].map(element => element.boundingBox()),
  );
  expect(header && totals && stageButton && discardButton).toBeTruthy();
  expect(stageButton!.x + stageButton!.width).toBeLessThanOrEqual(discardButton!.x + 1);
  expect(discardButton!.x + discardButton!.width).toBeLessThanOrEqual(header!.x + header!.width + 1);
  expect(totals!.x + totals!.width).toBeLessThanOrEqual(header!.x + header!.width + 1);
  for (const action of [stageButton!, discardButton!]) {
    const overlaps = totals!.x + totals!.width > action.x + 1 && action.x + action.width > totals!.x + 1
      && totals!.y + totals!.height > action.y + 1 && action.y + action.height > totals!.y + 1;
    expect(overlaps).toBe(false);
  }
  const additions = await recap.getByText('+123456789012', { exact: true }).boundingBox();
  const partial = await recap.getByText('(partial)', { exact: true }).boundingBox();
  expect(partial!.y).toBeGreaterThan(additions!.y + additions!.height / 2);
});

test('a busy checkout retains measured totals until it can recount', async ({ page }) => {
  const recap = page.locator('.unstaged-section gk-working-tree-summary');
  const image = recap.getByRole('img');
  await page.evaluate(() => (window as any).__unstagedSummary.requests[0].resolve({
    staged: null, unstaged: { additions: 17, deletions: 8, uncountedFiles: 0, partial: false },
  }));
  await expect(image).toHaveAccessibleName('17 additions and 8 deletions in unstaged files');
  await page.evaluate(() => (window as any).__unstagedSummary.git.branchMutationPending.set(true));
  await expect(image).toHaveAccessibleName('17 additions and 8 deletions in unstaged files; updating');
  expect(await page.evaluate(() => (window as any).__unstagedSummary.requests.length)).toBe(1);
  await page.evaluate(() => (window as any).__unstagedSummary.git.branchMutationPending.set(false));
  await expect.poll(() => page.evaluate(() => (window as any).__unstagedSummary.requests.length)).toBe(2);
  await page.evaluate(() => (window as any).__unstagedSummary.requests[1].resolve({
    staged: null, unstaged: { additions: 20, deletions: 9, uncountedFiles: 0, partial: false },
  }));
  await expect(image).toHaveAccessibleName('20 additions and 9 deletions in unstaged files');
});

test('a busy checkout without a measurement waits before recounting', async ({ page }) => {
  const recap = page.locator('.unstaged-section gk-working-tree-summary');
  await page.evaluate(() => (window as any).__unstagedSummary.git.branchMutationPending.set(true));
  await expect(recap.getByRole('status')).toHaveText('Waiting for Git…');
  await page.evaluate(() => (window as any).__unstagedSummary.requests[0].resolve({
    staged: null, unstaged: { additions: 999, deletions: 0, uncountedFiles: 0, partial: false },
  }));
  await expect(recap.getByRole('status')).toHaveText('Waiting for Git…');
  expect(await page.evaluate(() => (window as any).__unstagedSummary.requests.length)).toBe(1);
  await page.evaluate(() => (window as any).__unstagedSummary.git.branchMutationPending.set(false));
  await expect(recap.getByRole('status')).toHaveText('Counting lines…');
  await expect.poll(() => page.evaluate(() => (window as any).__unstagedSummary.requests.length)).toBe(2);
  await page.evaluate(() => (window as any).__unstagedSummary.requests[1].resolve({
    staged: null, unstaged: { additions: 3, deletions: 1, uncountedFiles: 0, partial: false },
  }));
  await expect(recap.getByRole('img')).toHaveAccessibleName('3 additions and 1 deletion in unstaged files');
});

test('status bursts coalesce and an old result cannot replace current totals', async ({ page }) => {
  await page.evaluate(() => {
    const s = (window as any).__unstagedSummary;
    s.refresh(); s.refresh(); s.refresh();
  });
  expect(await page.evaluate(() => (window as any).__unstagedSummary.requests.length)).toBe(1);
  await page.evaluate(() => (window as any).__unstagedSummary.requests[0].resolve({ staged: null, unstaged: { additions: 999, deletions: 999, uncountedFiles: 0, partial: false } }));
  await expect.poll(() => page.evaluate(() => (window as any).__unstagedSummary.requests.length)).toBe(2);
  await expect(page.locator('.unstaged-section gk-working-tree-summary')).not.toContainText('999');
  await page.evaluate(() => (window as any).__unstagedSummary.requests[1].resolve({ staged: null, unstaged: { additions: 5, deletions: 3, uncountedFiles: 0, partial: false } }));
  await expect(page.locator('.unstaged-section gk-working-tree-summary')).toContainText('+5');
  await expect(page.locator('.unstaged-section gk-working-tree-summary')).toContainText('−3');
});

test('an obsolete recap cannot publish after returning to the unchanged checkout', async ({ page }) => {
  const recap = page.locator('.unstaged-section gk-working-tree-summary');
  const sameSnapshotNewVisit = await page.evaluate(() => {
    const fixture = (window as any).__unstagedSummary;
    const { git, requests } = fixture;
    const totals = (window as any).ng.getDirectives(document.querySelector('.working-tree-scroll'))
      .find((directive: any) => typeof directive.unstaged?.set === 'function');
    fixture.published = [];
    const publish = totals.unstaged.set.bind(totals.unstaged);
    totals.unstaged.set = (state: any) => {
      if (state.phase === 'ready') fixture.published.push(state.value.additions);
      publish(state);
    };
    const original = git.repository();
    const other = { ...original, id: 'summary-other-checkout', path: '/owned/summary-other' };
    git.repositories.update((items: any[]) => [...items, other]);
    const before = git.activeRepositoryReadScope();
    git.activateRepository(other.id);
    git.activateRepository(original.id);
    requests[0].resolve({ staged: null, unstaged: { additions: 999, deletions: 999, uncountedFiles: 0, partial: false } });
    return git.repository() === original && git.activeRepositoryReadScope() !== before;
  });
  expect(sameSnapshotNewVisit).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).__unstagedSummary.requests.length)).toBe(2);
  await expect(recap).not.toContainText('999');
  await page.evaluate(() => (window as any).__unstagedSummary.requests[1].resolve({
    staged: null, unstaged: { additions: 7, deletions: 4, uncountedFiles: 0, partial: false },
  }));
  await expect(recap).toContainText('+7');
  expect(await page.evaluate(() => (window as any).__unstagedSummary.published)).toEqual([7]);
});

test('a successful status poll refreshes line counts even when porcelain status is unchanged', async ({ page }) => {
  const recap = page.locator('.unstaged-section gk-working-tree-summary');
  await page.evaluate(() => (window as any).__unstagedSummary.requests[0].resolve({
    staged: null, unstaged: { additions: 2, deletions: 1, uncountedFiles: 0, partial: false },
  }));
  await expect(recap).toContainText('+2');

  const statusIdentityPreserved = await page.evaluate(async () => {
    const { git } = (window as any).__unstagedSummary;
    const previous = git.repository().status;
    await git.refreshStatusInBackground();
    return git.repository().status === previous;
  });
  expect(statusIdentityPreserved).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).__unstagedSummary.requests.length)).toBe(2);
  await page.evaluate(() => (window as any).__unstagedSummary.requests[1].resolve({
    staged: null, unstaged: { additions: 6, deletions: 2, uncountedFiles: 0, partial: false },
  }));
  await expect(recap).toContainText('+6');
  await expect(recap).toContainText('−2');
});

test('an unchanged-status recount keeps both last totals visible and marks them as updating', async ({ page }) => {
  const staged = page.locator('.staged-section gk-working-tree-summary');
  const unstaged = page.locator('.unstaged-section gk-working-tree-summary');
  await page.evaluate(() => (window as any).__unstagedSummary.requests[0].resolve({
    staged: { additions: 24, deletions: 13, uncountedFiles: 1, partial: false },
    unstaged: { additions: 5, deletions: 2, uncountedFiles: 0, partial: false },
  }));
  await expect(staged).toContainText('+24');
  await expect(unstaged).toContainText('+5');

  await page.evaluate(() => (window as any).__unstagedSummary.git.refreshStatusInBackground());
  await expect.poll(() => page.evaluate(() => (window as any).__unstagedSummary.requests.length)).toBe(2);
  await expect(staged.getByRole('img', { name: /24 additions and 13 deletions.*updating/i })).toBeVisible();
  await expect(unstaged.getByRole('img', { name: /5 additions and 2 deletions.*updating/i })).toBeVisible();
  await page.getByRole('button', { name: /^Staged Files/ }).click();
  await expect(page.locator('#staged-files-list')).toHaveCount(0);
  await expect(staged).toContainText('+24');
  expect(await page.evaluate(() => (window as any).__unstagedSummary.requests.length)).toBe(2);

  await page.evaluate(() => (window as any).__unstagedSummary.requests[1].resolve({
    staged: { additions: 23, deletions: 12, uncountedFiles: 0, partial: false },
    unstaged: { additions: 7, deletions: 1, uncountedFiles: 0, partial: false },
  }));
  await expect(staged.getByRole('img', { name: '23 additions and 12 deletions in staged files' })).toBeVisible();
  await expect(unstaged.getByRole('img', { name: '7 additions and 1 deletion in unstaged files' })).toBeVisible();
  await expect(staged.getByRole('img', { name: /updating/i })).toHaveCount(0);
});

test('a failed recount retires previously measured totals instead of leaving them as current', async ({ page }) => {
  const recap = page.locator('.unstaged-section gk-working-tree-summary');
  await page.evaluate(() => (window as any).__unstagedSummary.requests[0].resolve({
    staged: null, unstaged: { additions: 41, deletions: 3, uncountedFiles: 0, partial: false },
  }));
  await expect(recap).toContainText('+41');
  await page.evaluate(() => (window as any).__unstagedSummary.git.refreshStatusInBackground());
  await expect.poll(() => page.evaluate(() => (window as any).__unstagedSummary.requests.length)).toBe(2);
  await expect(recap.getByRole('img', { name: /41 additions.*updating/i })).toBeVisible();
  await page.evaluate(() => (window as any).__unstagedSummary.requests[1].reject(new Error('Owned recount failure')));
  await expect(recap).toContainText('Line counts unavailable');
});

test('retry recounts only the current recap request and preserves the other measured side', async ({ page }) => {
  const staged = page.locator('.staged-section gk-working-tree-summary');
  const unstaged = page.locator('.unstaged-section gk-working-tree-summary');
  await page.evaluate(() => (window as any).__unstagedSummary.requests[0].resolve({
    staged: { additions: 9, deletions: 2, uncountedFiles: 0, partial: false }, unstaged: null,
  }));
  const retry = unstaged.getByRole('button', { name: 'Retry unstaged line counts' });
  await expect(retry).toBeVisible();
  await page.evaluate(() => { (window as any).__unstagedSummary.otherCommands.length = 0; });
  await retry.focus();
  await retry.press('Enter');
  await expect(page.getByRole('button', { name: /^Unstaged Files/ })).toBeFocused();
  await expect(unstaged.getByRole('status')).toHaveText('Counting lines…');
  await expect(staged.getByRole('img', { name: '9 additions and 2 deletions in staged files' })).toBeVisible();
  await expect(retry).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__unstagedSummary.requests.length)).toBe(2);
  await page.evaluate(() => (window as any).__unstagedSummary.requests[1].reject(new Error('Owned retry failure')));
  await expect(retry).toBeVisible();
  await expect(staged).toContainText('+9');
  await retry.click();
  await expect.poll(() => page.evaluate(() => (window as any).__unstagedSummary.requests.length)).toBe(3);
  await page.evaluate(() => (window as any).__unstagedSummary.requests[2].resolve({
    staged: null,
    unstaged: { additions: 4, deletions: 1, uncountedFiles: 0, partial: false },
  }));
  await expect(unstaged.getByRole('img', { name: '4 additions and 1 deletion in unstaged files' })).toBeVisible();
  await expect(staged).toContainText('+9');
  expect(await page.evaluate(() => (window as any).__unstagedSummary.otherCommands)).toEqual([]);
});

test('a retry control painted for an obsolete checkout cannot start another read', async ({ page }) => {
  await page.evaluate(() => (window as any).__unstagedSummary.requests[0].resolve({ staged: null, unstaged: null }));
  const retry = page.getByRole('button', { name: 'Retry unstaged line counts' });
  await expect(retry).toBeVisible();
  const visits = await retry.evaluate((button: HTMLButtonElement) => {
    const { git, requests } = (window as any).__unstagedSummary;
    const original = git.repository();
    const replacement = { ...original, id: 'owned-recap-retry-replacement', path: '/owned/recap-retry-replacement' };
    git.repositories.update((items: any[]) => [...items, replacement]);
    git.activateRepository(replacement.id);
    button.click();
    return { callsBeforeRender: requests.length, next: replacement.id };
  });
  expect(visits.callsBeforeRender).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as any).__unstagedSummary.requests.length)).toBe(2);
  expect(await page.evaluate(() => (window as any).__unstagedSummary.requests[1].args.repoId)).toBe(visits.next);
});

test('a replacement checkout cannot inherit the previous checkout’s measured totals', async ({ page }) => {
  const recap = page.locator('.unstaged-section gk-working-tree-summary');
  await page.evaluate(() => (window as any).__unstagedSummary.requests[0].resolve({
    staged: null, unstaged: { additions: 41, deletions: 3, uncountedFiles: 0, partial: false },
  }));
  await expect(recap).toContainText('+41');
  await page.evaluate(() => {
    const { git } = (window as any).__unstagedSummary;
    const other = { ...git.repository(), id: 'recap-another-checkout', path: '/owned/recap-another-checkout' };
    git.repositories.update((items: any[]) => [...items, other]);
    git.activateRepository(other.id);
  });
  await expect.poll(() => page.evaluate(() => (window as any).__unstagedSummary.requests.length)).toBe(2);
  await expect(recap).toHaveText('Counting lines…');
});

test('unchanged status polls supersede an in-flight line count without starting concurrent reads', async ({ page }) => {
  await page.evaluate(async () => {
    const { git } = (window as any).__unstagedSummary;
    await git.refreshStatusInBackground();
    await git.refreshStatusInBackground();
  });
  expect(await page.evaluate(() => (window as any).__unstagedSummary.requests.length)).toBe(1);
  await page.evaluate(() => (window as any).__unstagedSummary.requests[0].resolve({
    staged: null, unstaged: { additions: 999, deletions: 999, uncountedFiles: 0, partial: false },
  }));
  await expect.poll(() => page.evaluate(() => (window as any).__unstagedSummary.requests.length)).toBe(2);
  await expect(page.locator('.unstaged-section gk-working-tree-summary')).not.toContainText('999');
  await page.evaluate(() => (window as any).__unstagedSummary.requests[1].resolve({
    staged: null, unstaged: { additions: 9, deletions: 3, uncountedFiles: 0, partial: false },
  }));
  await expect(page.locator('.unstaged-section gk-working-tree-summary')).toContainText('+9');
});

for (const change of ['repository', 'path']) {
  test(`late summary failure cannot leak into a replacement ${change}`, async ({ page }) => {
    await page.evaluate(change => {
      const s = (window as any).__unstagedSummary;
      const source = s.git.repository();
      if (change === 'repository') {
        const other = { ...source, id: 'summary-B', path: '/owned/summary-B' };
        s.git.repositories.update((items: any[]) => [...items, other]); s.git.activeRepositoryId.set(other.id);
      } else s.git.repositories.update((items: any[]) => items.map(item => item.id === source.id ? { ...item, path: '/owned/summary-replacement' } : item));
    }, change);
    await page.evaluate(() => (window as any).__unstagedSummary.requests[0].reject(new Error('Obsolete summary failure')));
    await expect.poll(() => page.evaluate(() => (window as any).__unstagedSummary.requests.length)).toBe(2);
    await expect(page.locator('.unstaged-section gk-working-tree-summary')).not.toContainText('unavailable');
    await page.evaluate(() => (window as any).__unstagedSummary.requests[1].resolve({ staged: null, unstaged: { additions: 2, deletions: 1, uncountedFiles: 0, partial: false } }));
    await expect(page.locator('.unstaged-section gk-working-tree-summary')).toContainText('+2');
    expect(await page.evaluate(() => (window as any).__unstagedSummary.git.error())).toBeNull();
  });
}

test('failed counts are not presented as zero and refresh retries them', async ({ page }) => {
  await page.evaluate(() => (window as any).__unstagedSummary.requests[0].reject(new Error('Owned read failure')));
  const recap = page.locator('.unstaged-section gk-working-tree-summary');
  await expect(recap).toContainText('Line counts unavailable');
  await expect(recap).not.toContainText('+0');
  await page.evaluate(() => (window as any).__unstagedSummary.refresh());
  await expect.poll(() => page.evaluate(() => (window as any).__unstagedSummary.requests.length)).toBe(2);
  await page.evaluate(() => (window as any).__unstagedSummary.requests[1].resolve({ staged: null, unstaged: { additions: 4, deletions: 2, uncountedFiles: 0, partial: false } }));
  await expect(recap).toContainText('+4');
});

test('clean working tree resets both recaps to zero without another native read', async ({ page }) => {
  await page.evaluate(() => {
    const s = (window as any).__unstagedSummary;
    s.git.repositories.update((items: any[]) => items.map(item => item.id === s.git.activeRepositoryId()
      ? { ...item, status: { ...item.status, staged: 0, unstaged: 0, untracked: 0 } } : item));
  });
  await expect(page.locator('.unstaged-section gk-working-tree-summary')).toContainText('+0');
  await expect(page.locator('.staged-section gk-working-tree-summary')).toContainText('+0');
  await page.evaluate(() => (window as any).__unstagedSummary.requests[0].resolve({ staged: null, unstaged: { additions: 99, deletions: 99, uncountedFiles: 0, partial: false } }));
  await expect(page.locator('.unstaged-section gk-working-tree-summary')).toContainText('−0');
  expect(await page.evaluate(() => (window as any).__unstagedSummary.requests.length)).toBe(1);
});

test('recap and Stage all remain within a narrow file-section header', async ({ page }) => {
  await page.evaluate(() => (window as any).__unstagedSummary.requests[0].resolve({ staged: null, unstaged: { additions: 12345, deletions: 6789, uncountedFiles: 2, partial: true } }));
  const section = page.locator('.unstaged-section');
  await section.evaluate(element => { (element as HTMLElement).style.width = '250px'; });
  await expect(section.locator('gk-working-tree-summary')).toContainText('+12345');
  expect(await section.locator('.file-section-title').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(section.getByRole('button', { name: 'Stage all changes', exact: true })).toBeVisible();
  await page.screenshot({ path: 'target/local-review/unstaged-summary/narrow-header.png' });
});

test('the unavailable recap and its Retry control wrap within a narrow header', async ({ page }) => {
  await page.evaluate(() => (window as any).__unstagedSummary.requests[0].resolve({ staged: null, unstaged: null }));
  const section = page.locator('.unstaged-section');
  await section.evaluate(element => { (element as HTMLElement).style.width = '250px'; });
  const retry = section.getByRole('button', { name: 'Retry unstaged line counts' });
  await expect(retry).toBeVisible();
  expect(await section.locator('.file-section-title').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(section.getByRole('button', { name: 'Stage all changes', exact: true })).toBeVisible();
});

test('one native read supplies independent staged and unstaged counts', async ({ page }) => {
  await page.evaluate(() => (window as any).__unstagedSummary.requests[0].resolve({
    staged: { additions: 24, deletions: 13, uncountedFiles: 1, partial: false },
    unstaged: { additions: 5, deletions: 2, uncountedFiles: 0, partial: false },
  }));
  const staged = page.locator('.staged-section gk-working-tree-summary');
  const unstaged = page.locator('.unstaged-section gk-working-tree-summary');
  await expect(staged.getByLabel(/24 additions and 13 deletions in staged files/)).toHaveAttribute('title', /relative to the last commit/);
  await expect(staged).toContainText('1 excluded');
  await expect(unstaged.getByLabel(/5 additions and 2 deletions in unstaged files/)).toHaveAttribute('title', /relative to the index/);
  await page.getByRole('button', { name: /^Staged Files/ }).click();
  await expect(page.locator('#staged-files-list')).toHaveCount(0);
  await expect(staged).toContainText('+24');
  expect(await page.evaluate(() => (window as any).__unstagedSummary.requests.length)).toBe(1);
});

test('assistive technology receives a single correctly worded recap per section', async ({ page }) => {
  await page.evaluate(() => (window as any).__unstagedSummary.requests[0].resolve({
    staged: { additions: 1, deletions: 0, uncountedFiles: 1, partial: false },
    unstaged: { additions: 0, deletions: 1, uncountedFiles: 0, partial: true },
  }));
  await expect(page.locator('.staged-section gk-working-tree-summary')).toMatchAriaSnapshot(
    '- img "1 addition and 0 deletions in staged files; 1 binary or uncounted file excluded"');
  await expect(page.locator('.unstaged-section gk-working-tree-summary')).toMatchAriaSnapshot(
    '- img "0 additions and 1 deletion in unstaged files; partial totals"');
});

test('a staged-only tree still counts and distinguishes an unavailable side', async ({ page }) => {
  const staged = page.locator('.staged-section gk-working-tree-summary');
  const unstaged = page.locator('.unstaged-section gk-working-tree-summary');
  await page.evaluate(() => (window as any).__unstagedSummary.requests[0].resolve({
    staged: null, unstaged: { additions: 1, deletions: 0, uncountedFiles: 0, partial: false },
  }));
  await expect(staged).toContainText('Line counts unavailable');
  await expect(unstaged).toContainText('+1');
  await page.evaluate(() => {
    const s = (window as any).__unstagedSummary;
    s.git.repositories.update((items: any[]) => items.map(item => item.id === s.git.activeRepositoryId()
      ? { ...item, status: { ...item.status, unstaged: 0, untracked: 0 } } : item));
  });
  await expect.poll(() => page.evaluate(() => (window as any).__unstagedSummary.requests.length)).toBe(2);
  await page.evaluate(() => (window as any).__unstagedSummary.requests[1].resolve({
    staged: { additions: 3, deletions: 2, uncountedFiles: 0, partial: false }, unstaged: null,
  }));
  await expect(staged).toContainText('+3');
  await expect(unstaged).toContainText('+0');
});
