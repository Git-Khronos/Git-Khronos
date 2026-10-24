import { expect, test } from '@playwright/test';

test('stash details and later file previews keep the selected immutable object after stack renumbering', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  const result = await page.evaluate(async () => {
    const root = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = root.git;
    const oid = 'a'.repeat(40);
    const stash = { reference: 'stash@{0}', oid, message: 'Owned selected stash' };
    const repository = { ...git.repository(), stashes: [stash] };
    const file = { path: 'selected.txt', previousPath: null, status: 'M', additions: 1, deletions: 1 };
    const calls: any[] = [];
    git.repositories.set([repository]);
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      calls.push({ command, args });
      if (command === 'inspect_stash') return Promise.resolve({ oid, message: stash.message, files: [file], filesTruncated: false, signature: { status: 'unsigned' } });
      if (command === 'inspect_stash_file') return Promise.resolve({ oid, path: file.path, patch: '+owned selected contents', truncated: false });
      return Promise.resolve(command === 'refresh_repository_status' ? repository.status : repository);
    } };
    await git.inspectStash(stash);
    git.repositories.set([{ ...repository, stashes: [{ ...stash, oid: 'b'.repeat(40) }, { ...stash, reference: 'stash@{1}' }] }]);
    await git.inspectCommitFile(file);
    return { calls, details: git.commitDetails(), diff: git.commitFileDiff() };
  });
  expect(result.calls.filter(call => call.command === 'inspect_stash')[0].args.oid).toBe('a'.repeat(40));
  expect(result.calls.filter(call => call.command === 'inspect_stash_file')[0].args.oid).toBe('a'.repeat(40));
  expect(result.details.oid).toBe(result.diff.oid);
  expect(result.diff.patch).toContain('owned selected contents');
});

test('a listed stash outside loaded history opens its details without loading unrelated commits', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.evaluate(() => {
    const root = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = root.git;
    const oid = 'a'.repeat(40);
    const stash = { reference: 'stash@{1}', oid, message: 'Owned older stash' };
    const repository = { ...git.repository(), stashes: [stash], historyTruncated: true };
    git.repositories.set([repository]);
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    const calls: any[] = [];
    (window as any).__stashPreviewCalls = calls;
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      calls.push({ command, args });
      if (command === 'inspect_history_commit') return Promise.resolve({ ...repository.commits[0], oid, subject: 'Owned older stash', description: 'Owned preview body' });
      if (command === 'inspect_stash') return Promise.resolve({ oid, message: 'Owned older stash\n\nOwned preview body', files: [], filesTruncated: false, signature: { status: 'unsigned' } });
      if (command === 'load_more_commits') return Promise.resolve({ commits: [], historyTruncated: false });
      return Promise.resolve(command === 'refresh_repository_status' ? repository.status : repository);
    } };
    const button = document.createElement('button');
    button.textContent = 'Owned older stash opener';
    button.onclick = () => root.selectStash(stash);
    document.body.append(button);
  });
  await page.getByRole('button', { name: 'Owned older stash opener', exact: true }).click();
  await expect(page.locator('.commit-body')).toContainText('Owned preview body');
  const calls = await page.evaluate(() => (window as any).__stashPreviewCalls);
  expect(calls.some((call: any) => call.command === 'load_more_commits')).toBe(false);
  expect(calls.some((call: any) => call.command === 'inspect_stash' && call.args.oid === 'a'.repeat(40))).toBe(true);
});
