import { expect, test, type Page } from '@playwright/test';

const head = 'f19b263a8af31408d5f665caf7a5508e108c0fd1';
const older = '160acd10ef9e0c202cd3985aa41ee45d971bbb11';
const olderBody = 'Stage, unstage, and discard individual diff hunks.';

async function installBackend(page: Page): Promise<void> {
  await page.evaluate(({ older, olderBody }) => {
    const host = window as any;
    const git = host.ng.getComponent(document.querySelector('gc-root')).git;
    const coAuthors = 'Co-authored-by: Sam Rivera <sam@example.test>\nCo-authored-by: Alex Kim <alex@example.test>';
    git.repositories.update((repositories: any[]) => repositories.map(repository => ({
      ...repository,
      commits: repository.commits.map((commit: any) => commit.oid === older
        ? { ...commit, description: `${olderBody}\n\n${coAuthors}` } : commit),
    })));
    const snapshot = structuredClone(git.repository());
    host.__editCalls = [];
    host.__TAURI_INTERNALS__ = {
      invoke: async (command: string, args: any) => {
        if (command === 'refresh_repository_status') return snapshot.status;
        if (command === 'refresh_repository') return snapshot;
        if (command === 'inspect_commit') {
          const commit = snapshot.commits.find((candidate: any) => candidate.oid === args.oid);
          return { oid: args.oid, message: `${commit.subject}\n\n${commit.description}\n`, files: [], filesTruncated: false,
            signature: { status: 'none', signer: null, key: null, fingerprint: null, trust: null } };
        }
        host.__editCalls.push({ command, args });
        if (command === 'edit_commit' || command === 'update_head_message') return { ...snapshot, headOid: 'a'.repeat(40) };
        if (command === 'move_head') return snapshot;
        throw new Error(`Unexpected command ${command}`);
      },
    };
  }, { older, olderBody });
}

const calls = (page: Page) => page.evaluate(() => (window as any).__editCalls
  .filter((call: any) => call.command === 'edit_commit' || call.command === 'update_head_message'));

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.commit-row[data-commit-oid]').first()).toBeVisible();
  await installBackend(page);
});

test('removes a co-author from an older pushed commit after review', async ({ page }) => {
  await page.locator(`.commit-row[data-commit-oid="${older}"]`).click();
  await expect(page.locator('.coauthor-card')).toHaveCount(2);
  await page.getByRole('button', { name: 'Remove co-author Sam Rivera from this commit' }).click();

  const editor = page.getByRole('form', { name: 'Edit commit' });
  await expect(editor.getByLabel('Author name')).toHaveValue('Maya Chen');
  await expect(editor.getByLabel('Author email')).toHaveValue('maya@example.test');
  await expect(editor.getByRole('button', { name: /^Remove co-author/ })).toHaveCount(1);
  await expect(editor.getByRole('button', { name: 'Remove co-author Alex Kim' })).toBeVisible();
  await expect(editor.locator('.rewrite-warning')).toContainText('Already pushed.');
  await expect(editor.locator('.edit-commit-impact')).toContainText('recreates 2 later commits');
  expect(await calls(page)).toEqual([]);

  await editor.getByRole('button', { name: 'Save Commit' }).click();
  await expect(editor).toHaveCount(0);
  await expect.poll(() => calls(page)).toEqual([{ command: 'edit_commit', args: expect.objectContaining({
    expectedHead: head,
    targetOid: older,
    message: `Add hunk-level staging actions\n\n${olderBody}\n\nCo-authored-by: Alex Kim <alex@example.test>`,
    author: { name: 'Maya Chen', email: 'maya@example.test' },
    skipHooks: false,
  }) }]);
});

test('keeps message-only HEAD edits on the amend path and validates the author', async ({ page }) => {
  await page.locator(`.commit-row[data-commit-oid="${head}"]`).click();
  await page.getByRole('button', { name: /Edit commit/ }).click();
  const editor = page.getByRole('form', { name: 'Edit commit' });
  await expect(editor.locator('.edit-commit-impact')).toContainText("Saving changes this commit's ID.");
  await expect(editor.locator('.rewrite-warning')).toHaveCount(0);
  await editor.getByLabel('Summary').fill('Polish the activity drawer');
  await editor.getByRole('button', { name: 'Save Commit' }).click();
  await expect.poll(() => calls(page)).toEqual([{ command: 'update_head_message', args: expect.objectContaining({
    expectedOid: head, message: 'Polish the activity drawer\n\nMake operation history easier to scan and diagnose.',
  }) }]);
});

test('changes the HEAD author through the commit editor', async ({ page }) => {
  await page.locator(`.commit-row[data-commit-oid="${head}"]`).click();
  await page.getByRole('button', { name: /Edit commit/ }).click();
  const editor = page.getByRole('form', { name: 'Edit commit' });
  const save = editor.getByRole('button', { name: 'Save Commit' });
  await editor.getByLabel('Author email').fill('maya <at> example.test');
  await expect(editor.getByRole('alert')).toBeVisible();
  await expect(save).toBeDisabled();
  await editor.getByLabel('Author name').fill('Grace Hopper');
  await editor.getByLabel('Author email').fill('grace@example.test');
  await expect(save).toBeEnabled();
  await save.click();
  await expect.poll(() => calls(page)).toEqual([{ command: 'edit_commit', args: expect.objectContaining({
    expectedHead: head, targetOid: head, author: { name: 'Grace Hopper', email: 'grace@example.test' },
  }) }]);
});

test('offers commit editing from the context menu of an older commit', async ({ page }) => {
  await page.locator(`.commit-row[data-commit-oid="${older}"]`).click({ button: 'right' });
  await page.locator('.context-menu').getByRole('menuitem', { name: 'Edit author, message or co-authors…' }).click();
  await expect(page.getByRole('form', { name: 'Edit commit' }).getByLabel('Summary')).toHaveValue('Add hunk-level staging actions');
});
