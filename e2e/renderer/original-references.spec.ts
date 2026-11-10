import { expect, test, type Page } from '@playwright/test';

const privateRef = 'refs/original/refs/heads/private';
const commaRef = 'refs/original/refs/heads/dev,backup';
const siblingRef = 'refs/original/refs/heads/keep';
const privateOid = 'a'.repeat(40);

async function installFixture(page: Page): Promise<void> {
  await page.evaluate(({ privateRef, commaRef, siblingRef, privateOid }) => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    const base = structuredClone(git.repository());
    const fixture = {
      git, base, show: false, reject: '', refreshFailed: false, delayed: false,
      rejectRefresh: false, mismatchReply: false, resolveDelete: null as null | (() => void),
      refs: [{ name: privateRef, oid: privateOid }, { name: commaRef, oid: base.headOid },
        { name: siblingRef, oid: base.headOid }],
      calls: [] as Array<{ command: string; args: Record<string, unknown> }>,
      snapshot: () => {
        const snapshot = structuredClone(base);
        snapshot.showCheckpoints = fixture.show;
        const head = snapshot.commits.find((commit: { oid: string }) => commit.oid === base.headOid);
        // A valid branch can resemble the complete canonical original ref.
        snapshot.branches.push({
          ...snapshot.branches.find((branch: { current: boolean }) => branch.current),
          current: false, name: commaRef, fullName: `refs/heads/${commaRef}`, oid: base.headOid,
        });
        head.decorations.push(fixture.show ? `refs/heads/${commaRef}` : commaRef);
        head.decorations.push(...fixture.refs.filter(ref => ref.oid === base.headOid)
          .map(ref => `original: ${ref.name}`));
        if (fixture.refs.some(ref => ref.name === privateRef)) {
          snapshot.commits.unshift({
            ...head, oid: privateOid, parents: [base.headOid], subject: 'Original-only history',
            decorations: [`original: ${privateRef}`],
          });
        }
        return snapshot;
      },
    };
    (window as any).__originalTest = fixture;
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string, args: Record<string, unknown> = {}) => {
        fixture.calls.push({ command, args });
        if (command === 'delete_original_reference') {
          if (fixture.reject) return Promise.reject({
            kind: 'originalReferenceRefused', message: fixture.reject,
            hint: 'Refresh history and review the full original reference again.',
          });
          const index = fixture.refs.findIndex(ref =>
            ref.name === args['reference'] && ref.oid === args['expectedOid']);
          if (index < 0) return Promise.reject({ kind: 'originalReferenceRefused', message: 'Reference moved.' });
          fixture.refs.splice(index, 1);
          if (fixture.refreshFailed) return Promise.reject({
            kind: 'originalReferenceDeletedRefreshFailed',
            message: 'The original reference was deleted, but history could not refresh.',
            hint: 'Refresh the repository to update its history. Do not repeat the deletion.',
          });
          if (fixture.delayed) return new Promise(resolve => {
            fixture.resolveDelete = () => resolve(fixture.mismatchReply
              ? { ...fixture.snapshot(), path: '/fixture/mismatched' } : fixture.snapshot());
          });
          return Promise.resolve(fixture.snapshot());
        }
        if (command === 'set_checkpoint_visibility') {
          fixture.show = Boolean(args['show']);
          return Promise.resolve(fixture.snapshot());
        }
        if (command === 'refresh_repository') return fixture.rejectRefresh
          ? Promise.reject({ kind: 'gitFailure', message: 'Fixture history refresh unavailable.' })
          : Promise.resolve(fixture.snapshot());
        if (command === 'refresh_repository_status') return Promise.resolve(base.status);
        if (command === 'inspect_commit' || command === 'sync_repository') return Promise.resolve(null);
        return Promise.reject(new Error(`Unexpected command: ${command}`));
      },
    };
    git.systemInfo.set({ appVersion: 'renderer test', gitVersion: '2.50.0', gitSupported: true,
      minimumGitVersion: '2.34.0' });
    git.repositories.set([fixture.snapshot()]);
  }, { privateRef, commaRef, siblingRef, privateOid });
}

async function requestDelete(page: Page): Promise<void> {
  await page.getByRole('menuitem', { name: 'Delete original reference…' }).click();
  await expect(page.getByRole('alertdialog', { name: 'Delete original reference?' })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await installFixture(page);
});

test('reviews the exact name and full direct OID, traps focus and returns it on cancel', async ({ page }) => {
  const ref = page.locator('.commit-row').getByRole('button', { name: `Original reference ${privateRef}` });
  await ref.focus();
  await ref.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: 'Copy original reference' })).toBeFocused();
  await requestDelete(page);
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText(privateRef);
  await expect(dialog).toContainText(privateOid);
  await expect(dialog).toContainText('may make history unreachable');
  await expect(dialog).toContainText('does not itself erase objects');
  await expect(dialog).toContainText('No replacement recovery reference');
  const cancel = dialog.getByRole('button', { name: 'Cancel' });
  const confirm = dialog.getByRole('button', { name: 'Delete original reference' });
  await expect(cancel).toBeFocused();
  await cancel.press('Shift+Tab');
  await expect(confirm).toBeFocused();
  await confirm.press('Tab');
  await expect(cancel).toBeFocused();
  await cancel.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(ref).toBeFocused();
  expect(await page.evaluate(() => (window as any).__originalTest.calls
    .filter((call: { command: string }) => call.command === 'delete_original_reference'))).toHaveLength(0);
});

test('deletes only the reviewed original name and refreshes original-only history', async ({ page }) => {
  const ref = page.locator('.commit-row').getByRole('button', { name: `Original reference ${privateRef}` });
  await ref.click({ button: 'right' });
  await requestDelete(page);
  await page.getByRole('button', { name: 'Delete original reference', exact: true }).click();
  await expect(page.getByText('Original-only history')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__originalTest.calls
    .filter((call: { command: string }) => call.command === 'delete_original_reference')
    .map((call: { args: unknown }) => call.args))).toEqual([
    { repoId: 'browser-preview', reference: privateRef, expectedOid: privateOid },
  ]);
  expect(await page.evaluate(() => (window as any).__originalTest.refs.map((ref: { name: string }) => ref.name)))
    .toEqual([commaRef, siblingRef]);
});

test('offers the same reviewed action from a single commit-detail reference at narrow width', async ({ page }) => {
  await page.locator(`.commit-row[data-commit-oid="${privateOid}"]`).click();
  const ref = page.locator('.commit-detail-refs')
    .getByRole('button', { name: `Original reference ${privateRef}` });
  await ref.focus();
  await ref.press('ContextMenu');
  await requestDelete(page);
  await page.setViewportSize({ width: 420, height: 600 });
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText(privateOid);
  expect(await dialog.locator('.confirmation-copy').evaluate(element =>
    element.scrollWidth <= element.clientWidth)).toBe(true);
  const bounds = await dialog.boundingBox();
  expect(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 600).toBe(true);
  await page.keyboard.press('Escape');
  await expect(ref).toBeFocused();
});

for (const showCheckpoints of [false, true]) {
  test(`keeps comma refs canonical and lookalike branches distinct in grouped controls with checkpoints ${showCheckpoints ? 'shown' : 'hidden'}`, async ({ page }) => {
    if (showCheckpoints) {
      await page.getByRole('button', { name: 'Configure graph columns' }).click();
      await page.getByRole('checkbox', { name: 'Show Copilot checkpoints' }).check();
      await page.getByRole('button', { name: 'Configure graph columns' }).click();
    }
    const head = await page.evaluate(() => (window as any).__originalTest.base.headOid);
    const row = page.locator(`.commit-row[data-commit-oid="${head}"]`);
    await row.locator('.reference-stack-trigger').click();
    const lookalike = row.getByRole('menuitem', { name: `Local branch ${commaRef}`, exact: true });
    await lookalike.focus();
    await lookalike.press('ContextMenu');
    await expect(page.getByRole('menuitem', { name: 'Delete original reference…' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    const original = row.getByRole('menuitem', { name: `Original reference ${commaRef}` });
    await original.focus();
    await original.press('ContextMenu');
    await requestDelete(page);
    await expect(page.getByRole('alertdialog')).toContainText(commaRef);
    await page.getByRole('button', { name: 'Delete original reference', exact: true }).click();
    expect(await page.evaluate(() => (window as any).__originalTest.calls
      .filter((call: { command: string }) => call.command === 'delete_original_reference')
      .map((call: { args: unknown }) => call.args))).toEqual([
      { repoId: 'browser-preview', reference: commaRef, expectedOid: head },
    ]);
    await row.click();
    const inspector = page.locator('.commit-detail-refs');
    await inspector.locator('.reference-stack-trigger').click();
    const detail = inspector.getByRole('menuitem', { name: `Original reference ${siblingRef}` });
    await detail.focus();
    await detail.press('Shift+F10');
    await requestDelete(page);
    await expect(page.getByRole('alertdialog')).toContainText(siblingRef);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(inspector.locator('.reference-stack-trigger')).toBeFocused();
  });
}

test('retains the reference and reports a stale lease without automatically retrying', async ({ page }) => {
  await page.evaluate(() => { (window as any).__originalTest.reject = 'The original reference changed, is symbolic, or no longer exists.'; });
  await page.locator('.commit-row').getByRole('button', { name: `Original reference ${privateRef}` }).click();
  await requestDelete(page);
  await page.getByRole('button', { name: 'Delete original reference', exact: true }).click();
  await expect(page.getByText('The original reference changed, is symbolic, or no longer exists.', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('Original-only history')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__originalTest.calls
    .filter((call: { command: string }) => call.command === 'delete_original_reference'))).toHaveLength(1);
});

test('keeps unsupported original targets visible without offering their peeled commit as deletion authority', async ({ page }) => {
  const labels = [
    'Original reference (read-only): refs/original/symbolic',
    'Original reference (read-only): refs/original/refs/tags/annotated',
  ];
  const head = await page.evaluate(labels => {
    const fixture = (window as any).__originalTest;
    fixture.git.repositories.update((repos: any[]) => repos.map(repo => ({
      ...repo,
      commits: repo.commits.map((commit: any) => commit.oid === fixture.base.headOid
        ? { ...commit, decorations: [...commit.decorations, ...labels] } : commit),
    })));
    return fixture.base.headOid;
  }, labels);
  const row = page.locator(`.commit-row[data-commit-oid="${head}"]`);
  await row.locator('.reference-stack-trigger').click();
  for (const label of labels) await expect(row.getByText(label, { exact: true })).toBeVisible();
  await expect(row.getByRole('menuitem', { name: 'Original reference refs/original/symbolic', exact: true })).toHaveCount(0);
  await expect(row.getByRole('menuitem', { name: 'Original reference refs/original/refs/tags/annotated', exact: true })).toHaveCount(0);
});

test('reports applied deletion separately from a failed history refresh without replay', async ({ page }) => {
  await page.evaluate(() => { (window as any).__originalTest.refreshFailed = true; });
  await page.locator('.commit-row').getByRole('button', { name: `Original reference ${privateRef}` }).click();
  await requestDelete(page);
  await page.getByRole('button', { name: 'Delete original reference', exact: true }).click();
  await expect(page.getByText('The original reference was deleted, but history could not refresh.', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('Original-only history')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__originalTest.calls
    .filter((call: { command: string }) => call.command === 'delete_original_reference'))).toHaveLength(1);
});

for (const reply of ['superseded', 'mismatched'] as const) {
  test(`reports applied deletion when its ${reply} successful reply cannot reconcile the renderer`, async ({ page }) => {
    await page.evaluate(() => { (window as any).__originalTest.delayed = true; });
    await page.locator('.commit-row').getByRole('button', { name: `Original reference ${privateRef}` }).click();
    await requestDelete(page);
    await page.getByRole('button', { name: 'Delete original reference', exact: true }).click();
    await expect.poll(() => page.evaluate(() => Boolean((window as any).__originalTest.resolveDelete))).toBe(true);
    await page.evaluate(reply => {
      const fixture = (window as any).__originalTest;
      fixture.rejectRefresh = true;
      if (reply === 'superseded') fixture.git.bumpStatusGeneration(fixture.base.id);
      else fixture.mismatchReply = true;
      fixture.resolveDelete();
    }, reply);
    await expect.poll(() => page.evaluate(() => (window as any).__originalTest.git.busy())).toBe(false);
    await expect(page.getByText('The original reference was deleted, but history could not refresh:', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('Do not repeat the deletion.', { exact: false }).first()).toBeVisible();
    expect(await page.evaluate(() => (window as any).__originalTest.calls
      .filter((call: { command: string }) => call.command === 'delete_original_reference'))).toHaveLength(1);
    expect(await page.evaluate(() => (window as any).__originalTest.refs
      .some((ref: { name: string }) => ref.name === 'refs/original/refs/heads/private'))).toBe(false);
  });
}

test('refuses confirmation after a repository switch', async ({ page }) => {
  await page.locator('.commit-row').getByRole('button', { name: `Original reference ${privateRef}` }).click();
  await requestDelete(page);
  await page.evaluate(() => {
    const fixture = (window as any).__originalTest;
    fixture.git.repositories.update((repos: unknown[]) => [...repos, { ...fixture.snapshot(), id: 'other', path: '/fixture/other' }]);
    fixture.git.activeRepositoryId.set('other');
  });
  await page.getByRole('button', { name: 'Delete original reference', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__originalTest.calls
    .filter((call: { command: string }) => call.command === 'delete_original_reference'))).toHaveLength(0);
  await expect(page.getByText('The active repository changed. Open the reference again before deleting it.', { exact: false }).first()).toBeVisible();
});

test('refuses a stale context menu before opening a deletion review for another repository', async ({ page }) => {
  await page.locator('.commit-row').getByRole('button', { name: `Original reference ${privateRef}` }).click();
  await page.evaluate(() => {
    const fixture = (window as any).__originalTest;
    const oldMenu = fixture.git.activeRepositoryId();
    fixture.git.repositories.update((repos: unknown[]) => [...repos, { ...fixture.snapshot(), id: 'other', path: '/fixture/other' }]);
    fixture.git.activeRepositoryId.set('other');
    // Exercise a retained menu payload rather than silently retargeting its repository.
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    app.actionOverlays.open({ kind: 'context', value: {
      kind: 'original', repositoryId: oldMenu, oid: 'a'.repeat(40),
      oids: ['a'.repeat(40)], label: 'refs/original/refs/heads/private', x: 200, y: 200,
    } });
    app.requestStoredReferenceDelete();
  });
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__originalTest.calls
    .filter((call: { command: string }) => call.command === 'delete_original_reference'))).toHaveLength(0);
});

test('a late successful deletion never changes or selects the newly active repository', async ({ page }) => {
  await page.evaluate(() => { (window as any).__originalTest.delayed = true; });
  await page.locator('.commit-row').getByRole('button', { name: `Original reference ${privateRef}` }).click();
  await requestDelete(page);
  await page.getByRole('button', { name: 'Delete original reference', exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__originalTest.resolveDelete))).toBe(true);
  await page.evaluate(() => {
    const fixture = (window as any).__originalTest;
    fixture.git.repositories.update((repos: unknown[]) => [...repos, { ...fixture.base, id: 'other', path: '/fixture/other' }]);
    fixture.git.activeRepositoryId.set('other');
    fixture.resolveDelete();
  });
  await expect.poll(() => page.evaluate(() => (window as any).__originalTest.git.busy())).toBe(false);
  expect(await page.evaluate(() => {
    const git = (window as any).__originalTest.git;
    return { id: git.activeRepositoryId(), path: git.repository().path };
  })).toEqual({ id: 'other', path: '/fixture/other' });
});
