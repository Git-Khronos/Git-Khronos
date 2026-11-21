import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page, staged: number): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#unstaged-files-list')).toBeVisible();
  await page.evaluate(staged => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    const git = app.git;
    git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
    git.repositories.update((items: any[]) => items.map(item => ({ ...item,
      status: { ...item.status, staged } })));
    const fixture = { calls: [] as any[], fail: false, invalidIdentity: false, diagnostic: null as any, hold: false, finish: null as any,
      stageFailure: false, holdStage: false, finishStage: null as any };
    (window as any).__commitPolicy = fixture;
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      fixture.calls.push({ command, args });
      if (command === 'working_tree_change_summary') return Promise.resolve({ staged: null, unstaged: { additions: 0, deletions: 0,
        uncountedFiles: git.repository().status.unstaged + git.repository().status.untracked, partial: true } });
      if (command === 'stage_all') {
        if (fixture.stageFailure) return Promise.reject({ kind: 'sparsePathsNotStaged', message: 'Git left some paths outside the sparse selection.' });
        const status = { ...git.repository().status, staged: 3, unstaged: 0, untracked: 0 };
        if (fixture.holdStage) return new Promise(resolve => { fixture.finishStage = () => resolve(status); });
        return Promise.resolve(status);
      }
      if (command === 'commit_changes') {
        if (fixture.diagnostic) return Promise.reject(fixture.diagnostic);
        if (fixture.invalidIdentity) return Promise.reject({ kind: 'invalidCommitIdentity', message: 'Enter a nonempty name and an explicit email for each enabled commit identity override. Repository configuration is not changed.' });
        if (fixture.fail) return Promise.reject({ kind: 'gitFailure', message: 'Commit hook refused the message. Correct it and retry; staged contents are preserved.' });
        const headOid = 'e'.repeat(40);
        const repository = git.repository();
        const snapshot = { ...repository, headOid,
          branches: repository.branches.map((branch: any) => branch.current ? { ...branch, oid: headOid } : branch),
          status: { ...repository.status, staged: 0 } };
        if (fixture.hold) return new Promise(resolve => {
          fixture.finish = (pushUrl?: string) => resolve(pushUrl ? { ...snapshot,
            remotes: snapshot.remotes.map((remote: any) => remote.name === 'origin' ? { ...remote, pushUrl } : remote),
          } : snapshot);
        });
        return Promise.resolve(snapshot);
      }
      if (['push_repository', 'refresh_repository', 'refresh_repository_metadata'].includes(command)) return Promise.resolve(git.repository());
      if (command === 'refresh_repository_status') return Promise.resolve(git.repository().status);
      return Promise.reject(new Error(`Unexpected ${command}`));
    } };
  }, staged);
}

const compoundCommands = (page: Page) => page.evaluate(() =>
  (window as any).__commitPolicy.calls.filter((call: { command: string }) => ['stage_all', 'commit_changes'].includes(call.command)));

test('stage-and-commit refuses to commit previously staged files after staging fails', async ({ page }) => {
  await setup(page, 1);
  const summary = page.getByLabel('Commit summary', { exact: true });
  await summary.fill('Keep draft after sparse refusal');
  await page.evaluate(async () => {
    (window as any).__commitPolicy.stageFailure = true;
    await (window as any).ng.getComponent(document.querySelector('gc-root')).stageAllAndCommit();
  });
  await expect(page.locator('.error-toast')).toContainText('outside the sparse selection');
  await expect(summary).toHaveValue('Keep draft after sparse refusal');
  expect((await compoundCommands(page)).map((call: any) => call.command)).toEqual(['stage_all']);
});

for (const changed of ['target path', 'branch', 'draft', 'policy', 'repository tab away and back']) {
  test(`stage-and-commit retires the pending commit when the ${changed} changes`, async ({ page }) => {
    await setup(page, 1);
    await page.getByLabel('Commit summary', { exact: true }).fill('Original intent');
    await page.evaluate(async changed => {
      const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
      const fixture = (window as any).__commitPolicy;
      fixture.holdStage = true;
      const action = app.stageAllAndCommit();
      if (changed === 'draft') app.commitMessage.set('New message, no consent');
      else if (changed === 'policy') app.skipGitHooks.set(true);
      else if (changed === 'repository tab away and back') {
        const id = app.git.activeRepositoryId();
        app.git.activeRepositoryId.set(null);
        app.git.activeRepositoryId.set(id);
      }
      else app.git.repositories.update((items: any[]) => items.map(item => item.id !== app.git.activeRepositoryId() ? item
        : changed === 'target path' ? { ...item, path: '/owned/replacement-checkout' }
          : { ...item, status: { ...item.status, branch: 'another-branch' } }));
      fixture.finishStage();
      await action;
    }, changed);
    expect((await compoundCommands(page)).map((call: any) => call.command)).toEqual(['stage_all']);
    await expect(page.getByLabel('Commit summary', { exact: true })).toHaveValue(
      changed === 'draft' ? 'New message, no consent' : 'Original intent');
    if (changed === 'branch') {
      expect(await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.repository().status.branch))
        .toBe('another-branch');
    }
    if (changed === 'draft' || changed === 'policy') {
      await expect(page.locator('.error-toast')).toContainText('Changes were staged, but the commit context changed');
    }
  });
}

test('stage-and-commit leaves unresolved merge entries to the merge tool', async ({ page }) => {
  await setup(page, 1);
  await page.getByLabel('Commit summary', { exact: true }).fill('Commit after resolution');
  await page.evaluate(async () => {
    const app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    app.git.repositories.update((items: any[]) => items.map(item => ({ ...item, status: { ...item.status, conflicted: 1 } })));
    await app.stageAllAndCommit();
  });
  await expect(page.locator('.error-toast')).toContainText('Resolve conflicted files individually');
  expect(await compoundCommands(page)).toEqual([]);
});

test('stage-and-commit shortcut still commits after a matching successful staging receipt', async ({ page }) => {
  await setup(page, 0);
  const summary = page.getByLabel('Commit summary', { exact: true });
  await summary.fill('Stage then commit');
  await page.keyboard.press('Control+Shift+Enter');
  await expect(summary).toHaveValue('');
  expect(await compoundCommands(page)).toMatchObject([
    { command: 'stage_all', args: { repoId: 'browser-preview' } },
    { command: 'commit_changes', args: { repoId: 'browser-preview', message: 'Stage then commit', skipHooks: false } },
  ]);
});

test('unchanged-tree commit needs explicit opt-in and signoff remains distinct from signing', async ({ page }) => {
  await setup(page, 0);
  await page.getByLabel('Commit summary', { exact: true }).fill('Explicit marker');
  const submit = page.locator('.commit-form button[type=submit]');
  await expect(submit).toBeDisabled();
  await page.locator('.commit-policy summary').click();
  await expect(page.locator('.commit-form')).toContainText('not a cryptographic signature');
  await expect(page.getByLabel('Add Signed-off-by trailer', { exact: true })).not.toBeChecked();
  await expect(page.getByLabel('Allow commit without staged changes', { exact: true })).not.toBeChecked();
  await page.getByLabel('Allow commit without staged changes', { exact: true }).check();
  await page.getByLabel('Add Signed-off-by trailer', { exact: true }).check();
  await expect(submit).toHaveText('Create commit without staged changes');
  await submit.click();
  const call = await page.evaluate(() => (window as any).__commitPolicy.calls.find((call: any) => call.command === 'commit_changes'));
  expect(call.args).toMatchObject({ message: 'Explicit marker', amend: false, skipHooks: false, sign: false,
    policy: { signOff: true, allowEmpty: true } });
  await expect(page.getByLabel('Commit summary', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Allow commit without staged changes', { exact: true })).not.toBeChecked();
  await expect(page.getByLabel('Add Signed-off-by trailer', { exact: true })).not.toBeChecked();
  await expect(submit).toBeDisabled();
});

test('hook refusal keeps message and policy for retry and default staged commit does not opt in', async ({ page }) => {
  await setup(page, 1);
  await page.getByLabel('Commit summary', { exact: true }).fill('Keep this message');
  await page.evaluate(() => { (window as any).__commitPolicy.fail = true; });
  await page.locator('.commit-form button[type=submit]').click();
  await expect(page.locator('.error-toast')).toContainText('Commit hook refused');
  await expect(page.getByLabel('Commit summary', { exact: true })).toHaveValue('Keep this message');
  let call = await page.evaluate(() => (window as any).__commitPolicy.calls.find((call: any) => call.command === 'commit_changes'));
  expect(call.args.policy).toEqual({ signOff: false, allowEmpty: false, author: null, committer: null });
  await page.getByRole('button', { name: 'Dismiss error', exact: true }).click();
  await page.locator('.commit-policy summary').click();
  await page.getByLabel('Add Signed-off-by trailer', { exact: true }).check();
  await page.locator('.commit-form button[type=submit]').click();
  await expect(page.getByLabel('Add Signed-off-by trailer', { exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Dismiss error', exact: true }).click();
  await page.evaluate(() => { (window as any).__commitPolicy.fail = false; });
  await page.locator('.commit-form button[type=submit]').click();
  await expect(page.getByLabel('Commit summary', { exact: true })).toHaveValue('');
  call = await page.evaluate(() => (window as any).__commitPolicy.calls.filter((call: any) => call.command === 'commit_changes').at(-1));
  expect(call.args.policy).toEqual({ signOff: true, allowEmpty: false, author: null, committer: null });
});

test('signer and always-run hook failures retain signing and explicit verification opt-out for retry', async ({ page }) => {
  await setup(page, 1);
  await page.getByLabel('Commit summary', { exact: true }).fill('Keep signed draft');
  const sign = page.getByLabel('Sign this commit', { exact: true });
  const skip = page.getByLabel('Skip verification hooks', { exact: true });
  await sign.check();
  await expect(skip).not.toBeChecked();
  await page.evaluate(() => {
    (window as any).__commitPolicy.diagnostic = {
      kind: 'gitFailure', message: 'Signing failed: fixture key is unavailable.',
      hint: 'Correct the configured key and explicitly retry.',
    };
  });
  const submit = page.locator('.commit-form button[type=submit]');
  await submit.click();
  await expect(page.locator('.error-toast')).toContainText('fixture key is unavailable');
  await expect(sign).toBeChecked();
  await expect(skip).not.toBeChecked();
  await expect(page.getByLabel('Commit summary', { exact: true })).toHaveValue('Keep signed draft');
  await page.getByRole('button', { name: 'Dismiss error', exact: true }).click();
  await page.locator('.commit-policy summary').click();
  await expect(page.locator('gc-commit-policy-fields')).toContainText('Prepare-commit-msg and other applicable hooks still run');
  await skip.check();
  await page.evaluate(() => {
    (window as any).__commitPolicy.diagnostic = {
      kind: 'gitFailure', message: 'Prepare-commit-msg fixture refused the message.',
      hint: 'This hook is not bypassed by --no-verify.',
    };
  });
  await submit.click();
  await expect(page.locator('.error-toast')).toContainText('not bypassed');
  await expect(sign).toBeChecked();
  await expect(skip).toBeChecked();
  await expect(page.getByLabel('Commit summary', { exact: true })).toHaveValue('Keep signed draft');
  await page.getByRole('button', { name: 'Dismiss error', exact: true }).click();
  await page.evaluate(() => { (window as any).__commitPolicy.diagnostic = null; });
  await submit.click();
  await expect(page.getByLabel('Commit summary', { exact: true })).toHaveValue('');
  const calls = await page.evaluate(() => (window as any).__commitPolicy.calls.filter((call: any) => call.command === 'commit_changes'));
  expect(calls).toHaveLength(3);
  expect(calls.map((call: any) => [call.args.sign, call.args.skipHooks])).toEqual([
    [true, false], [true, true], [true, true],
  ]);
});

test('stored but unverifiable signatures are not presented as unsigned or verified', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"]').click();
  const panel = page.locator('.commit-panel');
  await expect(panel.getByLabel('Verified signature', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    git.commitDetails.update((details: any) => ({ ...details, signature: {
      status: 'unverifiable', signer: null, key: null, fingerprint: null, trust: null,
    } }));
  });
  await expect(panel.getByLabel('Signature could not be verified', { exact: true })).toBeVisible();
  await expect(panel.locator('.commit-signature')).toContainText('signing tools and trust configuration');
  await expect(panel.getByLabel('Unsigned', { exact: true })).toHaveCount(0);
  await expect(panel.getByLabel('Verified signature', { exact: true })).toHaveCount(0);
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    git.commitDetails.update((details: any) => ({ ...details, signature: {
      status: 'unsigned', signer: null, key: null, fingerprint: null, trust: null,
    } }));
  });
  await expect(panel.getByLabel('Unsigned', { exact: true })).toContainText('No cryptographic signature is stored');
});

test('signature chunk failure is explicit without changing the selected commit or draft', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 720 });
  await page.route('**/chunk-*.js', async route => {
    const response = await route.fetch();
    const text = await response.text();
    if (text.includes('No cryptographic signature is stored') && text.includes('Verified signature')) {
      await route.abort();
    } else {
      await route.fulfill({ response, body: text });
    }
  });
  await page.goto('/');
  const summary = page.getByRole('textbox', { name: 'Commit summary', exact: true });
  await summary.fill('Retain draft on signature view failure');
  await page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"]').click();
  await expect(page.locator('.commit-panel').getByRole('alert')).toContainText('Signature view unavailable');
  await expect(page.locator('.commit-panel')).toContainText('Polish repository activity drawer');
  await expect(page.locator('.commit-panel').getByLabel('Unsigned', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close commit panel', exact: true }).click();
  await page.getByRole('button', { name: /^Open working directory changes/ }).click();
  await expect(summary).toHaveValue('Retain draft on signature view failure');
});

test('signature trust and failure states have distinct text labels rather than color-only feedback', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"]').click();
  const panel = page.locator('.commit-panel');
  await expect(panel.getByLabel('Verified signature', { exact: true })).toBeVisible();
  for (const [status, label] of [
    ['valid-unknown', 'Valid signature · unknown trust'],
    ['invalid', 'Invalid signature'],
    ['expired-signature', 'Expired signature'],
    ['expired-key', 'Expired signing key'],
    ['revoked-key', 'Revoked signing key'],
    ['unverifiable', 'Signature could not be verified'],
  ]) {
    await page.evaluate(status => {
      const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
      git.commitDetails.update((details: any) => ({ ...details, signature: {
        status, signer: 'Fixture signer', key: 'A'.repeat(40), fingerprint: 'A'.repeat(40), trust: null,
      } }));
    }, status);
    const signature = panel.getByLabel(label, { exact: true });
    await expect(signature).toBeVisible();
    await expect(signature.locator('strong')).toHaveText(label);
    await expect(signature).toHaveAttribute('title', `Fixture signer · key ${'A'.repeat(40)}`);
    await expect(panel.getByLabel('Verified signature', { exact: true })).toHaveCount(0);
    await expect(panel.getByLabel('Unsigned', { exact: true })).toHaveCount(0);
  }
});

test('signer configuration failure clears a previous availability result and retries explicitly', async ({ page }) => {
  await setup(page, 1);
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    const fixture = { calls: [] as string[], fail: false };
    (window as any).__signerDiagnostic = fixture;
    (window as any).__TAURI_INTERNALS__ = { invoke: (command: string) => {
      fixture.calls.push(command);
      if (command === 'refresh_repository_status') return Promise.resolve(git.repository().status);
      if (command === 'refresh_repository_metadata') return Promise.resolve(git.repository());
      if (command === 'working_tree_change_summary') {
        const { unstaged, untracked } = git.repository().status;
        return Promise.resolve({ staged: null, unstaged: { additions: 0, deletions: 0,
          uncountedFiles: unstaged + untracked, partial: true } });
      }
      if (command !== 'diagnose_signing') return Promise.reject(new Error(`Unexpected ${command}`));
      if (fixture.fail) return Promise.reject({
        kind: 'invalidSigningProgram', message: 'The configured signing program is empty.',
        hint: 'Correct the effective signer setting before retrying. No default program was substituted.',
      });
      return Promise.resolve({
        available: true, program: '/fixture/openpgp-signer', format: 'openpgp',
        keyConfigured: true, message: 'The configured fixture signer is available.',
      });
    } };
  });
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  const preferences = page.getByRole('dialog', { name: 'Preferences' });
  await preferences.getByRole('tab', { name: /^Git/ }).click();
  const signing = preferences.locator('.signing-preferences');
  await signing.getByRole('button', { name: 'Check Signer', exact: true }).click();
  await expect(signing.locator('.signing-diagnostic')).toContainText('Signer available');
  await expect(signing.locator('.signing-diagnostic')).toContainText('/fixture/openpgp-signer');
  await page.evaluate(() => { (window as any).__signerDiagnostic.fail = true; });
  await signing.getByRole('button', { name: 'Check Signer', exact: true }).click();
  await expect(page.locator('.error-toast')).toContainText('No default program was substituted');
  await expect(signing.locator('.signing-diagnostic')).toHaveCount(0);
  await expect(signing.getByRole('button', { name: 'Check Signer', exact: true })).toBeEnabled();
  await page.evaluate(() => { (window as any).__signerDiagnostic.fail = false; });
  await signing.getByRole('button', { name: 'Check Signer', exact: true }).click();
  await expect(signing.locator('.signing-diagnostic')).toContainText('Signer available');
  const calls = await page.evaluate(() => (window as any).__signerDiagnostic.calls as string[]);
  expect(calls.filter(command => command === 'diagnose_signing')).toEqual([
    'diagnose_signing', 'diagnose_signing', 'diagnose_signing',
  ]);
  const allowedReads = ['diagnose_signing', 'refresh_repository_status', 'refresh_repository_metadata', 'working_tree_change_summary'];
  expect(calls.filter(command => !allowedReads.includes(command))).toEqual([]);
});

test('closing commit details during signature loading never reopens them or steals focus', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 720 });
  let release: (() => void) | undefined;
  let served = false;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/chunk-*.js', async route => {
    const response = await route.fetch();
    const text = await response.text();
    if (text.includes('No cryptographic signature is stored') && text.includes('Verified signature')) {
      await held;
      await route.fulfill({ response, body: text });
      served = true;
      return;
    }
    await route.fulfill({ response, body: text });
  });
  await page.goto('/');
  const row = page.locator('[data-commit-oid="f19b263a8af31408d5f665caf7a5508e108c0fd1"]');
  await row.click();
  const loading = page.locator('.commit-panel').getByRole('status', { name: 'Loading signature verification' });
  await expect(loading).toBeVisible();
  await expect(loading.locator('.signature-placeholder-icon')).toBeVisible();
  await expect(loading.locator('.signature-placeholder-copy i')).toHaveCount(2);
  await expect(loading).not.toContainText('Loading');
  expect((await loading.boundingBox())?.height).toBeGreaterThanOrEqual(42);
  await page.getByRole('button', { name: 'Close commit panel', exact: true }).click();
  await row.focus();
  release!();
  await expect.poll(() => served).toBe(true);
  await expect(row).toBeFocused();
  await expect(page.locator('.commit-panel')).toBeHidden();
  await row.click();
  await expect(page.locator('.commit-panel').getByLabel('Verified signature', { exact: true })).toBeVisible();
});

test('policy is isolated in repository drafts and disabled during an active commit', async ({ page }) => {
  await setup(page, 0);
  await page.getByLabel('Commit summary', { exact: true }).fill('Draft marker');
  await page.locator('.commit-policy summary').click();
  await page.getByLabel('Add Signed-off-by trailer', { exact: true }).check();
  await page.getByLabel('Allow commit without staged changes', { exact: true }).check();
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    git.repositories.update((items: any[]) => [...items, { ...git.repository(), id: 'other-policy', path: '/other-policy', name: 'other-policy' }]);
  });
  await page.locator('[data-repository-tab-id="other-policy"]').click();
  await expect(page.getByLabel('Commit summary', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Add Signed-off-by trailer', { exact: true })).not.toBeChecked();
  await expect(page.getByLabel('Allow commit without staged changes', { exact: true })).not.toBeChecked();
  await page.locator('[data-repository-tab-id]').first().click();
  await expect(page.getByLabel('Commit summary', { exact: true })).toHaveValue('Draft marker');
  await expect(page.getByLabel('Add Signed-off-by trailer', { exact: true })).toBeChecked();
  await expect(page.getByLabel('Allow commit without staged changes', { exact: true })).toBeChecked();
  await page.evaluate(() => { (window as any).__commitPolicy.hold = true; });
  await page.locator('.commit-form button[type=submit]').click();
  await expect(page.getByLabel('Add Signed-off-by trailer', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('Allow commit without staged changes', { exact: true })).toBeDisabled();
  await page.evaluate(() => { (window as any).__commitPolicy.finish(); });
  await expect(page.getByLabel('Commit summary', { exact: true })).toHaveValue('');
});

test('late commit completion never clears another repository draft or pushes its branch', async ({ page }) => {
  await setup(page, 1);
  await page.getByLabel('Commit summary', { exact: true }).fill('Original commit');
  await page.getByLabel('Push after committing', { exact: true }).check();
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    git.repositories.update((items: any[]) => [...items, { ...git.repository(), id: 'other-policy', path: '/other-policy', name: 'other-policy' }]);
    (window as any).__commitPolicy.hold = true;
  });
  await page.locator('.commit-form button[type=submit]').click();
  await expect(page.locator('.commit-form button[type=submit]')).toBeDisabled();
  await page.locator('[data-repository-tab-id="other-policy"]').click();
  await page.getByLabel('Commit summary', { exact: true }).fill('Other draft must remain');
  await page.evaluate(() => { (window as any).__commitPolicy.finish(); });
  await expect(page.locator('.error-toast')).toContainText('Push was not started');
  await expect(page.getByLabel('Commit summary', { exact: true })).toHaveValue('Other draft must remain');
  expect(await page.evaluate(() => (window as any).__commitPolicy.calls.some((call: any) => call.command === 'push_repository'))).toBe(false);
  await page.getByRole('button', { name: 'Dismiss error', exact: true }).click();
  await page.locator('[data-repository-tab-id]').first().click();
  await expect(page.getByLabel('Commit summary', { exact: true })).toHaveValue('');
});

for (const change of ['during staging', 'during commit', 'with a changed push URL', 'unchanged'] as const) {
  test(`commit and push respects the selected destination ${change}`, async ({ page }) => {
    await setup(page, 1);
    const summary = page.getByLabel('Commit summary', { exact: true });
    await summary.fill('Originally selected push destination');
    await page.getByLabel('Push after committing', { exact: true }).check();
    await page.evaluate(change => {
      const { git } = (window as any).ng.getComponent(document.querySelector('gc-root'));
      const fixture = (window as any).__commitPolicy;
      git.repositories.update((items: any[]) => items.map(item => ({ ...item, remotes: [
        ...item.remotes, { name: 'alternate', fetchUrl: '/owned/alternate', pushUrl: '/owned/alternate' },
      ] })));
      if (change === 'during staging') fixture.holdStage = true;
      else fixture.hold = true;
    }, change);
    if (change === 'during staging') await page.keyboard.press('Control+Shift+Enter');
    else await page.locator('.commit-form button[type=submit]').click();
    const finish = change === 'during staging' ? 'finishStage' : 'finish';
    await expect.poll(() => page.evaluate(finish => typeof (window as any).__commitPolicy[finish], finish)).toBe('function');
    if (change === 'during staging' || change === 'during commit') {
      await page.getByRole('button', { name: /^Select remote, current origin/ }).click();
      await page.getByRole('menuitemradio', { name: /alternate/ }).click();
      await expect(page.getByRole('button', { name: /^Select remote, current alternate/ })).toBeVisible();
    }
    await page.evaluate(({ finish, change }) => (window as any).__commitPolicy[finish](
      change === 'with a changed push URL' ? '/owned/changed-origin' : undefined,
    ), { finish, change });
    if (change === 'unchanged') {
      await expect.poll(() => page.evaluate(() => (window as any).__commitPolicy.calls
        .filter((call: any) => call.command === 'push_repository').map((call: any) => call.args)))
        .toEqual([expect.objectContaining({ remote: 'origin', branch: 'main' })]);
      await expect(summary).toHaveValue('');
    } else {
      await expect(page.getByRole('alert')).toContainText(change === 'during staging'
        ? 'Changes were staged, but the commit context changed' : 'Push was not started because the selected push destination changed');
      await expect(summary).toHaveValue(change === 'during staging' ? 'Originally selected push destination' : '');
      expect((await compoundCommands(page)).map((call: any) => call.command))
        .toEqual([change === 'during staging' ? 'stage_all' : 'commit_changes']);
      expect(await page.evaluate(() => (window as any).__commitPolicy.calls
        .filter((call: any) => call.command === 'push_repository'))).toEqual([]);
    }
  });
}

for (const route of ['tracked', 'unpublished', 'detached'] as const) {
  test(`commit composer previews the ${route} push follow-up`, async ({ page }) => {
    await setup(page, 1);
    await page.evaluate(route => {
      const { git } = (window as any).ng.getComponent(document.querySelector('gc-root'));
      git.repositories.update((items: any[]) => items.map(item => ({
        ...item,
        status: route === 'detached' ? { ...item.status, branch: null } : item.status,
        branches: item.branches.map((branch: any) => !branch.current ? branch : {
          ...branch, current: route !== 'detached',
          upstream: route === 'tracked' ? 'origin/target/topic' : null,
        }),
      })));
    }, route);
    await page.getByLabel('Commit summary', { exact: true }).fill('Preview the result before doing anything');
    await page.getByLabel('Push after committing', { exact: true }).check();
    const readiness = page.locator('#commit-readiness');
    const submit = page.locator('.commit-form button[type=submit]');
    if (route === 'tracked') {
      await expect(readiness).toContainText('then push to origin/target/topic');
      await expect(submit).toContainText('and push');
    } else if (route === 'unpublished') {
      await expect(readiness).toContainText('then review publishing main to origin');
      await expect(submit).toContainText('and review publishing');
      await submit.click();
      await expect(page.getByRole('dialog', { name: 'Publish main', exact: true })
        .getByLabel('Publish remote', { exact: true })).toHaveValue('origin');
    } else {
      await expect(readiness).toContainText('Detached HEAD: the commit stays local');
      await expect(submit).not.toContainText('and push');
      await submit.click();
      await expect(page.getByLabel('Commit summary', { exact: true })).toHaveValue('');
    }
    expect(await page.evaluate(() => (window as any).__commitPolicy.calls
      .filter((call: any) => ['push_repository', 'publish_branch'].includes(call.command)))).toEqual([]);
  });
}

for (const navigation of ['stay', 'switch tabs', 'return to the submitted text'] as const) {
  test(`late commit completion retains a newer draft when users ${navigation}`, async ({ page }) => {
    await setup(page, 1);
    const summary = page.getByLabel('Commit summary', { exact: true });
    const description = page.getByLabel('Commit description', { exact: true });
    await summary.fill('Submitted message');
    await description.fill('Submitted body');
    await page.evaluate(() => {
      const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
      git.repositories.update((items: any[]) => [...items, { ...git.repository(), id: 'other-draft', path: '/other-draft', name: 'other-draft' }]);
      (window as any).__commitPolicy.hold = true;
    });
    await page.locator('.commit-form button[type=submit]').click();
    await expect(page.locator('.commit-form button[type=submit]')).toBeDisabled();
    await summary.fill('Write the next draft');
    await description.fill('New body');
    if (navigation === 'switch tabs') {
      await page.locator('[data-repository-tab-id="other-draft"]').click();
      await summary.fill('Other checkout draft');
    } else if (navigation === 'return to the submitted text') {
      await summary.fill('Submitted message');
      await description.fill('Submitted body');
    }
    await page.evaluate(() => { (window as any).__commitPolicy.finish(); });
    await expect.poll(() => page.evaluate(() => {
      const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
      return [git.busy(), git.repositories().find((entry: any) => entry.id === 'browser-preview')?.headOid];
    })).toEqual([false, 'e'.repeat(40)]);
    if (navigation === 'switch tabs') {
      await expect(summary).toHaveValue('Other checkout draft');
      await page.locator('[data-repository-tab-id="browser-preview"]').click();
    }
    await expect(summary).toHaveValue(navigation === 'return to the submitted text' ? 'Submitted message' : 'Write the next draft');
    await expect(description).toHaveValue(navigation === 'return to the submitted text' ? 'Submitted body' : 'New body');
    expect(await page.evaluate(() => (window as any).__commitPolicy.calls
      .filter((call: any) => call.command === 'commit_changes').map((call: any) => call.args.message)))
      .toEqual(['Submitted message\n\nSubmitted body']);
  });
}

test('late commit success does not clear an in-progress co-author entry', async ({ page }) => {
  await setup(page, 1);
  await page.getByLabel('Commit summary', { exact: true }).fill('One commit');
  await page.evaluate(() => { (window as any).__commitPolicy.hold = true; });
  const submit = page.locator('.commit-form button[type=submit]');
  await submit.click();
  await expect(submit).toBeDisabled();
  await page.getByRole('button', { name: 'Add co-author', exact: true }).click();
  const name = page.locator('input[name=coAuthorName]');
  await name.fill('Next collaborator');
  await page.evaluate(() => { (window as any).__commitPolicy.finish(); });
  await expect.poll(() => page.evaluate(() =>
    (window as any).ng.getComponent(document.querySelector('gc-root')).git.repository().headOid)).toBe('e'.repeat(40));
  await expect(name).toHaveValue('Next collaborator');
  await expect(page.getByLabel('Commit summary', { exact: true })).toHaveValue('');
});

for (const commitBeforeSwitch of [false, true]) {
  test(`manual co-author input belongs to its checkout ${commitBeforeSwitch ? 'after a late commit' : 'across tab switches'}`, async ({ page }) => {
    await setup(page, 1);
    const summary = page.getByLabel('Commit summary', { exact: true });
    const toggle = page.locator('.commit-composer .add-coauthor');
    const name = page.locator('input[name=coAuthorName]');
    const email = page.locator('input[name=coAuthorEmail]');
    const original = page.locator('[data-repository-tab-id="browser-preview"]');
    const other = page.locator('[data-repository-tab-id="other-coauthor"]');
    await page.evaluate(() => {
      const { git } = (window as any).ng.getComponent(document.querySelector('gc-root'));
      git.repositories.update((items: any[]) => [...items, { ...git.repository(),
        id: 'other-coauthor', path: '/other-coauthor', name: 'other-coauthor' }]);
    });
    await summary.fill('Original draft');
    await toggle.click();
    await name.fill('Original collaborator');
    await email.fill('unfinished@');
    if (commitBeforeSwitch) {
      await page.evaluate(() => { (window as any).__commitPolicy.hold = true; });
      await page.locator('.commit-form button[type=submit]').click();
      await expect.poll(() => page.evaluate(() => typeof (window as any).__commitPolicy.finish)).toBe('function');
    }

    await other.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(name).toHaveValue('');
    await expect(email).toHaveValue('');
    await name.fill('Other collaborator');
    if (commitBeforeSwitch) {
      await page.evaluate(() => (window as any).__commitPolicy.finish());
      await expect.poll(() => page.evaluate(() => {
        const { git } = (window as any).ng.getComponent(document.querySelector('gc-root'));
        return git.repositories().find((repo: any) => repo.id === 'browser-preview')?.headOid;
      })).toBe('e'.repeat(40));
    }

    await original.click();
    await expect(summary).toHaveValue(commitBeforeSwitch ? '' : 'Original draft');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(name).toHaveValue('Original collaborator');
    await expect(email).toHaveValue('unfinished@');
    await expect(page.getByLabel('Commit co-authors')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (window as any).__commitPolicy.calls
      .filter((call: any) => call.command === 'commit_changes').map((call: any) => call.args.message)))
      .toEqual(commitBeforeSwitch ? ['Original draft'] : []);
    await other.click();
    await toggle.click();
    await expect(name).toHaveValue('Other collaborator');
    await expect(email).toHaveValue('');
    if (!commitBeforeSwitch) {
      const reopened = await page.evaluate(() => {
        const { git } = (window as any).ng.getComponent(document.querySelector('gc-root'));
        return git.repositories().find((repo: any) => repo.id === 'browser-preview');
      });
      const backgroundTab = page.locator('.repo-tab').filter({ has: original });
      await backgroundTab.hover();
      await backgroundTab.getByRole('button', { name: /^Close / }).click();
      await expect(original).toHaveCount(0);
      await page.evaluate(repo => {
        const { git } = (window as any).ng.getComponent(document.querySelector('gc-root'));
        git.repositories.update((items: any[]) => [...items, repo]);
      }, reopened);
      await original.click();
      await expect(summary).toHaveValue('');
      await toggle.click();
      await expect(name).toHaveValue('');
      await expect(email).toHaveValue('');
    }
  });
}

test('compact policy disclosure supports keyboard access and contextual help without horizontal clipping', async ({ page }) => {
  await setup(page, 0);
  await page.setViewportSize({ width: 820, height: 720 });
  const summary = page.locator('.commit-policy summary');
  await expect(page.getByLabel('Add Signed-off-by trailer', { exact: true })).not.toBeVisible();
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Add Signed-off-by trailer', { exact: true })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Add Signed-off-by trailer', { exact: true })).toBeFocused();
  await expect(page.getByLabel('Add Signed-off-by trailer', { exact: true })).toHaveAttribute('aria-describedby', 'commit-signoff-help');
  expect(await page.locator('.commit-policy').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  const help = page.getByRole('button', { name: 'Learn about commit policy…', exact: true });
  await help.click();
  const dialog = page.getByRole('dialog', { name: 'Git command reference', exact: true });
  await expect(dialog.locator('details[open]')).toContainText('Sign-off is a project-specific contributor statement');
  await page.keyboard.press('Escape');
  await expect(help).toBeFocused();
  expect(await page.evaluate(() => (window as any).__commitPolicy.calls.some((call: any) => call.command === 'commit_changes'))).toBe(false);
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Add Signed-off-by trailer', { exact: true })).not.toBeVisible();
});

test('identity overrides are explicit complete pairs, transmitted for one commit and reset on success', async ({ page }) => {
  await setup(page, 1);
  await page.locator('.commit-policy summary').click();
  await page.getByLabel('Override commit author', { exact: true }).check();
  await page.getByLabel('Author name', { exact: true }).fill('Original Writer');
  await page.getByLabel('Author email', { exact: true }).fill('writer@example.test');
  await page.getByLabel('Override commit committer', { exact: true }).check();
  await page.getByLabel('Committer name', { exact: true }).fill('Recording Person');
  await page.getByLabel('Committer email', { exact: true }).fill('recorder@example.test');
  await page.getByLabel('Add Signed-off-by trailer', { exact: true }).check();
  await page.getByLabel('Commit summary', { exact: true }).fill('Scoped identities');
  await expect(page.locator('gc-commit-policy-fields')).toContainText('No Git configuration is saved');
  await page.locator('.commit-form button[type=submit]').click();
  const policy = await page.evaluate(() => (window as any).__commitPolicy.calls.find((call: any) => call.command === 'commit_changes').args.policy);
  expect(policy).toEqual({ signOff: true, allowEmpty: false,
    author: { name: 'Original Writer', email: 'writer@example.test' },
    committer: { name: 'Recording Person', email: 'recorder@example.test' } });
  await expect(page.getByLabel('Override commit author', { exact: true })).not.toBeChecked();
  await expect(page.getByLabel('Override commit committer', { exact: true })).not.toBeChecked();
  await expect(page.getByLabel('Author name', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__commitPolicy.calls.some((call: any) => call.command === 'set_repository_identity'))).toBe(false);
});

test('identity values stay in their repository draft and failed commits keep them for correction', async ({ page }) => {
  await setup(page, 1);
  await page.locator('.commit-policy summary').click();
  await page.getByLabel('Override commit author', { exact: true }).check();
  await page.getByLabel('Author name', { exact: true }).fill('Draft Writer');
  await page.getByLabel('Author email', { exact: true }).fill('draft@example.test');
  await page.getByLabel('Commit summary', { exact: true }).fill('Retain identity');
  await page.evaluate(() => {
    const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
    git.repositories.update((items: any[]) => [...items, { ...git.repository(), id: 'other-policy', path: '/other-policy', name: 'other-policy' }]);
  });
  await page.locator('[data-repository-tab-id="other-policy"]').click();
  await expect(page.getByLabel('Override commit author', { exact: true })).not.toBeChecked();
  await expect(page.getByLabel('Author name', { exact: true })).toHaveCount(0);
  await page.locator('[data-repository-tab-id]').first().click();
  await expect(page.getByLabel('Author name', { exact: true })).toHaveValue('Draft Writer');
  await expect(page.getByLabel('Author email', { exact: true })).toHaveValue('draft@example.test');
  await page.evaluate(() => { (window as any).__commitPolicy.fail = true; });
  await page.locator('.commit-form button[type=submit]').click();
  await expect(page.locator('.error-toast')).toContainText('Commit hook refused');
  await page.getByRole('button', { name: 'Dismiss error', exact: true }).click();
  await expect(page.getByLabel('Author name', { exact: true })).toHaveValue('Draft Writer');
  await page.getByLabel('Override commit author', { exact: true }).uncheck();
  await expect(page.getByLabel('Author name', { exact: true })).toHaveCount(0);
  await page.evaluate(() => { (window as any).__commitPolicy.fail = false; });
  await page.locator('.commit-form button[type=submit]').click();
  expect(await page.evaluate(() => (window as any).__commitPolicy.calls.filter((call: any) => call.command === 'commit_changes').at(-1).args.policy.author)).toBeNull();
});

test('identity controls load progressively and contain long values in compact view while pending commit disables editing', async ({ page }) => {
  const formWarnings: string[] = [];
  page.on('console', message => {
    if (message.type() === 'warning' && message.text().includes('NG01354')) formWarnings.push(message.text());
  });
  await setup(page, 1);
  await page.setViewportSize({ width: 820, height: 720 });
  await expect(page.locator('gc-commit-policy-fields')).toHaveCount(0);
  await page.locator('.commit-policy summary').click();
  await page.getByLabel('Override commit committer', { exact: true }).check();
  await page.getByLabel('Committer name', { exact: true }).fill('n'.repeat(256));
  await page.getByLabel('Committer email', { exact: true }).fill('committer@example.test');
  expect(await page.locator('gc-commit-policy-fields').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.getByLabel('Commit summary', { exact: true }).fill('Pending identity');
  await page.evaluate(() => { (window as any).__commitPolicy.hold = true; });
  await page.locator('.commit-form button[type=submit]').click();
  await expect(page.getByLabel('Committer name', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('Override commit committer', { exact: true })).toBeDisabled();
  await page.evaluate(() => { (window as any).__commitPolicy.finish(); });
  await expect(page.getByLabel('Commit summary', { exact: true })).toHaveValue('');
  expect(formWarnings).toEqual([]);
});

test('invalid identity feedback is explicit and the entered override remains available for correction', async ({ page }) => {
  await setup(page, 1);
  await page.locator('.commit-policy summary').click();
  await page.getByLabel('Override commit author', { exact: true }).check();
  await page.getByLabel('Author email', { exact: true }).fill('not-an-explicit-email');
  await page.getByLabel('Commit summary', { exact: true }).fill('Fix my identity');
  await page.evaluate(() => { (window as any).__commitPolicy.invalidIdentity = true; });
  await page.locator('.commit-form button[type=submit]').click();
  await expect(page.locator('.error-toast')).toContainText('explicit email');
  await page.getByRole('button', { name: 'Dismiss error', exact: true }).click();
  await expect(page.getByLabel('Author email', { exact: true })).toHaveValue('not-an-explicit-email');
  await expect(page.getByLabel('Commit summary', { exact: true })).toHaveValue('Fix my identity');
  await page.getByLabel('Author email', { exact: true }).fill('corrected@example.test');
  await page.evaluate(() => { (window as any).__commitPolicy.invalidIdentity = false; });
  await page.locator('.commit-form button[type=submit]').click();
  await expect(page.getByLabel('Commit summary', { exact: true })).toHaveValue('');
});

test('failed policy chunk reports an explicit error and leaves ordinary commit defaults intact', async ({ page }) => {
  await page.route('**/chunk-*.js', async route => {
    const response = await route.fetch();
    const text = await response.text();
    if (text.includes('Override commit author') && text.includes('Override commit committer')) await route.abort();
    else await route.fulfill({ response, body: text });
  });
  await setup(page, 1);
  await page.locator('.commit-policy summary').click();
  await expect(page.locator('.commit-policy [role=alert]')).toContainText('No option was changed');
  await page.locator('.commit-policy summary').focus();
  await page.keyboard.press('Enter');
  await page.getByLabel('Commit summary', { exact: true }).fill('Ordinary defaults');
  await page.locator('.commit-form button[type=submit]').click();
  const policy = await page.evaluate(() => (window as any).__commitPolicy.calls.find((call: any) => call.command === 'commit_changes').args.policy);
  expect(policy).toEqual({ signOff: false, allowEmpty: false, author: null, committer: null });
});

test('closing policy while its chunk loads never reopens it, steals focus or changes commit defaults', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/chunk-*.js', async route => {
    const response = await route.fetch();
    const text = await response.text();
    if (text.includes('Override commit author') && text.includes('Override commit committer')) await gate;
    await route.fulfill({ response, body: text });
  });

  await setup(page, 1);
  const summary = page.locator('.commit-policy summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.commit-policy [role=status]')).toBeVisible();
  await page.keyboard.press('Enter');
  release();
  await expect(page.locator('gc-commit-policy-fields')).toHaveCount(1);
  await expect(summary).toBeFocused();
  await expect(page.getByLabel('Override commit author', { exact: true })).not.toBeVisible();
  expect(await page.locator('.commit-policy').evaluate(element => (element as HTMLDetailsElement).open)).toBe(false);
  expect(await page.evaluate(() => (window as any).__commitPolicy.calls.some((call: any) => call.command === 'commit_changes'))).toBe(false);
  await summary.click();
  await expect(page.getByLabel('Override commit author', { exact: true })).not.toBeChecked();
  await expect(page.getByLabel('Override commit committer', { exact: true })).not.toBeChecked();
});

test('repository failure guidance is visible with original errors, retained drafts and no automatic write retries', async ({ page }) => {
  await setup(page, 1);
  const summary = page.getByLabel('Commit summary', { exact: true });
  await summary.fill('Keep staged work for safe recovery');
  for (const diagnostic of [
    { message: 'Unable to create index.lock: File exists.', hint: 'Wait for the other operation. Never delete a lock while its owner may still be running.' },
    { message: 'Object file is empty.', hint: 'Preserve the repository and run git fsck --full. Maintenance and pruning cannot restore missing data.' },
    { message: 'No space left on device.', hint: 'Free space. Writes may have partially completed; inspect repository status before retrying.' },
    { message: 'Index file smaller than expected.', hint: 'Preserve staged data. Do not delete or rebuild the index automatically.' },
  ]) {
    await page.evaluate(diagnostic => { (window as any).__commitPolicy.diagnostic = { kind: 'gitFailure', ...diagnostic }; }, diagnostic);
    await page.locator('.commit-form button[type=submit]').click();
    await expect(page.locator('.error-toast')).toContainText(diagnostic.message);
    await expect(page.locator('.error-toast')).toContainText(diagnostic.hint);
    await expect(summary).toHaveValue('Keep staged work for safe recovery');
    await page.getByRole('button', { name: 'Dismiss error', exact: true }).click();
  }
  const commands = await page.evaluate(() => (window as any).__commitPolicy.calls.map((call: any) => call.command));
  expect(commands.filter((command: string) => command === 'commit_changes')).toHaveLength(4);
  expect(commands.every((command: string) => ['commit_changes', 'refresh_repository', 'refresh_repository_status', 'refresh_repository_metadata', 'working_tree_change_summary'].includes(command))).toBe(true);
});
