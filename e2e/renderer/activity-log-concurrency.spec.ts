import { expect, test } from '@playwright/test';

for (const reading of [false, true]) {
  test(`concurrent ${reading ? 'read and stage' : 'stage and unstage'} preserve their own activity descriptions`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.commit-row').first()).toBeVisible();
    const descriptions = await page.evaluate(async reading => {
      const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
      const repository = git.repository();
      git.activityLogs.set([]);
      git.systemInfo.update((info: any) => ({ ...info, appVersion: 'renderer test' }));
      const finish: Record<string, (value?: unknown) => void> = {};
      (window as any).__TAURI_INTERNALS__ = { invoke: (command: string) => command === 'refresh_repository_status'
        ? Promise.resolve(repository.status) : new Promise(resolve => { finish[command] = resolve; }) };
      const first = reading
        ? git.run('Reading metadata…', async () => { await new Promise(resolve => { finish['read'] = resolve; }); }, repository.id)
        : git.stagePath('first.txt');
      const second = reading ? git.stagePath('second.txt') : git.unstagePath('second.txt');
      // Deliver both replies in the same turn, allowing their continuations to
      // interleave before the log entries are finalized.
      if (reading) { finish['read'](); finish['stage_path'](repository.status); }
      else { finish['stage_path'](repository.status); finish['unstage_path'](repository.status); }
      await Promise.all([first, second]);
      return git.activityLogs().map((entry: any) => ({ description: entry.description, status: entry.status }));
    }, reading);
    expect(descriptions).toEqual([
      { description: reading ? 'Reading metadata' : 'File staged', status: 'success' },
      { description: reading ? 'File staged' : 'File unstaged', status: 'success' },
    ]);
  });
}
