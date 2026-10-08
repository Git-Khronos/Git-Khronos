import { expect, test } from '@playwright/test';

const failures = {
  bare: { kind: 'bareRepositoryUnsupported',
    message: "This is a bare repository: it stores history and references without a working tree. Git reported: fatal: this operation must be run in a work tree",
    hint: 'Git Chronos opens working trees. Clone it into a new folder, or add a worktree with local Git (git worktree add), then open that folder. Nothing was changed.' },
  format: { kind: 'unsupportedRepositoryFormat',
    message: 'This repository uses a format that the installed Git does not support. Git reported: fatal: unknown repository extension found: chronosunknownfeature',
    hint: 'Update Git, or use the tool that created the repository. Nothing was changed.' },
};

for (const [name, failure] of Object.entries(failures)) {
  test(`opening ${name} repository data explains the refusal and keeps the current tab`, async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#unstaged-files-list')).toBeVisible();
    const before = await page.evaluate((failure) => {
      const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
      (window as any).__openCalls = [];
      (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
        (window as any).__openCalls.push({ command, args });
        return command === 'open_repository' ? Promise.reject(failure) : Promise.reject(new Error(`Unexpected ${command}`));
      } };
      return { id: git.activeRepositoryId(), count: git.repositories().length };
    }, failure);
    await page.evaluate(() => (window as any).ng.getComponent(document.querySelector('gc-root')).git.openRepository('/srv/shared.git'));
    const alert = page.getByRole('alert').filter({ hasText: failure.hint });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('Git reported:');
    const after = await page.evaluate(() => {
      const git = (window as any).ng.getComponent(document.querySelector('gc-root')).git;
      return { id: git.activeRepositoryId(), count: git.repositories().length, calls: (window as any).__openCalls.map((call: any) => call.command) };
    });
    expect(after).toEqual({ ...before, calls: ['open_repository'] });
  });
}
