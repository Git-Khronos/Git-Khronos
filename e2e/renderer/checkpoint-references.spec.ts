import { expect, test, type Page } from '@playwright/test';

const privateRef = 'refs/copilot/checkpoints/session-a/one/checkpoint';
const sharedRef = 'refs/copilot/checkpoints/session-b/two/checkpoint';
const secondSharedRef = 'refs/copilot/checkpoints/session-b/three/checkpoint';
const privateOid = 'a'.repeat(40);

async function installCheckpointFixture(page: Page): Promise<void> {
  await page.evaluate(({ privateRef, sharedRef, secondSharedRef, privateOid }) => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    const base = structuredClone(git.repository());
    const state = {
      git,
      base,
      calls: [] as Array<{ command: string; args: Record<string, unknown> }>,
      refs: [
        { name: privateRef, oid: privateOid },
        { name: sharedRef, oid: base.headOid },
        { name: secondSharedRef, oid: base.headOid },
      ],
      show: false,
      rejectDelete: false,
      rejectVisibility: false,
      delayHistory: false,
      delayRefresh: false,
      delayStatus: false,
      delayOpen: false,
      statusOverride: null as null | unknown,
      resolvePage: null as null | ((page: unknown) => void),
      resolveRefresh: null as null | ((snapshot: unknown) => void),
      resolveStatus: null as null | ((status: unknown) => void),
      resolveOpen: null as null | ((snapshot: unknown) => void),
    };
    const snapshot = () => {
      const current = structuredClone(base);
      current.showCheckpoints = state.show;
      if (!state.show) return current;
      for (const commit of current.commits) {
        commit.decorations = commit.decorations.map((decoration: string) => {
          const head = decoration.startsWith('HEAD -> ');
          const label = decoration.replace(/^HEAD -> /, '');
          const fullName = /^(heads|remotes)\//.test(label) ? `refs/${label}` : label;
          const branch = current.branches.find((item: { fullName: string; name: string }) =>
            item.fullName === fullName || item.name === label);
          return branch ? `${head ? 'HEAD -> ' : ''}${branch.fullName}` : decoration;
        });
      }
      const head = current.commits.find((commit: { oid: string }) => commit.oid === base.headOid);
      head.decorations.push(...state.refs.filter((ref) => ref.oid === base.headOid).map((ref) => ref.name));
      const privateCheckpoint = state.refs.find((ref) => ref.name === privateRef);
      if (privateCheckpoint) {
        current.commits.unshift({
          ...head,
          oid: privateCheckpoint.oid,
          parents: [base.headOid],
          subject: 'Checkpoint-only commit',
          decorations: [privateRef],
        });
      }
      return current;
    };
    (window as any).__checkpointTest = { ...state, snapshot };
    const fixture = (window as any).__checkpointTest;
    (window as any).__TAURI_INTERNALS__ = {
      invoke: (command: string, args: Record<string, unknown> = {}) => {
        fixture.calls.push({ command, args });
        if (command === 'set_checkpoint_visibility') {
          if (fixture.rejectVisibility) {
            return Promise.reject({ kind: 'gitFailure', message: 'Could not refresh checkpoint history.' });
          }
          fixture.show = args['show'];
          state.show = fixture.show;
          return Promise.resolve(snapshot());
        }
        if (command === 'delete_checkpoint_reference') {
          if (fixture.rejectDelete) {
            const checkpoint = state.refs.find((ref) => ref.name === args['reference']);
            if (checkpoint) checkpoint.oid = 'd'.repeat(40);
            return Promise.reject({ kind: 'checkpointChanged', message: 'That checkpoint has moved or no longer exists.' });
          }
          const index = state.refs.findIndex((ref) => ref.name === args['reference'] && ref.oid === args['expectedOid']);
          if (index < 0) return Promise.reject({ kind: 'checkpointChanged', message: 'That checkpoint has moved or no longer exists.' });
          state.refs.splice(index, 1);
          return Promise.resolve(snapshot());
        }
        if (command === 'load_more_commits' && fixture.delayHistory) {
          return new Promise((resolve) => { fixture.resolvePage = resolve; });
        }
        if (command === 'refresh_repository') {
          if (fixture.delayRefresh) return new Promise((resolve) => { fixture.resolveRefresh = resolve; });
          return Promise.resolve(snapshot());
        }
        if (command === 'open_repository') {
          if (fixture.delayOpen) return new Promise((resolve) => { fixture.resolveOpen = resolve; });
          return Promise.resolve(snapshot());
        }
        if (command === 'refresh_repository_status') {
          if (fixture.delayStatus) return new Promise((resolve) => { fixture.resolveStatus = resolve; });
          return Promise.resolve(fixture.statusOverride ?? base.status);
        }
        if (command === 'stage_path') return Promise.resolve(base.status);
        if (command === 'sync_repository' || command === 'inspect_commit') return Promise.resolve(null);
        return Promise.reject(new Error(`Unexpected command: ${command}`));
      },
    };
    git.systemInfo.set({
      appVersion: 'renderer test',
      gitVersion: '2.50.0',
      gitSupported: true,
      minimumGitVersion: '2.34.0',
    });
  }, { privateRef, sharedRef, secondSharedRef, privateOid });
}

async function showCheckpoints(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Configure graph columns' }).click();
  const checkbox = page.getByRole('checkbox', { name: 'Show Copilot checkpoints' });
  await expect(checkbox).not.toBeChecked();
  await checkbox.check();
  await expect(checkbox).toBeChecked();
  await page.getByRole('button', { name: 'Configure graph columns' }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await installCheckpointFixture(page);
});

test('shows and hides checkpoint history without deleting references', async ({ page }) => {
  await expect(page.getByText('Checkpoint-only commit')).toHaveCount(0);
  await showCheckpoints(page);
  await expect(page.getByText('Checkpoint-only commit')).toBeVisible();
  await expect(page.locator('.commit-row').getByRole('button', { name: `Copilot checkpoint ${privateRef}` })).toBeVisible();

  await page.getByRole('button', { name: 'Configure graph columns' }).click();
  await page.getByRole('checkbox', { name: 'Show Copilot checkpoints' }).uncheck();
  await expect(page.getByText('Checkpoint-only commit')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__checkpointTest.calls
    .filter((call: { command: string }) => call.command === 'set_checkpoint_visibility' || call.command === 'delete_checkpoint_reference')
    .map((call: { command: string; args: Record<string, unknown> }) => ({ command: call.command, show: call.args['show'] })))).toEqual([
    { command: 'set_checkpoint_visibility', show: true },
    { command: 'set_checkpoint_visibility', show: false },
  ]);
});

test('requires confirmation and deletes only the reviewed checkpoint', async ({ page }) => {
  await showCheckpoints(page);
  const checkpoint = page.locator('.commit-row').getByRole('button', { name: `Copilot checkpoint ${privateRef}` });
  await checkpoint.click({ button: 'right' });
  let menu = page.locator('.context-menu[role="menu"]');
  await expect(menu.getByText('Copilot checkpoint', { exact: true })).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Delete checkpoint reference…' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Delete checkpoint reference?' });
  await expect(dialog).toContainText(privateRef);
  await expect(dialog).toContainText('may prevent Copilot from recovering');
  await page.setViewportSize({ width: 420, height: 540 });
  const bounds = await dialog.boundingBox();
  expect(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 540).toBe(true);
  expect(await dialog.locator('.confirmation-copy').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  const cancel = dialog.getByRole('button', { name: 'Cancel' });
  const confirm = dialog.getByRole('button', { name: 'Delete checkpoint reference' });
  await expect(cancel).toBeFocused();
  await cancel.press('Shift+Tab');
  await expect(confirm).toBeFocused();
  await confirm.press('Tab');
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Close commit panel' })).toBeFocused();
  await page.setViewportSize({ width: 1440, height: 900 });
  await checkpoint.focus();
  await checkpoint.press('Shift+F10');
  menu = page.locator('.context-menu[role="menu"]');
  await menu.getByRole('menuitem', { name: 'Delete checkpoint reference…' }).click();
  await page.keyboard.press('Escape');
  await expect(checkpoint).toBeFocused();
  expect(await page.evaluate(() => (window as any).__checkpointTest.calls
    .filter((call: { command: string }) => call.command === 'delete_checkpoint_reference'))).toHaveLength(0);

  await checkpoint.press('Shift+F10');
  menu = page.locator('.context-menu[role="menu"]');
  await expect(menu.getByRole('menuitem', { name: 'Copy checkpoint reference' })).toBeFocused();
  await menu.getByRole('menuitem', { name: 'Delete checkpoint reference…' }).click();
  await dialog.getByRole('button', { name: 'Delete checkpoint reference' }).click();
  await expect(page.getByText('Checkpoint-only commit')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__checkpointTest.calls
    .filter((call: { command: string }) => call.command === 'delete_checkpoint_reference')
    .map((call: { args: Record<string, unknown> }) => call.args))).toEqual([
    { repoId: 'browser-preview', reference: privateRef, expectedOid: privateOid },
  ]);
});

test('keeps checkpoints on shared commits individually accessible in graph and inspector', async ({ page }) => {
  await showCheckpoints(page);
  const headOid = await page.evaluate(() => (window as any).__checkpointTest.base.headOid);
  const row = page.locator(`.commit-row[data-commit-oid="${headOid}"]`);
  const trigger = row.locator('.reference-stack-trigger');
  await trigger.click();
  const first = row.getByRole('menuitem', { name: `Copilot checkpoint ${sharedRef}` });
  const second = row.getByRole('menuitem', { name: `Copilot checkpoint ${secondSharedRef}` });
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  await first.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete checkpoint reference…' }).click();
  await expect(page.getByRole('alertdialog')).toContainText(sharedRef);
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete checkpoint reference' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__checkpointTest.calls
    .some((call: { command: string }) => call.command === 'delete_checkpoint_reference'))).toBe(true);
  await trigger.click();
  await expect(row.getByRole('menuitem', { name: `Copilot checkpoint ${sharedRef}` })).toHaveCount(0);
  await expect(row.getByRole('menuitem', { name: `Copilot checkpoint ${secondSharedRef}` })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__checkpointTest.calls
    .find((call: { command: string }) => call.command === 'delete_checkpoint_reference').args)).toEqual({
    repoId: 'browser-preview', reference: sharedRef, expectedOid: headOid,
  });

  await page.keyboard.press('Escape');
  await row.click();
  const inspector = page.locator('.commit-detail-refs');
  await inspector.locator('.reference-stack-trigger').click();
  const detailCheckpoint = inspector.getByRole('menuitem', { name: `Copilot checkpoint ${secondSharedRef}` });
  await detailCheckpoint.focus();
  await detailCheckpoint.press('ContextMenu');
  await page.getByRole('menuitem', { name: 'Delete checkpoint reference…' }).click();
  await expect(page.getByRole('alertdialog')).toContainText(secondSharedRef);
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
});

test('keeps branch and tag actions available with full reference names', async ({ page }) => {
  await showCheckpoints(page);
  const { headOid, mergeOid } = await page.evaluate(() => {
    const base = (window as any).__checkpointTest.base;
    return {
      headOid: base.headOid,
      mergeOid: base.commits.find((commit: { subject: string }) =>
        commit.subject === 'Merge feature/partial-staging').oid,
    };
  });
  const head = page.locator(`.commit-row[data-commit-oid="${headOid}"]`);
  await head.locator('.reference-stack-trigger').click();
  await head.getByRole('menuitem', { name: 'Current local branch main' }).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Copy branch name' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  const merge = page.locator(`.commit-row[data-commit-oid="${mergeOid}"]`);
  await page.mouse.move(0, 0);
  const mergeTrigger = merge.locator('.reference-stack-trigger');
  await mergeTrigger.focus();
  await mergeTrigger.press('Enter');
  const remote = merge.getByRole('menuitem', { name: 'Remote branch origin/main' });
  await remote.focus();
  await remote.press('ContextMenu');
  await expect(page.getByRole('menuitem', { name: 'Copy remote branch name' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  const tag = page.locator('.commit-row').getByRole('button', { name: 'Tag v0.1.0' });
  await tag.focus();
  await tag.press('ContextMenu');
  await expect(page.getByRole('menuitem', { name: 'Copy tag name' })).toBeVisible();
});

test('distinguishes a checkpoint from a similarly named branch on the same commit', async ({ page }) => {
  await showCheckpoints(page);
  const headOid = await page.evaluate(({ sharedRef }) => {
    const state = (window as any).__checkpointTest;
    const headOid = state.base.headOid;
    state.git.repositories.update((repositories: any[]) => repositories.map((repository) =>
      repository.id === 'browser-preview' ? {
        ...repository,
        branches: [...repository.branches, {
          fullName: `refs/heads/${sharedRef}`,
          name: sharedRef,
          oid: headOid,
          current: false,
          remote: false,
          upstream: null,
          tracking: null,
        }],
        commits: repository.commits.map((commit: any) => commit.oid === headOid
          ? { ...commit, decorations: [...commit.decorations, `refs/heads/${sharedRef}`] }
          : commit),
      } : repository));
    return headOid;
  }, { sharedRef });

  const row = page.locator(`.commit-row[data-commit-oid="${headOid}"]`);
  await row.locator('.reference-stack-trigger').click();
  await expect(row.getByRole('menuitem', { name: `Local branch ${sharedRef}` })).toBeVisible();
  const checkpoint = row.getByRole('menuitem', { name: `Copilot checkpoint ${sharedRef}` });
  await expect(checkpoint).toBeVisible();
  await checkpoint.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete checkpoint reference…' }).click();
  await expect(page.getByRole('alertdialog')).toContainText(sharedRef);
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
});

test('keeps checkpoint history visible when a similarly named branch is hidden', async ({ page }) => {
  await showCheckpoints(page);
  await page.evaluate(({ privateRef, privateOid }) => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    git.repositories.update((repositories: any[]) => repositories.map((repository) =>
      repository.id === 'browser-preview' ? {
        ...repository,
        branches: [...repository.branches, {
          fullName: `refs/heads/${privateRef}`,
          name: privateRef,
          oid: privateOid,
          current: false,
          remote: false,
          upstream: null,
          tracking: null,
        }],
      } : repository));
    app.hiddenBranches.set([privateRef]);
  }, { privateRef, privateOid });

  await expect(page.getByText('Checkpoint-only commit')).toBeVisible();
  await expect(page.getByRole('button', { name: `Copilot checkpoint ${privateRef}` })).toBeVisible();
});

test('reports a moved checkpoint and refuses to delete after switching repositories', async ({ page }) => {
  await showCheckpoints(page);
  const checkpoint = page.locator('.commit-row').getByRole('button', { name: `Copilot checkpoint ${privateRef}` });
  await page.locator(`.commit-row[data-commit-oid="${privateOid}"]`).click();
  await page.evaluate(() => { (window as any).__checkpointTest.rejectDelete = true; });
  await checkpoint.click();
  await page.getByRole('menuitem', { name: 'Delete checkpoint reference…' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete checkpoint reference' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__checkpointTest.git.error()))
    .toContain('checkpoint has moved or no longer exists');
  await expect(checkpoint).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).changesOpen()))
    .toBe(true);

  await checkpoint.click();
  await page.getByRole('menuitem', { name: 'Delete checkpoint reference…' }).click();
  await page.evaluate(() => {
    const { git, base } = (window as any).__checkpointTest;
    git.repositories.update((repositories: unknown[]) => [...repositories, { ...base, id: 'another-repository' }]);
    git.activeRepositoryId.set('another-repository');
  });
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete checkpoint reference' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__checkpointTest.git.error()))
    .toContain('active repository changed');
  expect(await page.evaluate(() => (window as any).__checkpointTest.calls
    .filter((call: { command: string }) => call.command === 'delete_checkpoint_reference'))).toHaveLength(1);
});

test('restores the checkbox if changing checkpoint visibility fails', async ({ page }) => {
  await page.evaluate(() => {
    const state = (window as any).__checkpointTest;
    state.rejectVisibility = true;
    state.delayRefresh = true;
  });
  await page.getByRole('button', { name: 'Configure graph columns' }).click();
  const checkbox = page.getByRole('checkbox', { name: 'Show Copilot checkpoints' });
  await checkbox.click();
  await expect.poll(() => page.evaluate(() => !!(window as any).__checkpointTest.resolveRefresh)).toBe(true);
  await expect(checkbox).toBeDisabled();
  await page.evaluate(() => {
    const state = (window as any).__checkpointTest;
    state.resolveRefresh(state.snapshot());
  });
  await expect.poll(() => page.evaluate(() => (window as any).__checkpointTest.git.error()))
    .toContain('Could not refresh checkpoint history');
  await expect(checkbox).not.toBeChecked();
  await expect(checkbox).toBeEnabled();
});

test('resumes a requested history page after failed visibility recovery', async ({ page }) => {
  await page.evaluate(() => {
    const state = (window as any).__checkpointTest;
    state.rejectVisibility = true;
    state.delayRefresh = true;
    state.delayHistory = true;
  });
  await page.getByRole('button', { name: 'Configure graph columns' }).click();
  const checkbox = page.getByRole('checkbox', { name: 'Show Copilot checkpoints' });
  await checkbox.click();
  await expect.poll(() => page.evaluate(() => !!(window as any).__checkpointTest.resolveRefresh)).toBe(true);

  await page.evaluate(() => {
    const state = (window as any).__checkpointTest;
    state.base.historyTruncated = true;
    state.git.repositories.update((repositories: any[]) => repositories.map((repository) =>
      repository.id === 'browser-preview' ? { ...repository, historyTruncated: true } : repository));
    void state.git.loadMoreHistory();
  });
  expect(await page.evaluate(() => (window as any).__checkpointTest.calls
    .filter((call: { command: string }) => call.command === 'load_more_commits'))).toHaveLength(0);
  await expect(checkbox).toBeDisabled();

  await page.evaluate(() => {
    const state = (window as any).__checkpointTest;
    state.resolveRefresh(state.snapshot());
  });
  await expect.poll(() => page.evaluate(() => !!(window as any).__checkpointTest.resolvePage)).toBe(true);
  await page.evaluate(() => {
    const state = (window as any).__checkpointTest;
    const older = { ...state.base.commits.at(-1), oid: 'd'.repeat(40), subject: 'Recovered history', parents: [] };
    state.resolvePage({ commits: [older], historyTruncated: false });
  });
  await expect.poll(() => page.evaluate(() => (window as any).__checkpointTest.git.repository().commits
    .some((commit: { subject: string }) => commit.subject === 'Recovered history'))).toBe(true);
  await expect(checkbox).not.toBeChecked();
  await expect(checkbox).toBeEnabled();
});

test('waits for an in-flight history page before refreshing its cursor', async ({ page }) => {
  await page.evaluate(() => {
    const state = (window as any).__checkpointTest;
    state.delayHistory = true;
    state.git.repositories.update((repositories: any[]) => repositories.map((repository) =>
      repository.id === 'browser-preview' ? { ...repository, historyTruncated: true } : repository));
    void state.git.loadMoreHistory();
    void state.git.refreshRepositoryInBackground('browser-preview');
  });
  await expect.poll(() => page.evaluate(() => !!(window as any).__checkpointTest.resolvePage)).toBe(true);
  expect(await page.evaluate(() => (window as any).__checkpointTest.calls
    .filter((call: { command: string }) => call.command === 'refresh_repository'))).toHaveLength(0);
  await page.getByRole('button', { name: 'Configure graph columns' }).click();
  await expect(page.getByRole('checkbox', { name: 'Show Copilot checkpoints' })).toBeDisabled();
  await page.evaluate(() => {
    const state = (window as any).__checkpointTest;
    state.resolvePage({ commits: [], historyTruncated: false });
  });
  await expect.poll(() => page.evaluate(() => (window as any).__checkpointTest.calls
    .filter((call: { command: string }) => call.command === 'refresh_repository').length)).toBe(1);
  await expect(page.getByRole('checkbox', { name: 'Show Copilot checkpoints' })).toBeEnabled();
});

test('waits for an in-flight history page before reopening a repository', async ({ page }) => {
  await page.evaluate(() => {
    const state = (window as any).__checkpointTest;
    state.delayHistory = true;
    state.git.repositories.update((repositories: any[]) => repositories.map((repository) =>
      repository.id === 'browser-preview' ? { ...repository, historyTruncated: true } : repository));
    void state.git.loadMoreHistory();
    void state.git.openRepository(state.base.path);
  });
  await expect.poll(() => page.evaluate(() => !!(window as any).__checkpointTest.resolvePage)).toBe(true);
  expect(await page.evaluate(() => (window as any).__checkpointTest.calls
    .filter((call: { command: string }) => call.command === 'open_repository'))).toHaveLength(0);
  await page.evaluate(() => {
    const state = (window as any).__checkpointTest;
    state.resolvePage({ commits: [], historyTruncated: false });
  });
  await expect.poll(() => page.evaluate(() => (window as any).__checkpointTest.calls
    .some((call: { command: string }) => call.command === 'open_repository'))).toBe(true);
});

test('waits for an in-flight page before restoring the active workspace repository', async ({ page }) => {
  await page.evaluate(() => {
    const state = (window as any).__checkpointTest;
    state.delayHistory = true;
    state.git.workspaces.update((workspaces: any[]) => workspaces.map((workspace) =>
      workspace.id === state.git.activeWorkspaceId()
        ? { ...workspace, repositoryPaths: [state.base.path], activeRepositoryPath: state.base.path }
        : workspace));
    state.git.repositories.update((repositories: any[]) => repositories.map((repository) =>
      repository.id === 'browser-preview' ? { ...repository, historyTruncated: true } : repository));
    void state.git.loadMoreHistory();
    void state.git.restoreRepositories();
  });
  await expect.poll(() => page.evaluate(() => !!(window as any).__checkpointTest.resolvePage)).toBe(true);
  expect(await page.evaluate(() => (window as any).__checkpointTest.calls
    .filter((call: { command: string }) => call.command === 'open_repository'))).toHaveLength(0);
  await page.evaluate(() => {
    const state = (window as any).__checkpointTest;
    state.resolvePage({ commits: [], historyTruncated: false });
  });
  await expect.poll(() => page.evaluate(() => (window as any).__checkpointTest.calls
    .some((call: { command: string }) => call.command === 'open_repository'))).toBe(true);
});

test('resumes history paging after a workspace tab is restored', async ({ page }) => {
  await page.evaluate(() => {
    const state = (window as any).__checkpointTest;
    state.delayOpen = true;
    state.delayHistory = true;
    state.base.historyTruncated = true;
    state.git.repositories.update((repositories: any[]) => repositories.map((repository) =>
      repository.id === 'browser-preview' ? { ...repository, historyTruncated: true } : repository));
    void state.git.restoreRepositoryTabs([state.base.path], [state.base.path], state.git.activeWorkspaceId());
    void state.git.loadMoreHistory();
  });
  await expect.poll(() => page.evaluate(() => !!(window as any).__checkpointTest.resolveOpen)).toBe(true);
  expect(await page.evaluate(() => (window as any).__checkpointTest.calls
    .filter((call: { command: string }) => call.command === 'load_more_commits'))).toHaveLength(0);
  await page.evaluate(() => {
    const state = (window as any).__checkpointTest;
    state.resolveOpen(state.snapshot());
  });
  await expect.poll(() => page.evaluate(() => !!(window as any).__checkpointTest.resolvePage)).toBe(true);
  await page.evaluate(() => {
    const state = (window as any).__checkpointTest;
    state.resolvePage({ commits: [], historyTruncated: false });
  });
  await expect.poll(() => page.evaluate(() => (window as any).__checkpointTest.git.repository().historyTruncated)).toBe(false);
});

test('retains a history page when a working-tree mutation starts during its load', async ({ page }) => {
  await page.evaluate(() => {
    const state = (window as any).__checkpointTest;
    state.delayHistory = true;
    state.git.repositories.update((repositories: any[]) => repositories.map((repository) =>
      repository.id === 'browser-preview' ? { ...repository, historyTruncated: true } : repository));
    void state.git.loadMoreHistory();
    void state.git.stagePath('apps/desktop/src/app/app.component.html');
  });
  await expect.poll(() => page.evaluate(() => !!(window as any).__checkpointTest.resolvePage)).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).__checkpointTest.calls
    .some((call: { command: string }) => call.command === 'stage_path'))).toBe(true);
  await page.evaluate(() => {
    const state = (window as any).__checkpointTest;
    const older = { ...state.base.commits.at(-1), oid: 'b'.repeat(40), subject: 'Loaded older commit', parents: [] };
    state.resolvePage({ commits: [older], historyTruncated: false });
  });
  await expect.poll(() => page.evaluate(() => (window as any).__checkpointTest.git.repository().commits
    .some((commit: { subject: string }) => commit.subject === 'Loaded older commit'))).toBe(true);
});

test('allows history paging during a status-only refresh', async ({ page }) => {
  await page.evaluate(() => {
    const state = (window as any).__checkpointTest;
    state.delayHistory = true;
    state.delayStatus = true;
    state.git.repositories.update((repositories: any[]) => repositories.map((repository) =>
      repository.id === 'browser-preview' ? { ...repository, historyTruncated: true } : repository));
    void state.git.refreshStatusInBackground('browser-preview', true);
    void state.git.loadMoreHistory();
  });
  await expect.poll(() => page.evaluate(() => !!(window as any).__checkpointTest.resolveStatus)).toBe(true);
  await expect.poll(() => page.evaluate(() => !!(window as any).__checkpointTest.resolvePage)).toBe(true);
  await page.evaluate(() => {
    const state = (window as any).__checkpointTest;
    state.resolveStatus(state.base.status);
    state.resolvePage({ commits: [], historyTruncated: false });
  });
  await expect.poll(() => page.evaluate(() => (window as any).__checkpointTest.git.repository().historyTruncated)).toBe(false);
});

test('waits for history paging before refreshing a changed branch', async ({ page }) => {
  await page.evaluate(() => {
    const state = (window as any).__checkpointTest;
    state.delayHistory = true;
    state.statusOverride = { ...state.base.status, branch: 'another-branch' };
    state.git.repositories.update((repositories: any[]) => repositories.map((repository) =>
      repository.id === 'browser-preview' ? { ...repository, historyTruncated: true } : repository));
    void state.git.loadMoreHistory();
    void state.git.refreshStatusInBackground('browser-preview', true);
  });
  await expect.poll(() => page.evaluate(() => !!(window as any).__checkpointTest.resolvePage)).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).__checkpointTest.calls
    .some((call: { command: string }) => call.command === 'refresh_repository_status'))).toBe(true);
  expect(await page.evaluate(() => (window as any).__checkpointTest.calls
    .filter((call: { command: string }) => call.command === 'refresh_repository'))).toHaveLength(0);
  await page.evaluate(() => {
    const state = (window as any).__checkpointTest;
    state.resolvePage({ commits: [], historyTruncated: false });
  });
  await expect.poll(() => page.evaluate(() => (window as any).__checkpointTest.calls
    .some((call: { command: string }) => call.command === 'refresh_repository'))).toBe(true);
});

test('resumes a requested history page after a background snapshot finishes', async ({ page }) => {
  await page.evaluate(() => {
    const state = (window as any).__checkpointTest;
    state.delayHistory = true;
    state.delayRefresh = true;
    state.base.historyTruncated = true;
    state.git.repositories.update((repositories: any[]) => repositories.map((repository) =>
      repository.id === 'browser-preview' ? { ...repository, historyTruncated: true } : repository));
    void state.git.refreshRepositoryInBackground('browser-preview');
    void state.git.loadMoreHistory();
  });
  await expect.poll(() => page.evaluate(() => !!(window as any).__checkpointTest.resolveRefresh)).toBe(true);
  expect(await page.evaluate(() => (window as any).__checkpointTest.calls
    .filter((call: { command: string }) => call.command === 'load_more_commits'))).toHaveLength(0);
  await page.evaluate(() => {
    const state = (window as any).__checkpointTest;
    state.resolveRefresh(state.snapshot());
  });
  await expect.poll(() => page.evaluate(() => !!(window as any).__checkpointTest.resolvePage)).toBe(true);
  await page.evaluate(() => {
    const state = (window as any).__checkpointTest;
    state.resolvePage({ commits: [], historyTruncated: false });
  });
  await expect.poll(() => page.evaluate(() => (window as any).__checkpointTest.git.repository().historyTruncated)).toBe(false);
});
