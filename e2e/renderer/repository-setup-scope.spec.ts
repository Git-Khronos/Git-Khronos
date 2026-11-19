import { expect, test, type Page } from '@playwright/test';

type Editor = 'worktree' | 'existing-worktree' | 'submodule' | 'remote-add' | 'remote-edit' | 'remote-remove';
const mutations = ['create_worktree', 'create_worktree_for_branch', 'add_submodule', 'add_remote', 'set_remote_url', 'configure_remote', 'remove_remote'];

async function openEditor(page: Page, editor: Editor): Promise<void> {
  await page.evaluate(editor => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const repository = app.git.repository();
    if (editor === 'worktree' || editor === 'existing-worktree') {
      if (editor === 'existing-worktree') {
        app.git.repositories.update((items: any[]) => items.map(item => item.id === repository.id
          ? { ...item, worktrees: item.worktrees.filter((worktree: any) => worktree.current) } : item));
        const branch = repository.branches.find((candidate: any) => !candidate.remote && !candidate.current);
        app.actionOverlays.open({ kind: 'context', value: {
          kind: 'branch', repositoryId: repository.id, oid: branch.oid, oids: [branch.oid], label: branch.name, x: 500, y: 200,
        } });
        app.openContextWorktreeDialog();
      } else {
        app.openWorktreeDialog();
        app.worktreeBranch.set('reviewed-branch');
      }
      app.worktreeParent.set('/workspace');
      app.worktreeFolder.set('reviewed-tree');
    } else if (editor === 'submodule') {
      app.openSubmoduleDialog();
      app.submoduleUrl.set('/owned/submodule.git');
      app.submodulePath.set('vendor/reviewed');
    } else {
      if (editor === 'remote-add') app.openAddRemoteDialog();
      else app.openEditRemoteDialog(repository.remotes[0]);
      if (editor === 'remote-add') app.remoteName.set('reviewed');
      app.remoteUrl.set('/owned/remote.git');
      if (editor === 'remote-remove') app.requestRemoteRemoval();
    }
  }, editor);
}

function dialog(page: Page, editor: Editor) {
  return editor === 'remote-remove' ? page.getByRole('alertdialog', { name: 'origin', exact: true })
    : page.getByRole('dialog', { name: editor.includes('worktree') ? 'Create Worktree'
      : editor === 'submodule' ? 'Add Submodule' : editor === 'remote-add' ? 'Add Remote' : 'Edit Remote', exact: true });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'setup editor scope test' }));
    (window as any).__setupCalls = [];
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      (window as any).__setupCalls.push({ command, args });
      const repository = git.repositories().find((candidate: any) => candidate.id === args?.repoId) ?? git.repository();
      if (command === 'open_repository') {
        const branch = (window as any).__lastSetupBranch ?? repository.status.branch;
        return Promise.resolve({ ...repository, id: 'opened-setup-checkout', path: args.path,
          status: { ...repository.status, branch },
          worktrees: [{ ...repository.worktrees[0], path: args.path, branch, current: true }],
        });
      }
      if (['create_worktree', 'create_worktree_for_branch', 'add_submodule', 'add_remote', 'set_remote_url', 'configure_remote', 'remove_remote', 'refresh_repository'].includes(command)) {
        const snapshot = () => {
          if (command.startsWith('create_worktree')) {
            (window as any).__lastSetupBranch = args.branch;
            return { ...repository, worktrees: [...repository.worktrees, {
              ...repository.worktrees[0], path: `${args.parentPath}/${args.folder}`, branch: args.branch, current: false,
            }] };
          }
          if (command === 'remove_remote') return { ...repository, remotes: repository.remotes.filter((remote: any) => remote.name !== args.name) };
          if (['add_remote', 'set_remote_url', 'configure_remote'].includes(command)) {
            const previous = repository.remotes.find((remote: any) => remote.name === (args.previousName ?? args.name));
            const updated = { name: args.name, fetchUrl: args.fetchUrl ?? args.url,
              pushUrl: args.changePush ? args.pushUrl || args.fetchUrl : previous?.pushUrl ?? args.fetchUrl ?? args.url };
            return { ...repository,
              remotes: [...repository.remotes.filter((remote: any) => remote.name !== (args.previousName ?? args.name)), updated],
              branches: args.previousName ? repository.branches.map((branch: any) => branch.remote && branch.name.startsWith(args.previousName + '/')
                ? { ...branch, name: args.name + branch.name.slice(args.previousName.length) } : branch) : repository.branches,
            };
          }
          return repository;
        };
        if ((window as any).__holdSetup === command) return new Promise(resolve => {
          (window as any).__resolveSetup = () => resolve(snapshot());
        });
        return Promise.resolve(snapshot());
      }
      if (command === 'refresh_repository_status') return Promise.resolve(repository.status);
      return Promise.reject(new Error(`Unexpected setup command ${command}`));
    } };
  });
});

for (const editor of ['worktree', 'existing-worktree', 'submodule', 'remote-add', 'remote-edit', 'remote-remove'] as const) {
  for (const change of ['repository', 'same-id-path'] as const) {
    test(`${editor} refuses stale ${change} dispatch before scope effects run`, async ({ page }) => {
      await openEditor(page, editor);
      await expect(dialog(page, editor)).toBeVisible();
      await page.evaluate(async ({ editor, change }) => {
        const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
        const git = app.git, repository = git.repository();
        const other = { ...repository, id: change === 'repository' ? 'other-setup-repository' : repository.id, path: '/workspace/other-setup' };
        git.repositories.update((items: any[]) => change === 'repository' ? [...items, other]
          : items.map(item => item.id === repository.id ? other : item));
        git.activeRepositoryId.set(other.id);
        // Dispatch in the same task: effect-only retirement cannot enforce ownership.
        if (editor.includes('worktree')) await app.submitWorktree();
        else if (editor === 'submodule') await app.submitSubmodule();
        else if (editor === 'remote-remove') await app.confirmRemoteRemoval();
        else await app.submitRemote();
      }, { editor, change });
      const calls = await page.evaluate(() => (window as any).__setupCalls);
      expect(calls.filter((entry: any) => mutations.includes(entry.command))).toEqual([]);
      await expect(dialog(page, editor)).toHaveCount(0);
    });
  }
}

const methodFor = (editor: Editor) => editor.includes('worktree') ? 'submitWorktree'
  : editor === 'submodule' ? 'submitSubmodule' : editor === 'remote-remove' ? 'confirmRemoteRemoval' : 'submitRemote';
const commandFor = (editor: Editor) => editor === 'worktree' ? 'create_worktree' : editor === 'existing-worktree' ? 'create_worktree_for_branch'
  : editor === 'submodule' ? 'add_submodule' : editor === 'remote-add' ? 'add_remote' : editor === 'remote-edit' ? 'set_remote_url' : 'remove_remote';

for (const editor of ['worktree', 'existing-worktree', 'submodule', 'remote-add', 'remote-edit', 'remote-remove'] as const) {
  test(`${editor} keeps its ordinary native payload and source ownership`, async ({ page }) => {
    await openEditor(page, editor);
    await expect(dialog(page, editor)).toBeVisible();
    const sourceId = await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.repository().id);
    await expect(dialog(page, editor).locator('.repository-editor-source')).toContainText('/home/maya/projects/git-khronos');
    const submit = editor.includes('worktree') ? 'Create worktree' : editor === 'submodule' ? 'Add Submodule'
      : editor === 'remote-add' ? 'Add Remote' : editor === 'remote-edit' ? 'Save Remote' : 'Remove Remote';
    await dialog(page, editor).getByRole('button', { name: submit, exact: true }).click();
    await expect(dialog(page, editor)).toHaveCount(0);
    const calls = await page.evaluate(() => (window as any).__setupCalls);
    expect(calls.filter((entry: any) => mutations.includes(entry.command))).toHaveLength(1);
    const call = calls.find((entry: any) => entry.command === commandFor(editor));
    expect(call.args.repoId).toBe(sourceId);
    if (editor.includes('worktree')) expect(call.args).toMatchObject({ parentPath: '/workspace', folder: 'reviewed-tree' });
    else if (editor === 'submodule') expect(call.args).toMatchObject({ url: '/owned/submodule.git', path: 'vendor/reviewed' });
    else if (editor === 'remote-remove') expect(call.args).toMatchObject({ name: 'origin' });
    else expect(call.args).toMatchObject({ name: editor === 'remote-add' ? 'reviewed' : 'origin', url: '/owned/remote.git' });
  });

  test(`${editor} cannot dispatch from a closed review even in the original checkout`, async ({ page }) => {
    await openEditor(page, editor);
    await expect(dialog(page, editor)).toBeVisible();
    await dialog(page, editor).getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.evaluate(method => (window as any).ng.getComponent(document.querySelector('gc-root'))[method](), methodFor(editor));
    const calls = await page.evaluate(() => (window as any).__setupCalls);
    expect(calls.filter((entry: any) => mutations.includes(entry.command))).toEqual([]);
  });
}

for (const editor of ['worktree', 'submodule', 'remote-add', 'remote-edit'] as const) {
  for (const completion of ['replacement', 'repository-change'] as const) {
    test(`${editor} late completion preserves ${completion} intent and the original write receipt`, async ({ page }) => {
      await openEditor(page, editor);
      const sourceId = await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.repository().id);
      await page.evaluate(({ method, command }) => {
        (window as any).__holdSetup = command;
        const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
        (window as any).__pendingSetup = app[method]();
      }, { method: methodFor(editor), command: commandFor(editor) });
      await expect.poll(() => page.evaluate(() => typeof (window as any).__resolveSetup)).toBe('function');
      const form = dialog(page, editor);
      await expect(form.locator('input, select').first()).toBeDisabled();
      expect(await form.locator('input, select').evaluateAll(controls => controls.every(control => (control as HTMLInputElement).disabled))).toBe(true);
      await expect(form.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
      await page.evaluate(method => (window as any).ng.getComponent(document.querySelector('gc-root'))[method](), methodFor(editor));
      await form.getByRole('button', { name: 'Cancel', exact: true }).click();
      if (completion === 'repository-change') {
        await page.evaluate(() => {
          const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
          const other = { ...git.repository(), id: 'next-setup-repository', path: '/workspace/next-setup' };
          git.repositories.update((items: any[]) => [...items, other]);
          git.activeRepositoryId.set(other.id);
        });
      }
      await openEditor(page, editor);
      await page.evaluate(editor => {
        const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
        if (editor === 'worktree') app.worktreeFolder.set('replacement-folder');
        else if (editor === 'submodule') app.submodulePath.set('vendor/replacement');
        else app.remoteUrl.set('/owned/replacement.git');
      }, editor);
      await expect(dialog(page, editor).getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
      await page.evaluate(async () => { (window as any).__resolveSetup(); await (window as any).__pendingSetup; });
      await expect(dialog(page, editor)).toBeVisible();
      const field = editor === 'worktree' ? 'Folder name' : editor === 'submodule' ? 'Name / Path' : 'Fetch URL';
      await expect(dialog(page, editor).getByLabel(field, { exact: true })).toHaveValue(editor === 'worktree'
        ? 'replacement-folder' : editor === 'submodule' ? 'vendor/replacement' : '/owned/replacement.git');
      const state = await page.evaluate(() => {
        const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
        return { calls: (window as any).__setupCalls, active: app.git.activeRepositoryId(), logs: app.git.activityLogs() };
      });
      expect(state.active).toBe(completion === 'repository-change' ? 'next-setup-repository' : sourceId);
      expect(state.calls.filter((entry: any) => mutations.includes(entry.command))).toHaveLength(1);
      expect(state.calls.filter((entry: any) => entry.command === 'open_repository')).toEqual([]);
      expect(state.logs.some((entry: any) => entry.repositoryId === sourceId && entry.status === 'success')).toBe(true);
    });
  }
}

for (const change of ['replacement', 'same-id-path'] as const) {
  test(`worktree directory replies cannot overwrite a ${change} review`, async ({ page }) => {
    await openEditor(page, 'worktree');
    await page.evaluate(() => {
      const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
      app.git.chooseDirectory = () => new Promise(resolve => { (window as any).__resolveDirectory = resolve; });
      (window as any).__pendingDirectory = app.chooseWorktreeParent();
    });
    await dialog(page, 'worktree').getByRole('button', { name: 'Cancel', exact: true }).click();
    if (change === 'same-id-path') await page.evaluate(() => {
      const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
      git.repositories.update((items: any[]) => items.map(item => item.id === git.activeRepositoryId() ? { ...item, path: '/workspace/moved-source' } : item));
    });
    await openEditor(page, 'worktree');
    await page.evaluate(async () => { (window as any).__resolveDirectory('/obsolete/parent'); await (window as any).__pendingDirectory; });
    await expect(dialog(page, 'worktree').getByLabel('Worktree location')).toHaveValue('/workspace');
  });
}

test('a confirmed remote rename migrates source preferences without changing a replacement remote draft', async ({ page }) => {
  await openEditor(page, 'remote-edit');
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    app.remoteName.set('owned-origin');
    app.remoteDialogIcon.set('globe');
    app.remoteLocationIcons.set({ origin: 'globe' });
    (window as any).__holdSetup = 'configure_remote';
    (window as any).__pendingSetup = app.submitRemote();
  });
  await expect.poll(() => page.evaluate(() => typeof (window as any).__resolveSetup)).toBe('function');
  await dialog(page, 'remote-edit').getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    app.openEditRemoteDialog(app.git.repository().remotes.find((remote: any) => remote.name === 'upstream'));
    app.remoteName.set('replacement-upstream');
  });
  await page.evaluate(async () => { (window as any).__resolveSetup(); await (window as any).__pendingSetup; });
  await expect(dialog(page, 'remote-edit').getByLabel('Name', { exact: true })).toHaveValue('replacement-upstream');
  expect(await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    return { original: app.remoteDialogOriginalName(), icons: app.remoteLocationIcons() };
  })).toMatchObject({ original: 'upstream', icons: { 'owned-origin': 'globe' } });
});

test('worktree directory replies update the still-owned review normally', async ({ page }) => {
  await openEditor(page, 'worktree');
  const title = await page.evaluate(async () => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    let requestedTitle = '';
    app.git.chooseDirectory = (title: string) => { requestedTitle = title; return Promise.resolve('/owned/new-parent'); };
    await app.chooseWorktreeParent();
    return requestedTitle;
  });
  expect(title).toBe('Choose a parent folder for the worktree');
  await expect(dialog(page, 'worktree').getByLabel('Worktree location')).toHaveValue('/owned/new-parent');
});

test('a retired branch context cannot open an existing-branch worktree review in another checkout', async ({ page }) => {
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const repository = app.git.repository();
    app.git.repositories.update((items: any[]) => items.map(item => item.id === repository.id
      ? { ...item, worktrees: item.worktrees.filter((worktree: any) => worktree.current) } : item));
    const branch = repository.branches.find((candidate: any) => !candidate.remote && !candidate.current);
    app.actionOverlays.open({ kind: 'context', value: {
      kind: 'branch', repositoryId: 'retired-context-repository', oid: branch.oid,
      oids: [branch.oid], label: branch.name, x: 500, y: 200,
    } });
    app.openContextWorktreeDialog();
  });
  await expect(dialog(page, 'existing-worktree')).toHaveCount(0);
});

for (const editor of ['worktree', 'existing-worktree', 'submodule', 'remote-add', 'remote-edit', 'remote-remove'] as const) {
  test(`${editor} requires the rendered ownership lease before dispatching a replacement review`, async ({ page }) => {
    await openEditor(page, editor);
    const source = dialog(page, editor);
    await expect(source).toBeVisible();
    const connected = await source.evaluate((element, editor) => {
      const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
      const git = app.git, repository = git.repository();
      const other = { ...repository, id: 'replacement-setup-source', path: '/workspace/replacement-source' };
      git.repositories.update((items: any[]) => [...items, other]);
      git.activeRepositoryId.set(other.id);
      // Replace the request in one task, before the old rendered controls update.
      if (editor === 'worktree') app.openWorktreeDialog();
      else if (editor === 'existing-worktree') {
        const branch = other.branches.find((branch: any) => !branch.remote && !branch.current);
        app.actionOverlays.open({ kind: 'context', value: {
          kind: 'branch', repositoryId: other.id, oid: branch.oid, oids: [branch.oid], label: branch.name, x: 500, y: 200,
        } });
        app.openContextWorktreeDialog();
      } else if (editor === 'submodule') {
        app.openSubmoduleDialog(); app.submoduleUrl.set('/owned/new-module.git'); app.submodulePath.set('vendor/new-module');
      } else {
        if (editor === 'remote-add') {
          app.openAddRemoteDialog(); app.remoteName.set('replacement-remote'); app.remoteUrl.set('/owned/new-remote.git');
        } else app.openEditRemoteDialog(other.remotes[0]);
        if (editor === 'remote-remove') app.requestRemoteRemoval();
      }
      if (editor === 'remote-remove') element.querySelector<HTMLButtonElement>('footer .danger')!.click();
      else element.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      return element.isConnected;
    }, editor);
    expect(connected).toBe(true);
    const calls = await page.evaluate(() => (window as any).__setupCalls);
    expect(calls.filter((entry: any) => mutations.includes(entry.command))).toEqual([]);
  });
}

for (const editor of ['worktree', 'submodule', 'remote-edit'] as const) {
  test(`${editor} ignores obsolete input from the previous rendered ownership lease`, async ({ page }) => {
    await openEditor(page, editor);
    await dialog(page, editor).evaluate((element, editor) => {
      const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
      const name = editor === 'worktree' ? 'worktreeFolder' : editor === 'submodule' ? 'submodulePath' : 'remoteUrl';
      const input = element.querySelector<HTMLInputElement>(`[name=${name}]`)!;
      if (editor === 'worktree') { app.openWorktreeDialog(); app.worktreeFolder.set('replacement-draft'); }
      else if (editor === 'submodule') { app.openSubmoduleDialog(); app.submodulePath.set('replacement-draft'); }
      else { app.openEditRemoteDialog(app.git.repository().remotes[0]); app.remoteUrl.set('replacement-draft'); }
      input.value = 'obsolete-input';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      [...element.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === 'Cancel')!.click();
    }, editor);
    const label = editor === 'worktree' ? 'Folder name' : editor === 'submodule' ? 'Name / Path' : 'Fetch URL';
    await expect(dialog(page, editor).getByLabel(label, { exact: true })).toHaveValue('replacement-draft');
  });
}

test('retiring remote removal does not erase a replacement editor focus owner', async ({ page }) => {
  await openEditor(page, 'remote-remove');
  await expect(dialog(page, 'remote-remove')).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git, repository = git.repository();
    const other = { ...repository, id: 'next-remote-editor', path: '/workspace/next-remote-editor' };
    git.repositories.update((items: any[]) => [...items, other]); git.activeRepositoryId.set(other.id);
    const opener = document.querySelector<HTMLButtonElement>('[aria-label="Edit remote upstream"]')!;
    app.openEditRemoteDialog(other.remotes.find((remote: any) => remote.name === 'upstream'), opener);
  });
  await expect(dialog(page, 'remote-remove')).toHaveCount(0);
  await dialog(page, 'remote-edit').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit remote upstream', exact: true })).toBeFocused();
});
