import { expect, test, type Page } from '@playwright/test';

type Editor = 'worktree' | 'submodule' | 'remote-add' | 'remote-edit' | 'remote-remove';
const editors: Editor[] = ['worktree', 'submodule', 'remote-add', 'remote-edit', 'remote-remove'];

async function open(page: Page, editor: Editor, focusGap = false) {
  await page.evaluate(({ editor, focusGap }) => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    (window as any).__keyboardIntents = [];
    const record = (name: string) => () => (window as any).__keyboardIntents.push(name);
    for (const name of ['commit', 'stageAllAndCommit', 'openCommandPalette', 'activateRelativeRepository',
      'closeRepository', 'selectRelativeCommit', 'toggleTerminal']) app[name] = record(name);
    for (const name of ['stageAll', 'unstageAll', 'stagePath', 'unstagePath', 'undo', 'redo', 'remote']) app.git[name] = record(name);
    app.git.undoLabel = () => 'Owned undo';
    app.git.redoLabel = () => 'Owned redo';
    app.changesOpen.set(true);
    for (const name of ['submitWorktree', 'submitSubmodule', 'submitRemote']) app[name] = record(name);
    if (editor === 'worktree') {
      app.openWorktreeDialog();
      app.worktreeBranch.set('keyboard-review');
      app.worktreeParent.set('/workspace');
      app.worktreeFolder.set('keyboard-review');
    } else if (editor === 'submodule') {
      app.openSubmoduleDialog();
      app.submoduleUrl.set('/owned/submodule.git');
      app.submodulePath.set('vendor/keyboard-review');
    }
    else if (editor === 'remote-add') app.openAddRemoteDialog();
    else {
      app.openEditRemoteDialog(app.git.repository().remotes[0]);
      if (editor === 'remote-remove') app.requestRemoteRemoval();
    }
    if (editor.startsWith('remote-') && editor !== 'remote-remove') app.remoteUrl.set('/owned/remote.git');
    if (focusGap) {
      // The document handler must honor ownership before a modal can render or focus.
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true, cancelable: true }));
    }
  }, { editor, focusGap });
  const modal = editor === 'remote-remove' ? page.getByRole('alertdialog', { name: 'origin', exact: true })
    : page.getByRole('dialog', { name: editor === 'worktree' ? 'Create Worktree'
      : editor === 'submodule' ? 'Add Submodule' : editor === 'remote-add' ? 'Add Remote' : 'Edit Remote', exact: true });
  await expect(modal).toBeVisible();
  return modal;
}

async function intents(page: Page) {
  return page.evaluate(() => (window as any).__keyboardIntents as string[]);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible();
});

for (const editor of editors) {
  test(`${editor} blocks ambient commands while a control is focused`, async ({ page }) => {
    const modal = await open(page, editor);
    await modal.getByRole('button', { name: 'Cancel', exact: true }).focus();
    for (const key of ['Control+Enter', 'Control+Shift+Enter', 'Control+p', 'Control+Shift+s',
      'Control+Shift+u', 'Control+l', 'Control+w', 'Control+Tab', 'Alt+t', 'Control+z', 'Control+y']) {
      await page.keyboard.press(key);
    }
    expect(await intents(page)).toEqual([]);
    await expect(modal).toBeVisible();
  });

  test(`${editor} blocks graph and staging keys from its buttons`, async ({ page }) => {
    const modal = await open(page, editor);
    await modal.getByRole('button', { name: 'Cancel', exact: true }).focus();
    await page.evaluate(() => {
      const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
      app.git.selectedWorkingTreeFile.set('unstaged:owned.txt');
    });
    await page.keyboard.press('s');
    await page.keyboard.press('j');
    await page.evaluate(() => {
      const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
      app.git.selectedWorkingTreeFile.set('staged:owned.txt');
    });
    await page.keyboard.press('u');
    expect(await intents(page)).toEqual([]);
  });

  test(`${editor} blocks commands during its render-to-focus gap`, async ({ page }) => {
    await open(page, editor, true);
    expect(await intents(page)).toEqual([]);
  });

  test(`${editor} Escape dismisses and restores ambient shortcuts`, async ({ page }) => {
    const modal = await open(page, editor);
    await modal.getByRole('button', { name: 'Cancel', exact: true }).focus();
    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
    await page.keyboard.press('Control+p');
    expect(await intents(page)).toEqual(['openCommandPalette']);
  });

  test(`${editor} keeps Tab trapped inside its own visible controls`, async ({ page }) => {
    const modal = await open(page, editor);
    const controls = modal.locator('button:visible:not(:disabled), input:visible:not(:disabled), select:visible:not(:disabled)');
    await controls.last().focus();
    await page.keyboard.press('Tab');
    await expect(controls.first()).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(controls.last()).toBeFocused();
    expect(await intents(page)).toEqual([]);
  });

  if (editor !== 'remote-remove') {
    test(`${editor} preserves typing and its own Enter submit`, async ({ page }) => {
      const modal = await open(page, editor);
      const field = modal.locator('input:not([readonly])').first();
      await field.fill('owned-keyboard-draft');
      await expect(field).toHaveValue('owned-keyboard-draft');
      for (const key of ['Control+Enter', 'Control+Shift+Enter', 'Meta+Enter', 'Control+z', 'Control+y', 'Control+p']) {
        await field.press(key);
      }
      expect(await intents(page)).toEqual([]);
      await field.press('Control+a');
      await page.keyboard.type('owned-keyboard-edited');
      await expect(field).toHaveValue('owned-keyboard-edited');
      await expect(modal.locator('button[type=submit]')).toBeEnabled();
      await field.press('Enter');
      expect(await intents(page)).toEqual([editor === 'worktree' ? 'submitWorktree'
        : editor === 'submodule' ? 'submitSubmodule' : 'submitRemote']);
    });

    test(`${editor} retired rendered controls do not swallow the next shortcut`, async ({ page }) => {
      const modal = await open(page, editor);
      await modal.locator('input:not([readonly])').first().focus();
      await page.evaluate(editor => {
        const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
        const outgoing = document.activeElement!;
        if (editor === 'worktree') app.closeWorktreeDialog(false);
        else if (editor === 'submodule') app.closeSubmoduleDialog(false);
        else app.closeRemoteDialog(false);
        outgoing.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true, cancelable: true }));
      }, editor);
      expect(await intents(page)).toEqual(['openCommandPalette']);
    });
  }
}
