import { expect, test, type Page } from '@playwright/test';
import type { IncomingRepositoryLink } from '@git-khronos/contracts';

function request(id = 'incoming-owned-1', name = 'first'): IncomingRepositoryLink {
  const remote = `https://owned-inbox.example.test/team/${name}.git`;
  const reference = `refs/heads/topic/${name}`;
  return { id, payload: { kind: 'ready', uri: `git-khronos://repository?v=1&remote=${encodeURIComponent(remote)}&ref=${encodeURIComponent(reference)}`,
    link: { remote, target: { kind: 'reference', reference } } } };
}

async function prepare(page: Page, options: { bootstrap?: boolean; heldListener?: boolean; requests?: IncomingRepositoryLink[]; overflowed?: boolean } = {}) {
  await page.goto('/');
  await expect(page.locator('.commit-row').first()).toBeVisible();
  await page.evaluate(async options => {
    const state: any = { callbacks: new Map(), handlers: new Map(), calls: [], listeners: [], unlisteners: [], next: 400,
      queue: { requests: options.requests, overflowed: options.overflowed }, heldListener: options.heldListener };
    state.app = (window as any).ng.getComponent(document.querySelector('gc-root'));
    state.git = state.app.git;
    const repository = state.git.repository();
    await state.git.inspectCommit(repository.headOid);
    state.details = state.git.commitDetails();
    state.repository = repository;
    state.opened = { ...repository, id: 'opened-incoming-context', path: '/owned/incoming-context', name: 'opened-incoming-context' };
    state.info = { ...state.git.systemInfo(), appVersion: 'owned incoming renderer' };
    state.git.systemInfo.set(state.info);
    state.git.incomingRepositoryLinksReady.set(true);
    state.policies = {};
    state.emit = () => state.handlers.get('incoming-repository-links-changed')?.({ payload: { pending: state.queue.requests.length > 0 || state.queue.overflowed } });
    const w = window as any;
    w.__incoming = state;
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => undefined };
    w.__TAURI_INTERNALS__ = {
      transformCallback: (handler: unknown) => { state.callbacks.set(++state.next, handler); return state.next; },
      unregisterCallback: (id: number) => state.callbacks.delete(id),
      invoke: (command: string, args: any) => {
        state.calls.push({ command, args });
        if (command === 'plugin:event|listen') {
          const id = state.listeners.length + 1;
          state.listeners.push({ id, event: args.event });
          state.handlers.set(args.event, state.callbacks.get(args.handler));
          if (state.heldListener && args.event === 'incoming-repository-links-changed') return new Promise(resolve => { state.finishListener = () => resolve(id); });
          return Promise.resolve(id);
        }
        if (command === 'plugin:event|unlisten') { state.unlisteners.push(args.eventId); return Promise.resolve(null); }
        if (command === 'system_info') return Promise.resolve(state.info);
        if (command === 'incoming_repository_links') {
          if (state.failSnapshot) return Promise.reject({ message: 'Owned inbox read unavailable' });
          const snapshot = structuredClone(state.queue);
          if (state.holdNextSnapshot) { state.holdNextSnapshot = false; return new Promise(resolve => { state.finishSnapshot = () => resolve(snapshot); }); }
          return Promise.resolve(snapshot);
        }
        if (command === 'acknowledge_incoming_repository_link') {
          if (!state.queue.requests.some((entry: any) => entry.id === args.requestId)) return Promise.reject({ kind: 'staleIncomingRepositoryLink' });
          state.queue.requests = state.queue.requests.filter((entry: any) => entry.id !== args.requestId);
          const result = structuredClone(state.queue); state.emit(); return Promise.resolve(result);
        }
        if (command === 'dismiss_incoming_repository_link_overflow') { state.queue.overflowed = false; state.emit(); return Promise.resolve(structuredClone(state.queue)); }
        if (command === 'repository_link_read_policies') return Promise.resolve(structuredClone(state.policies));
        if (command === 'discover_repository_link') {
          const link = state.queue.requests.find((entry: any) => entry.payload.kind === 'ready' && entry.payload.uri === args.rawLink)?.payload.link;
          return Promise.resolve({ link, inspectedPaths: args.knownPaths.length, matches: [{ link, path: state.opened.path, bare: false, matchedRemotes: ['origin'], target: { kind: 'commit', oid: state.opened.headOid } }], unavailable: [] });
        }
        if (command === 'open_repository_link') {
          const link = state.queue.requests.find((entry: any) => entry.payload.kind === 'ready' && entry.payload.uri === args.rawLink)?.payload.link;
          state.policies[state.opened.id] = { noLazyReads: true, autoFetchPaused: true };
          return Promise.resolve({ repository: state.opened, inspection: { link, path: state.opened.path, bare: false, matchedRemotes: ['origin'], target: { kind: 'commit', oid: state.opened.headOid } } });
        }
        if (command === 'inspect_commit') return Promise.resolve(state.details);
        if (command === 'open_repository') {
          if (args.path === state.holdRestorePath) return new Promise(resolve => { state.finishRestore = () => resolve(state.otherRepository); });
          return Promise.resolve(repository);
        }
        if (command === 'refresh_repository_status') return Promise.resolve(state.git.repository()?.status ?? repository.status);
        if (/^refresh_repository/.test(command)) return Promise.resolve(state.git.repository() ?? repository);
        if (command === 'cancel_git_operation') return Promise.resolve(true);
        return Promise.resolve(null);
      },
    };
    if (options.bootstrap) await state.git.retryIncomingRepositoryLinks();
  }, { bootstrap: options.bootstrap ?? true, heldListener: options.heldListener ?? false, requests: options.requests ?? [request()], overflowed: options.overflowed ?? false });
}
const inbox = (page: Page) => page.getByRole('dialog', { name: 'Incoming repository links', exact: true });
const linkDialog = (page: Page) => page.getByRole('dialog', { name: 'Open repository link', exact: true });
async function openInbox(page: Page) {
  await page.getByRole('button', { name: 'Incoming repository links', exact: true }).click();
  await expect(inbox(page)).toBeVisible();
  return inbox(page);
}
async function calls(page: Page, command: string) { return page.evaluate(command => (window as any).__incoming.calls.filter((entry: any) => entry.command === command), command); }

test('queues context without opening, cloning or fetching and retains it after closing review', async ({ page }) => {
  await prepare(page, { requests: [request(), request('incoming-owned-2', 'second')] });
  const dialog = await openInbox(page);
  await expect(dialog.getByText('https://owned-inbox.example.test/team/first.git', { exact: true })).toBeVisible();
  await expect(dialog.getByText('refs/heads/topic/second', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Incoming repository links', exact: true })).toBeFocused();
  expect(await calls(page, 'discover_repository_link')).toHaveLength(0);
  expect(await calls(page, 'open_repository_link')).toHaveLength(0);
  expect(await calls(page, 'clone_repository')).toHaveLength(0);
  expect(await calls(page, 'fetch_repository')).toHaveLength(0);
});

test('a new arrival cannot retarget the link currently under review', async ({ page }) => {
  await prepare(page);
  const dialog = await openInbox(page);
  await dialog.getByRole('button', { name: 'Review local context…', exact: true }).click();
  await expect(linkDialog(page).getByRole('textbox', { name: 'Repository link', exact: true })).toHaveValue((request().payload as { uri: string }).uri);
  await page.evaluate(next => { const state = (window as any).__incoming; state.queue.requests.push(next); state.emit(); }, request('incoming-owned-2', 'second'));
  await expect(linkDialog(page).getByRole('textbox', { name: 'Repository link', exact: true })).toHaveValue((request().payload as { uri: string }).uri);
  await linkDialog(page).getByRole('button', { name: 'Close repository link', exact: true }).click();
  await expect(inbox(page)).toBeVisible();
  await expect(inbox(page).getByRole('button', { name: 'Review local context…', exact: true })).toHaveCount(2);
  expect(await calls(page, 'acknowledge_incoming_repository_link')).toHaveLength(0);
});

test('explicit dismissal consumes exactly its ID and releases the temporary fetch pause after the last request', async ({ page }) => {
  await prepare(page, { requests: [request(), request('incoming-owned-2', 'second')] });
  const dialog = await openInbox(page);
  await dialog.getByRole('button', { name: 'Dismiss request', exact: true }).first().click();
  await expect(dialog.getByRole('button', { name: 'Dismiss request', exact: true })).toHaveCount(1);
  expect((await calls(page, 'acknowledge_incoming_repository_link'))[0].args.requestId).toBe('incoming-owned-1');
  expect(await page.evaluate(() => (window as any).__incoming.git.incomingRepositoryLinksPending())).toBe(true);
  await dialog.getByRole('button', { name: 'Dismiss request', exact: true }).click();
  await expect(dialog.getByText('No queued repository links.', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__incoming.git.incomingRepositoryLinksPending())).toBe(false);
  expect(await calls(page, 'sync_repository')).toHaveLength(0);
  expect(await calls(page, 'fetch_repository')).toHaveLength(0);
});

test('rejected requests contain static feedback and never enter repository discovery', async ({ page }) => {
  await prepare(page, { requests: [{ id: 'incoming-rejected', payload: { kind: 'rejected', message: 'Owned malformed request was refused.' } }] });
  const dialog = await openInbox(page);
  await expect(dialog.getByRole('alert')).toHaveText('Owned malformed request was refused.');
  await expect(dialog.getByRole('textbox')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Dismiss invalid request', exact: true }).click();
  await expect(dialog.getByText('No queued repository links.', { exact: true })).toBeVisible();
  expect(await calls(page, 'discover_repository_link')).toHaveLength(0);
  expect(await calls(page, 'open_repository_link')).toHaveLength(0);
});

test('overflow remains visible and paused until its notice is explicitly dismissed', async ({ page }) => {
  await prepare(page, { requests: [], overflowed: true });
  const dialog = await openInbox(page);
  await expect(dialog.getByRole('alert')).toContainText('Additional links could not be queued');
  await dialog.getByRole('button', { name: 'Dismiss overflow notice', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__incoming.git.incomingRepositoryLinksPending())).toBe(false);
  expect(await calls(page, 'dismiss_incoming_repository_link_overflow')).toHaveLength(1);
});

test('an arrival preserves an existing clone review and its ordinary form draft', async ({ page }) => {
  await prepare(page, { requests: [] });
  await page.getByRole('button', { name: 'New repository tab', exact: true }).click();
  const manager = page.getByRole('dialog', { name: 'Repository management', exact: true });
  await manager.getByRole('tab', { name: 'Clone', exact: true }).click();
  await manager.getByRole('textbox', { name: 'Repository URL', exact: true }).fill('https://ordinary.example.test/retained.git');
  await page.evaluate(next => { const state = (window as any).__incoming; state.queue.requests.push(next); state.emit(); }, request());
  await expect(manager.getByRole('textbox', { name: 'Repository URL', exact: true })).toHaveValue('https://ordinary.example.test/retained.git');
  await expect(inbox(page)).toHaveCount(0);
  await page.evaluate(() => (window as any).__incoming.app.openIncomingLinks());
  await expect(inbox(page)).toHaveCount(0);
  await manager.getByRole('button', { name: 'Close repository management', exact: true }).click();
  await openInbox(page);
  expect(await calls(page, 'clone_repository')).toHaveLength(0);
});

test('failed hydration retains the last queue and offers a reconnecting retry', async ({ page }) => {
  await prepare(page);
  await page.evaluate(async () => { const state = (window as any).__incoming; state.failSnapshot = true; await state.git.refreshIncomingRepositoryLinks(); });
  const dialog = await openInbox(page);
  await expect(dialog.getByRole('alert')).toContainText('Incoming links could not be read');
  await expect(dialog.getByRole('button', { name: 'Review local context…', exact: true })).toHaveCount(1);
  await page.evaluate(() => { (window as any).__incoming.failSnapshot = false; });
  await dialog.getByRole('button', { name: 'Retry incoming links', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__incoming.listeners.length)).toBe(2);
});

test('a listener registration completing after destruction is released without reading or reopening requests', async ({ page }) => {
  await prepare(page, { bootstrap: false, heldListener: true });
  await page.evaluate(() => { const state = (window as any).__incoming; state.connection = state.git.retryIncomingRepositoryLinks(); });
  await expect.poll(() => page.evaluate(() => (window as any).__incoming.listeners.length)).toBe(1);
  await page.evaluate(async () => { const state = (window as any).__incoming; state.app.ngOnDestroy(); state.finishListener(); await state.connection; state.emit(); });
  await expect.poll(() => page.evaluate(() => (window as any).__incoming.unlisteners)).toEqual([1]);
  expect(await calls(page, 'incoming_repository_links')).toHaveLength(0);
  expect(await page.evaluate(() => (window as any).__incoming.git.incomingRepositoryLinks().requests)).toEqual([]);
});

test('a stale queue snapshot cannot replace a later arrival', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => { const state = (window as any).__incoming; state.holdNextSnapshot = true; state.read = state.git.refreshIncomingRepositoryLinks(); });
  await expect.poll(() => page.evaluate(() => !!(window as any).__incoming.finishSnapshot)).toBe(true);
  await page.evaluate(next => { const state = (window as any).__incoming; state.queue.requests = [next]; state.emit(); }, request('incoming-owned-2', 'second'));
  await expect.poll(() => page.evaluate(() => (window as any).__incoming.git.incomingRepositoryLinks().requests[0]?.id)).toBe('incoming-owned-2');
  await page.evaluate(async () => { const state = (window as any).__incoming; state.finishSnapshot(); await state.read; });
  expect(await page.evaluate(() => (window as any).__incoming.git.incomingRepositoryLinks().requests[0]?.id)).toBe('incoming-owned-2');
});

test('startup holds review until all saved tabs finish restoration and never dispatches background fetch', async ({ page }) => {
  await prepare(page, { bootstrap: false });
  await page.evaluate(() => {
    const state = (window as any).__incoming;
    state.otherRepository = { ...state.repository, id: 'owned-restored-second', path: '/owned/saved-second', name: 'saved-second' };
    state.holdRestorePath = state.otherRepository.path;
    const workspace = state.git.activeWorkspace();
    state.git.workspaces.set([{ ...workspace, repositoryPaths: [state.repository.path, state.otherRepository.path], activeRepositoryPath: state.repository.path }]);
    state.initialization = state.git.initialize();
  });
  await expect.poll(() => page.evaluate(() => !!(window as any).__incoming.finishRestore)).toBe(true);
  await expect(page.getByRole('button', { name: 'Incoming repository links', exact: true })).toBeDisabled();
  await page.evaluate(async () => { const state = (window as any).__incoming; await state.app.runAutoFetchCycle(true); state.finishRestore(); await state.initialization; });
  await expect(page.getByRole('button', { name: 'Incoming repository links', exact: true })).toBeEnabled();
  expect(await calls(page, 'sync_repository')).toHaveLength(0);
  expect(await page.evaluate(() => (window as any).__incoming.git.repositories().map((repo: any) => repo.path))).toContain('/owned/saved-second');
});

test('verified opening acknowledges its original request and preserves saved unavailable paths', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => {
    const state = (window as any).__incoming;
    const workspace = state.git.activeWorkspace();
    state.git.workspaces.set([{ ...workspace, repositoryPaths: [state.repository.path, '/owned/saved-unavailable'], activeRepositoryPath: state.repository.path }]);
    state.app.commitMessage.set('Owned original draft retained');
  });
  const dialog = await openInbox(page);
  await dialog.getByRole('button', { name: 'Review local context…', exact: true }).click();
  await linkDialog(page).getByRole('button', { name: 'Find local copies', exact: true }).click();
  await linkDialog(page).getByRole('button', { name: 'Open this local copy', exact: true }).click();
  await expect(inbox(page).getByText('No queued repository links.', { exact: true })).toBeVisible();
  expect((await calls(page, 'acknowledge_incoming_repository_link'))[0].args.requestId).toBe('incoming-owned-1');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('git-khronos.open-repositories.v1')!));
  expect(saved).toContain('/owned/saved-unavailable'); expect(saved).toContain('/owned/incoming-context');
  await inbox(page).getByRole('button', { name: 'Close incoming links', exact: true }).click();
  const original = await page.evaluate(() => (window as any).__incoming.repository.id);
  await page.locator(`[data-repository-tab-id="${original}"]`).click();
  expect(await page.evaluate(() => (window as any).__incoming.app.commitMessage())).toBe('Owned original draft retained');
});

test('the command palette opens the inbox after its own dialog closes', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Command palette', exact: true }).click();
  await page.getByRole('combobox', { name: 'Search commands', exact: true }).fill('Incoming repository links');
  await page.getByRole('option', { name: /Incoming repository links/ }).click();
  await expect(inbox(page)).toBeVisible();
});

for (const width of [360, 780, 1440]) {
  test(`keeps inbox controls bounded and keyboard-contained at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 780 });
    await prepare(page);
    const dialog = await openInbox(page);
    await expect(dialog.getByRole('button', { name: 'Close incoming links', exact: true })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    const box = await dialog.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  });
}


test('editing a received link cannot consume its original queued request', async ({ page }) => {
  const second = request('incoming-owned-2', 'second');
  await prepare(page, { requests: [request(), second] });
  const dialog = await openInbox(page);
  await dialog.getByRole('button', { name: 'Review local context…', exact: true }).first().click();
  await linkDialog(page).getByRole('textbox', { name: 'Repository link', exact: true }).fill((second.payload as { uri: string }).uri);
  await linkDialog(page).getByRole('button', { name: 'Find local copies', exact: true }).click();
  await linkDialog(page).getByRole('button', { name: 'Open this local copy', exact: true }).click();
  await expect(linkDialog(page)).toHaveCount(0);
  expect(await calls(page, 'acknowledge_incoming_repository_link')).toHaveLength(0);
  await openInbox(page);
  await expect(inbox(page).getByRole('button', { name: 'Review local context…', exact: true })).toHaveCount(2);
});

test('a rejected native unlisten cannot prevent retry or revive an invalidated listener', async ({ page }) => {
  await prepare(page);
  await page.evaluate(async () => {
    const state = (window as any).__incoming;
    state.oldHandler = state.handlers.get('incoming-repository-links-changed');
    const invoke = (window as any).__TAURI_INTERNALS__.invoke;
    (window as any).__TAURI_INTERNALS__.invoke = (command: string, args: unknown) =>
      command === 'plugin:event|unlisten' ? Promise.reject(new Error('Owned unlisten failure')) : invoke(command, args);
    await state.git.retryIncomingRepositoryLinks();
    state.oldHandler({ payload: { pending: true } });
  });
  await openInbox(page);
  await expect(inbox(page).getByRole('button', { name: 'Review local context…', exact: true })).toHaveCount(1);
  await expect(inbox(page).getByRole('alert')).toHaveCount(0);
  const reads = (await calls(page, 'incoming_repository_links')).length;
  await page.evaluate(() => (window as any).__incoming.oldHandler({ payload: { pending: true } }));
  expect((await calls(page, 'incoming_repository_links')).length).toBe(reads);
});
