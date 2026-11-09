import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible();
  await page.evaluate(() => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    const base = git.repository();
    const template = base.commits[0];
    const oids = ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)];
    const commits = oids.map((oid, index) => ({ ...template, oid, shortOid: oid.slice(0, 7),
      summary: `Linear ${index}`, parents: oids[index + 1] ? [oids[index + 1]] : [] }));
    git.repositories.update((items: any[]) => items.map(item => item.id === base.id ? { ...item, headOid: oids[0], commits } : item));
    const repository = git.repository();
    app.commitMessage.set('Keep the unrelated draft');
    const importRequest = { file: '/owned/series.mbox', bytes: 900, fingerprint: 'e'.repeat(40),
      headOid: repository.headOid, branch: 'refs/heads/main', count: 2 };
    const fixture = {
      repository, calls: [] as any[], selectedFile: '/owned/series.mbox' as string | null,
      destination: '/owned/out.mbox' as string | null, refused: false, stop: false, importRequest,
      setActive(active: boolean) {
        const repo = git.repositories().find((item: any) => item.id === repository.id);
        repo.status = { ...repo.status, mailPatchInProgress: active };
      },
    };
    (window as any).__mail = fixture;
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      fixture.calls.push({ command, args });
      if (command === 'plugin:dialog|open') return Promise.resolve(fixture.selectedFile);
      if (command === 'plugin:dialog|save') return Promise.resolve(fixture.destination);
      if (command === 'review_mail_patch_export') {
        return Promise.resolve({ request: { oids: args.oids, bytes: 1234, fingerprint: 'f'.repeat(40) },
          commits: args.oids.map((oid: string, index: number) => ({ oid, authorName: 'A', authorEmail: 'a@example.test',
            subject: `Subject ${index}`, root: false, empty: index === 0 })) });
      }
      if (command === 'export_mail_patch') return Promise.resolve(1234);
      if (command === 'review_mail_patch_import') {
        if (fixture.refused) return Promise.reject({ kind: 'mailPatchRefused', message: 'Commit or stash tracked changes before applying mail patches.' });
        return Promise.resolve({ request: importRequest, patches: [
          { authorName: 'Ada', authorEmail: 'ada@example.test', subject: 'First change', empty: false },
          { authorName: 'Lin', authorEmail: 'lin@example.test', subject: 'Empty note', empty: true },
        ] });
      }
      if (command === 'import_mail_patch') {
        if (fixture.stop) {
          fixture.setActive(true);
          return Promise.resolve({ stopped: true, current: 2, total: 2, message: 'Patch is empty.', recoveryRef: 'refs/git-khronos/recovery/mail' });
        }
        return Promise.resolve({ stopped: false, current: null, total: null, message: '', recoveryRef: 'refs/git-khronos/recovery/mail' });
      }
      if (command === 'control_mail_patch') {
        fixture.setActive(false);
        return Promise.resolve({ stopped: false, current: null, total: null, message: '', recoveryRef: null });
      }
      if (['refresh_repository', 'refresh_repository_metadata', 'refresh_repository_status'].includes(command)) {
        const repo = git.repositories().find((item: any) => item.id === args.repoId);
        if (!repo) return Promise.reject(new Error('Unknown mail fixture repository'));
        return Promise.resolve(command === 'refresh_repository_status' ? repo.status : repo);
      }
      return Promise.reject(new Error(`Unexpected ${command}`));
    } };
  });
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  await page.getByRole('dialog', { name: 'Preferences' }).getByRole('tab', { name: /^Git/ }).click();
  await expect(page.locator('gc-mail-patch-panel')).toBeVisible();
  await page.locator('gc-mail-patch-panel summary').click();
}

const calls = (page: Page, command: string) =>
  page.evaluate(name => (window as any).__mail.calls.filter((call: any) => call.command === name), command);

test('export reviews consecutive HEAD commits oldest first, then saves the exact reviewed series', async ({ page }) => {
  await setup(page);
  const panel = page.locator('gc-mail-patch-panel');
  const count = panel.getByLabel('Number of commits ending at HEAD');
  await count.fill('2');
  await count.press('Enter');
  await count.blur();
  const list = panel.getByRole('list', { name: 'Commits to export' }).locator('li');
  await expect(list).toHaveCount(2);
  await panel.getByRole('button', { name: 'Review series' }).click();
  const review = panel.getByRole('region', { name: 'Mail-patch export review' });
  await expect(review).toBeFocused();
  await expect(review).toContainText('Git am will stop on it');
  const [reviewCall] = await calls(page, 'review_mail_patch_export');
  const head = await page.evaluate(() => (window as any).__mail.repository.headOid);
  expect(reviewCall.args.oids).toHaveLength(2);
  expect(reviewCall.args.oids[1]).toBe(head);
  await review.getByRole('button', { name: 'Save series…' }).click();
  await expect(panel.getByRole('status')).toContainText('Saved 2 patches (1234 bytes) to /owned/out.mbox');
  const [exportCall] = await calls(page, 'export_mail_patch');
  expect(exportCall.args.request.oids).toEqual(reviewCall.args.oids);
  await page.getByRole('button', { name: 'Close preferences' }).click();
  await expect(page.getByLabel('Commit summary', { exact: true })).toHaveValue('Keep the unrelated draft');
});

test('out-of-range counts clamp to available history and cancelled save writes nothing', async ({ page }) => {
  await setup(page);
  const panel = page.locator('gc-mail-patch-panel');
  const count = panel.getByLabel('Number of commits ending at HEAD');
  await count.fill('9999');
  await count.blur();
  const available = await page.evaluate(() => {
    const repo = (window as any).__mail.repository;
    const byOid = new Map(repo.commits.map((commit: any) => [commit.oid, commit]));
    let commit: any = byOid.get(repo.headOid), length = 0;
    while (commit && commit.parents.length <= 1) { length++; commit = byOid.get(commit.parents[0]); }
    return length;
  });
  await expect(count).toHaveValue(String(available));
  await panel.getByRole('button', { name: 'Review series' }).click();
  await page.evaluate(() => { (window as any).__mail.destination = null; });
  await panel.getByRole('button', { name: 'Save series…' }).click();
  await expect(panel.getByRole('status')).toContainText('No file written');
  expect(await calls(page, 'export_mail_patch')).toHaveLength(0);
});

test('import review lists authors and empty patches before applying with recovery', async ({ page }) => {
  await setup(page);
  const panel = page.locator('gc-mail-patch-panel');
  await panel.getByRole('button', { name: 'Choose series to apply…' }).click();
  const review = panel.getByRole('region', { name: 'Mail-patch import review' });
  await expect(review).toBeFocused();
  await expect(review).toContainText('Apply 2 patches on main');
  await expect(review.getByRole('list', { name: 'Patches to apply' })).toContainText('Ada <ada@example.test>');
  await expect(review).toContainText('empty: Git am will stop');
  expect(await calls(page, 'import_mail_patch')).toHaveLength(0);
  await review.getByRole('button', { name: 'Apply patches' }).click();
  await expect(panel.getByRole('status')).toContainText('Applied 2 patches. Original tip saved at refs/git-khronos/recovery/mail');
  const [call] = await calls(page, 'import_mail_patch');
  expect(call.args.request).toEqual(await page.evaluate(() => (window as any).__mail.importRequest));
  expect((await calls(page, 'refresh_repository')).length).toBeGreaterThan(0);
});

test('a paused application exposes Continue, Skip and Abort and clears after control', async ({ page }) => {
  await setup(page);
  const panel = page.locator('gc-mail-patch-panel');
  await page.evaluate(() => { (window as any).__mail.stop = true; });
  await panel.getByRole('button', { name: 'Choose series to apply…' }).click();
  await panel.getByRole('button', { name: 'Apply patches' }).click();
  const stop = panel.getByRole('region', { name: 'Mail-patch application paused' });
  await expect(stop).toBeVisible();
  await expect(stop).toContainText('Patch 2 of 2');
  await expect(stop.getByLabel('Git am report')).toContainText('Patch is empty');
  await expect(stop).toBeFocused();
  await expect(panel.getByRole('button', { name: 'Choose series to apply…' })).toHaveCount(0);
  await stop.getByRole('button', { name: 'Skip this patch' }).click();
  await expect(stop).toHaveCount(0);
  const [control] = await calls(page, 'control_mail_patch');
  expect(control.args.action).toBe('skip');
  await expect(panel.getByRole('status')).toContainText('All remaining patches applied');
});

test('an existing paused application found after reload offers Abort without prior review', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const fixture = (window as any).__mail;
    fixture.setActive(true);
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    return app.git.refreshRepositoryInBackground(fixture.repository.id);
  });
  const panel = page.locator('gc-mail-patch-panel');
  const stop = panel.getByRole('region', { name: 'Mail-patch application paused' });
  await expect(stop).toBeVisible();
  await stop.getByRole('button', { name: 'Abort' }).click();
  await expect(panel.getByRole('status')).toContainText('back at its original tip');
  expect((await calls(page, 'control_mail_patch'))[0].args.action).toBe('abort');
});

test('refused review focuses the error and applies nothing', async ({ page }) => {
  await setup(page);
  const panel = page.locator('gc-mail-patch-panel');
  await page.evaluate(() => { (window as any).__mail.refused = true; });
  await panel.getByRole('button', { name: 'Choose series to apply…' }).click();
  await expect(panel.getByRole('alert')).toContainText('Commit or stash tracked changes');
  await expect(panel.getByRole('alert')).toBeFocused();
  expect(await calls(page, 'import_mail_patch')).toHaveLength(0);
  await page.evaluate(() => { (window as any).__mail.refused = false; (window as any).__mail.selectedFile = null; });
  await panel.getByRole('button', { name: 'Choose series to apply…' }).click();
  await expect(panel.getByRole('status')).toContainText('Nothing was applied');
  expect(await calls(page, 'review_mail_patch_import')).toHaveLength(1);
});

test('cancel returns focus to the chooser and help opens without applying', async ({ page }) => {
  await page.setViewportSize({ width: 560, height: 720 });
  await setup(page);
  const panel = page.locator('gc-mail-patch-panel');
  await panel.getByRole('button', { name: 'Choose series to apply…' }).click();
  await panel.getByRole('region', { name: 'Mail-patch import review' }).getByRole('button', { name: 'Cancel' }).click();
  await expect(panel.getByRole('button', { name: 'Choose series to apply…' })).toBeFocused();
  const opener = panel.getByRole('button', { name: 'Learn about format-patch and am…' });
  await opener.click();
  await expect(page.getByRole('dialog', { name: 'Git command reference' })).toContainText('No three-way fallback');
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
  expect(await calls(page, 'import_mail_patch')).toHaveLength(0);
});
