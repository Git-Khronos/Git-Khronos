import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible({ timeout: 15000 });
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    (window as any).__rebaseCalls = [];
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string, args: any) => {
        (window as any).__rebaseCalls.push({ command, args });
        if (command === 'prepare_interactive_rebase') {
          if ((window as any).__rebasePreparationError) {
            return Promise.reject((window as any).__rebasePreparationError);
          }
          const plan = {
            source: args.source, target: args.target, base: 'a'.repeat(40),
            commits: ['First retained', 'Fixup change', 'Last commit'].map((subject, index) => ({
              oid: String(index + 1).repeat(40), subject, message: `${subject}\n\nExplanation`,
              authorName: 'Fixture Author', authorEmail: 'author@example.test',
            })),
          };
          if ((window as any).__deferRebasePreparation) {
            return new Promise(resolve => {
              (window as any).__resolveRebasePreparation = () => resolve(plan);
            });

          }
          return Promise.resolve(plan);
        }
        if (command === 'execute_interactive_rebase') {
          const snapshot = git.repository();
          if (!(window as any).__editRebaseStop) return Promise.resolve(snapshot);
          const head = { ...snapshot.commits[0], oid: 'd'.repeat(40), subject: 'First retained', description: 'Explanation' };
          return Promise.resolve({ ...snapshot, headOid: head.oid, commits: [head, ...snapshot.commits],
            status: { ...snapshot.status, branch: null, staged: 0, unstaged: 0, untracked: 0, conflicted: 0,
              entryCount: 0, entriesTruncated: false, entries: [], rebaseInProgress: true, rebaseEditStopped: true } });
        }
        if (command === 'stage_all') {
          const status = git.repository().status;
          return Promise.resolve({ ...status, staged: 1, unstaged: 0,
            entries: status.entries.map((entry: any) => ({ ...entry, indexStatus: 'M', worktreeStatus: '.' })) });
        }
        if (command === 'commit_changes') {
          if ((window as any).__editAmendFailure) return Promise.reject({
            kind: 'gitFailure', message: 'Commit hook refused the amendment. Correct it and retry.',
          });
          const snapshot = git.repository();
          return Promise.resolve({ ...snapshot, headOid: 'e'.repeat(40),
            commits: [{ ...snapshot.commits[0], oid: 'e'.repeat(40), subject: args.message }, ...snapshot.commits.slice(1)],
            status: { ...snapshot.status, staged: 0, unstaged: 0, entryCount: 0, entries: [] } });
        }
        if (command === 'continue_rebase' || command === 'abort_rebase') {
          const snapshot = git.repository();
          return Promise.resolve({ ...snapshot, status: { ...snapshot.status,
            rebaseInProgress: !!(window as any).__pauseAgain && command === 'continue_rebase',
            rebaseEditStopped: !!(window as any).__pauseAgain && command === 'continue_rebase' } });
        }
        if (command === 'refresh_repository_status') return Promise.resolve({
          ...git.repository().status,
          ...((window as any).__editMarkerOnlyRefresh ? { rebaseEditStopped: false } : {}),
        });
        if (command === 'refresh_repository') return Promise.resolve(git.repository());
        return Promise.reject(new Error(`Unexpected command ${command}`));
      },
    };
  });
  await page.locator('.branch-item').filter({ hasText: 'feature/partial-staging' }).first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Interactive rebase main onto feature/partial-staging' }).click();
  await expect(page.getByRole('dialog', { name: 'Interactive rebase', exact: true })).toBeVisible();
});

for (const failure of [
  {
    kind: 'interactiveRebasePlanIncomplete',
    message: 'Interactive rebase supports at most 500 commits in one reviewed plan.',
    hint: 'Choose a smaller source range in local Git. No partial plan is offered.',
  },
  {
    kind: 'invalidInteractiveRebasePlan',
    message: 'Git returned incomplete or unsupported commit metadata for interactive rebase.',
    hint: 'Inspect the history in local Git. No commits are silently omitted or text replaced.',
  },
  {
    kind: 'branchInAnotherWorktree',
    message: 'The source branch is checked out in another worktree.',
    hint: 'Open its worktree to review and rebase that branch.',
  },
  {
    kind: 'historyOperationInProgress',
    message: 'Finish or abort the active Git operation before preparing interactive rebase.',
    hint: null,
  },
]) {
  test(`preparation refusal ${failure.kind} displays guidance without opening or executing a partial plan`, async ({ page }) => {
    await page.getByRole('button', { name: 'Close interactive rebase' }).click();
    await page.evaluate(error => { (window as any).__rebasePreparationError = error; }, failure);
    await page.locator('.branch-item').filter({ hasText: 'feature/partial-staging' }).first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Interactive rebase main onto feature/partial-staging' }).click();
    await expect(page.locator('.error-toast')).toContainText(failure.message);
    if (failure.hint) await expect(page.locator('.error-toast')).toContainText(failure.hint);
    await expect(page.getByRole('dialog', { name: 'Interactive rebase', exact: true })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (window as any).ng
      .getComponent(document.querySelector('gc-root')).git.busy())).toBe(false);
    expect(await page.evaluate(() => (window as any).__rebaseCalls
      .some((call: any) => call.command === 'execute_interactive_rebase'))).toBe(false);
    await page.evaluate(() => { (window as any).__rebasePreparationError = null; });
    await page.locator('.branch-item').filter({ hasText: 'feature/partial-staging' }).first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Interactive rebase main onto feature/partial-staging' }).click();
    await expect(page.getByRole('dialog', { name: 'Interactive rebase', exact: true })).toBeVisible();
    await expect(page.locator('.rebase-step')).toHaveCount(3);
    expect(await page.evaluate(() => (window as any).__rebaseCalls
      .some((call: any) => call.command === 'execute_interactive_rebase'))).toBe(false);
  });
}

test('Edit keyboard action sends the explicit stop and displays truthful pause and Continue-unchanged state', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Interactive rebase', exact: true });
  await expect(dialog).toContainText('Edit pauses for amendments');
  await dialog.locator('.rebase-step').filter({ hasText: 'First retained' }).click();
  await page.keyboard.press('e');
  await expect(dialog.getByLabel('Action for First retained')).toHaveValue('edit');
  await expect(dialog.getByLabel('New message for First retained')).toHaveCount(0);
  await page.evaluate(() => { (window as any).__editRebaseStop = true; });
  await dialog.getByRole('button', { name: 'Start Rebase', exact: true }).click();
  const status = page.getByRole('status', { name: 'Git rebase in progress' });
  await expect(status).toContainText('REBASE PAUSED FOR EDIT');
  await expect(status).toContainText('Continue unchanged');
  await expect(status.getByRole('button', { name: 'Skip', exact: true })).toHaveCount(0);
  await expect(status.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root'))
    .git.activity())).toContain('paused for Edit');
  const call = await page.evaluate(() => (window as any).__rebaseCalls.find((call: any) => call.command === 'execute_interactive_rebase'));
  expect(call.args.steps[0]).toEqual({ oid: '1'.repeat(40), action: 'edit', message: null });
  await status.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(status).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root'))
    .git.activity())).toBe('Interactive rebase complete');
  expect(await page.evaluate(() => (window as any).__rebaseCalls.some((call: any) => call.command === 'commit_changes'))).toBe(false);
});

test('Edit amendment retains the draft on hook refusal and requires explicit stage, Amend and Continue', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Interactive rebase', exact: true });
  await dialog.getByLabel('Action for First retained').selectOption('edit');
  await page.evaluate(() => { (window as any).__editRebaseStop = true; });
  await dialog.getByRole('button', { name: 'Start Rebase', exact: true }).click();
  const status = page.getByRole('status', { name: 'Git rebase in progress' });
  await expect(status).toContainText('REBASE PAUSED FOR EDIT');
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    app.git.repositories.update((repos: any[]) => repos.map(repo => ({ ...repo,
      status: { ...repo.status, unstaged: 1, entryCount: 1,
        entries: [{ path: 'edited-file.txt', indexStatus: '.', worktreeStatus: 'M', conflicted: false }] } })));
    (window as any).__editAmendFailure = true;
  });
  await expect(status.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Stage all changes', exact: true }).click();
  await expect(status.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
  await page.getByLabel('Amend previous commit', { exact: true }).check();
  await expect(page.getByLabel('Commit summary', { exact: true })).toHaveValue('First retained');
  await page.getByLabel('Commit summary', { exact: true }).fill('Reviewed edit amendment');
  await page.locator('.commit-form button[type=submit]').click();
  await expect(page.locator('.error-toast')).toContainText('hook refused the amendment');
  await expect(page.getByLabel('Commit summary', { exact: true })).toHaveValue('Reviewed edit amendment');
  await expect(page.getByLabel('Amend previous commit', { exact: true })).toBeChecked();
  await expect(status.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
  await page.evaluate(() => { (window as any).__editAmendFailure = false; });
  await page.locator('.commit-form button[type=submit]').click();
  await expect(status.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
  await expect(status).toContainText('REBASE PAUSED FOR EDIT');
  const calls = await page.evaluate(() => (window as any).__rebaseCalls.filter((call: any) => call.command === 'commit_changes'));
  expect(calls).toHaveLength(2);
  expect(calls[1].args).toMatchObject({ amend: true, skipHooks: false, message: expect.stringContaining('Reviewed edit amendment') });
  expect(await page.evaluate(() => (window as any).__rebaseCalls.some((call: any) => call.command === 'continue_rebase'))).toBe(false);
  await status.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(status).toHaveCount(0);
});

test('Continue to another Edit stop never announces completion and Abort remains explicit', async ({ page }) => {
  await page.evaluate(() => { (window as any).__editRebaseStop = true; (window as any).__pauseAgain = true; });
  const dialog = page.getByRole('dialog', { name: 'Interactive rebase', exact: true });
  await dialog.getByLabel('Action for First retained').selectOption('edit');
  await dialog.getByLabel('Action for Fixup change').selectOption('edit');
  await dialog.getByRole('button', { name: 'Start Rebase', exact: true }).click();
  const status = page.getByRole('status', { name: 'Git rebase in progress' });
  await status.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(status).toContainText('REBASE PAUSED FOR EDIT');
  expect(await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.activity()))
    .toContain('paused for Edit');
  await status.getByRole('button', { name: 'Abort', exact: true }).click();
  await expect(status).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__rebaseCalls
    .filter((call: any) => ['continue_rebase', 'abort_rebase'].includes(call.command)).map((call: any) => call.command)))
    .toEqual(['continue_rebase', 'abort_rebase']);
});

test('same-count status refresh removes an Edit stop without retaining stale pause guidance', async ({ page }) => {
  await page.evaluate(() => { (window as any).__editRebaseStop = true; });
  const dialog = page.getByRole('dialog', { name: 'Interactive rebase', exact: true });
  await dialog.getByLabel('Action for First retained').selectOption('edit');
  await dialog.getByRole('button', { name: 'Start Rebase', exact: true }).click();
  const status = page.getByRole('status', { name: 'Git rebase in progress' });
  await expect(status).toContainText('REBASE PAUSED FOR EDIT');
  await page.evaluate(async () => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    (window as any).__editMarkerOnlyRefresh = true;
    await app.git.refreshStatusInBackground(app.git.activeRepositoryId(), true);
  });
  await expect(status).toContainText('REBASE IN PROGRESS');
  await expect(status).not.toContainText('Continue unchanged');
  await expect(status.getByRole('button', { name: 'Skip', exact: true })).toBeVisible();
});

test('autosquash previews exact targets and stable actions without starting Git, then Reset restores original order', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Interactive rebase', exact: true });
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const state = app.interactiveRebase();
    const steps = state.steps.map((step: any, index: number) => ({
      ...step, subject: ['Target message', 'Independent', 'fixup! Target message'][index],
    }));
    const squash = { ...steps[2], oid: '4'.repeat(40), subject: 'squash! 11111111', message: 'Squash details' };
    app.interactiveRebase.set({ ...state, original: [...steps, squash], steps: [...steps, squash] });
  });
  await dialog.getByRole('button', { name: 'Preview autosquash', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Matched 2 commit(s)');
  await expect(dialog.getByRole('status')).toContainText('no Git command has run');
  expect(await dialog.locator('.rebase-commit-copy strong').allTextContents())
    .toEqual(['Target message', 'fixup! Target message', 'squash! 11111111', 'Independent']);
  await expect(dialog.getByLabel('Action for fixup! Target message', { exact: true })).toHaveValue('fixup');
  await expect(dialog.getByLabel('Action for squash! 11111111', { exact: true })).toHaveValue('squash');
  expect(await page.evaluate(() => (window as any).__rebaseCalls.some((call: any) => call.command === 'execute_interactive_rebase'))).toBe(false);
  await dialog.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveCount(0);
  expect(await dialog.locator('.rebase-commit-copy strong').allTextContents())
    .toEqual(['Target message', 'Independent', 'fixup! Target message', 'squash! 11111111']);
  await expect(dialog.getByLabel('Action for fixup! Target message', { exact: true })).toHaveValue('pick');
  await dialog.getByRole('button', { name: 'Preview autosquash', exact: true }).click();
  await dialog.getByRole('button', { name: 'Start Rebase', exact: true }).click();
  const call = await page.evaluate(() => (window as any).__rebaseCalls.find((call: any) => call.command === 'execute_interactive_rebase'));
  expect(call.args.steps).toEqual([
    { oid: '1'.repeat(40), action: 'pick', message: null },
    { oid: '3'.repeat(40), action: 'fixup', message: null },
    { oid: '4'.repeat(40), action: 'squash', message: null },
    { oid: '2'.repeat(40), action: 'pick', message: null },
  ]);
});

test('autosquash refuses ambiguous or unsupported targets and preserves manual actions and reword drafts', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Interactive rebase', exact: true });
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const state = app.interactiveRebase();
    app.interactiveRebase.set({ ...state, steps: state.steps.map((step: any, index: number) => ({
      ...step, subject: index === 2 ? 'fixup! Duplicate' : 'Duplicate',
    })) });
  });
  await dialog.getByRole('button', { name: 'Preview autosquash', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Ambiguous autosquash target');
  expect(await dialog.locator('.rebase-commit-copy strong').allTextContents()).toEqual(['Duplicate', 'Duplicate', 'fixup! Duplicate']);
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const state = app.interactiveRebase();
    app.interactiveRebase.set({ ...state, steps: state.original });
  });
  await dialog.getByLabel('Action for First retained').selectOption('reword');
  await dialog.getByLabel('New message for First retained').fill('My manual draft');
  await dialog.getByRole('button', { name: 'Preview autosquash', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Reset first, or keep your manual actions');
  await expect(dialog.getByLabel('New message for First retained')).toHaveValue('My manual draft');
  await expect(dialog.getByLabel('Action for First retained')).toHaveValue('reword');
  expect(await page.evaluate(() => (window as any).__rebaseCalls.some((call: any) => call.command === 'execute_interactive_rebase'))).toBe(false);
});

test('move buttons preserve drafts and actions, retain row focus and require explicit invalid-recipient correction', async ({ page }) => {
  await page.setViewportSize({ width: 550, height: 700 });
  const dialog = page.getByRole('dialog', { name: 'Interactive rebase', exact: true });
  await expect(dialog.getByRole('button', { name: 'Move First retained up', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Move Last commit down', exact: true })).toBeDisabled();
  await dialog.getByLabel('Action for First retained').selectOption('reword');
  await dialog.getByLabel('New message for First retained').fill('Keep this reordered draft');
  await dialog.getByLabel('Action for Fixup change').selectOption('fixup');
  await dialog.getByRole('button', { name: 'Move Fixup change up', exact: true }).click();
  const moved = dialog.locator('[data-rebase-oid]').filter({ hasText: 'Fixup change' });
  await expect(moved).toBeFocused();
  await expect(dialog.locator('[data-rebase-oid]').first()).toHaveAttribute('data-rebase-oid', '2'.repeat(40));
  await expect(dialog.getByLabel('Action for Fixup change')).toHaveValue('fixup');
  await expect(dialog.getByRole('button', { name: 'Start Rebase', exact: true })).toBeDisabled();
  await expect(dialog.getByLabel('New message for First retained')).toHaveValue('Keep this reordered draft');
  await expect(dialog.locator('[aria-live=polite]')).toContainText('Moved Fixup change to position 1 of 3');
  await moved.press('Alt+ArrowDown');
  await expect(moved).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Start Rebase', exact: true })).toBeEnabled();
  await expect(dialog.locator('.rebase-commit-copy strong')).toHaveText(['First retained', 'Fixup change', 'Last commit']);
  const bounds = await dialog.getByRole('button', { name: 'Move Fixup change down', exact: true }).boundingBox();
  expect(bounds!.width).toBeGreaterThanOrEqual(24);
  expect(bounds!.height).toBeGreaterThanOrEqual(24);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(550);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(700);
  expect(await page.evaluate(() => (window as any).__rebaseCalls.some((call: any) => call.command === 'execute_interactive_rebase'))).toBe(false);
});

test('keyboard row moves preserve selected shortcut target and send the exact reviewed order only on Start', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Interactive rebase', exact: true });
  const last = dialog.locator('[data-rebase-oid]').filter({ hasText: 'Last commit' });
  await last.focus();
  await last.press('Alt+ArrowUp');
  await last.press('Alt+ArrowUp');
  await last.press('Alt+ArrowUp');
  await expect(last).toBeFocused();
  expect(await dialog.locator('.rebase-commit-copy strong').allTextContents()).toEqual(['Last commit', 'First retained', 'Fixup change']);
  await last.press('e');
  await expect(dialog.getByLabel('Action for Last commit')).toHaveValue('edit');
  await dialog.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(dialog.locator('.rebase-commit-copy strong')).toHaveText(['First retained', 'Fixup change', 'Last commit']);
  await expect(dialog.locator('[aria-live=polite]')).toBeEmpty();
  await last.focus();
  await last.press('Alt+ArrowUp');
  await dialog.getByRole('button', { name: 'Start Rebase', exact: true }).click();
  const call = await page.evaluate(() => (window as any).__rebaseCalls.find((call: any) => call.command === 'execute_interactive_rebase'));
  expect(call.args.steps.map((step: any) => step.oid)).toEqual(['1'.repeat(40), '3'.repeat(40), '2'.repeat(40)]);
});

test('plain arrow keys and Alt arrows in reword text never reorder or corrupt drafts', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Interactive rebase', exact: true });
  await dialog.getByLabel('Action for Fixup change').selectOption('reword');
  const textarea = dialog.getByLabel('New message for Fixup change');
  await textarea.fill('Draft line one\nDraft line two');
  await textarea.press('Alt+ArrowUp');
  await textarea.press('ArrowUp');
  await expect(textarea).toHaveValue('Draft line one\nDraft line two');
  expect(await dialog.locator('.rebase-commit-copy strong').allTextContents()).toEqual(['First retained', 'Fixup change', 'Last commit']);
  expect(await page.evaluate(() => (window as any).__rebaseCalls.some((call: any) => call.command === 'execute_interactive_rebase'))).toBe(false);
});

test('fixup explains message retention and sends the exact explicit action', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Interactive rebase', exact: true });
  await expect(dialog).toContainText('Fixup keeps the preceding message');
  await expect(dialog).toContainText('Original tip is saved for recovery');
  await expect(dialog.getByLabel('Action for First retained').locator('option[value="fixup"]')).toBeDisabled();
  await dialog.getByLabel('Action for Fixup change').selectOption('fixup');
  await expect(dialog.getByLabel('Action for Fixup change')).toHaveValue('fixup');
  await dialog.getByRole('button', { name: 'Start Rebase', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const calls = await page.evaluate(() => (window as any).__rebaseCalls
    .filter((call: any) => call.command === 'execute_interactive_rebase'));
  expect(calls).toEqual([expect.objectContaining({ args: expect.objectContaining({
    source: 'main', target: 'feature/partial-staging', steps: [
      { oid: '1'.repeat(40), action: 'pick', message: null },
      { oid: '2'.repeat(40), action: 'fixup', message: null },
      { oid: '3'.repeat(40), action: 'pick', message: null },
    ],
  }) })]);
});

test('dropping the recipient keeps fixup visible but disables execution until explicitly corrected', async ({ page }) => {
  await page.setViewportSize({ width: 550, height: 700 });
  const dialog = page.getByRole('dialog', { name: 'Interactive rebase', exact: true });
  await dialog.getByLabel('Action for Fixup change').selectOption('fixup');
  await dialog.getByLabel('Action for First retained').selectOption('drop');
  await expect(dialog.getByLabel('Action for Fixup change')).toHaveValue('fixup');
  await expect(dialog.getByLabel('Action for Fixup change').locator('option[value="fixup"]')).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Start Rebase', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as any).__rebaseCalls
    .some((call: any) => call.command === 'execute_interactive_rebase'))).toBe(false);
  await dialog.getByLabel('Action for Fixup change').selectOption('pick');
  await expect(dialog.getByRole('button', { name: 'Start Rebase', exact: true })).toBeEnabled();
  const start = await dialog.getByRole('button', { name: 'Start Rebase', exact: true }).boundingBox();
  expect(start).not.toBeNull();
  expect(start!.x + start!.width).toBeLessThanOrEqual(550);
  expect(start!.y + start!.height).toBeLessThanOrEqual(700);
});

test('keyboard fixup preserves reword text and Reset restores original actions', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Interactive rebase', exact: true });
  await dialog.getByLabel('Action for First retained').selectOption('reword');
  await dialog.getByLabel('New message for First retained').fill('Rewritten retained message');
  await dialog.locator('.rebase-step').filter({ hasText: 'Fixup change' }).click();
  await page.keyboard.press('f');
  await expect(dialog.getByLabel('Action for Fixup change')).toHaveValue('fixup');
  await expect(dialog.getByLabel('New message for First retained')).toHaveValue('Rewritten retained message');
  await dialog.getByRole('button', { name: 'Reset', exact: true }).click();
  for (const subject of ['First retained', 'Fixup change', 'Last commit']) {
    await expect(dialog.getByLabel(`Action for ${subject}`)).toHaveValue('pick');
  }
  await expect(dialog.getByLabel('New message for First retained')).toHaveCount(0);
});

test('reordering fixup before its recipient never silently changes it to Pick', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Interactive rebase', exact: true });
  await dialog.getByLabel('Action for Fixup change').selectOption('fixup');
  const source = dialog.locator('.rebase-step').filter({ hasText: 'Fixup change' });
  const target = dialog.locator('.rebase-step').filter({ hasText: 'First retained' });
  await source.dragTo(target);
  await expect(dialog.locator('.rebase-step').first().getByLabel('Action for Fixup change')).toHaveValue('fixup');
  await expect(dialog.getByRole('button', { name: 'Start Rebase', exact: true })).toBeDisabled();
  await dialog.getByLabel('Action for Fixup change').selectOption('pick');
  await expect(dialog.getByRole('button', { name: 'Start Rebase', exact: true })).toBeEnabled();
});

test('changing repositories closes the plan and refuses stale execution against another repository', async ({ page }) => {
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    (window as any).__savedRebase = app.interactiveRebase();
    const other = { ...app.git.repository(), id: 'other-fixture', name: 'Other fixture' };
    app.git.repositories.update((repositories: any[]) => [...repositories, other]);
    app.git.activeRepositoryId.set(other.id);
  });
  await expect(page.getByRole('dialog', { name: 'Interactive rebase', exact: true })).toHaveCount(0);
  await page.evaluate(async () => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    app.interactiveRebase.set((window as any).__savedRebase);
    await app.executeInteractiveRebase();
  });
  await expect(page.locator('.error-toast')).toContainText('active repository changed');
  expect(await page.evaluate(() => (window as any).__rebaseCalls
    .some((call: any) => call.command === 'execute_interactive_rebase'))).toBe(false);
});

test('late preparation cannot reopen a plan after switching away and back', async ({ page }) => {
  await page.getByRole('button', { name: 'Close interactive rebase' }).click();
  await page.evaluate(() => { (window as any).__deferRebasePreparation = true; });
  await page.locator('.branch-item').filter({ hasText: 'feature/partial-staging' }).first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Interactive rebase main onto feature/partial-staging' }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__resolveRebasePreparation)).toBe('function');
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    (window as any).__originalRepositoryId = app.git.activeRepositoryId();
    const other = { ...app.git.repository(), id: 'other-fixture', name: 'Other fixture' };
    app.git.repositories.update((repositories: any[]) => [...repositories, other]);
    app.git.activeRepositoryId.set(other.id);
  });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    app.git.activeRepositoryId.set((window as any).__originalRepositoryId);
  });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.evaluate(() => (window as any).__resolveRebasePreparation());
  await expect.poll(() => page.evaluate(() => (window as any).ng
    .getComponent(document.querySelector('gc-root')).git.busy())).toBe(false);
  await expect(page.getByRole('dialog', { name: 'Interactive rebase', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__rebaseCalls
    .some((call: any) => call.command === 'execute_interactive_rebase'))).toBe(false);
});
