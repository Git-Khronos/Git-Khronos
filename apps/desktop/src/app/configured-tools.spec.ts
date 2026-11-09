import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolProfile } from '@git-khronos/contracts';
const validate = vi.hoisted(() => vi.fn());
vi.mock('@git-khronos/contracts', () => ({ ipc: { validate_tool_profile: validate } }));
import { ConfiguredToolsService, decodeToolProfiles, TOOL_PROFILES_STORAGE_KEY } from './configured-tools.service';

const profile = (id = 'owned'): ToolProfile => ({ version: 1, id, name: 'Owned program', role: 'terminal', executable: '/owned/program', arguments: ['', '{repository}', "literal 'quoted';$(text)"] });
let values: Map<string, string>;
let storage: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn>; removeItem: ReturnType<typeof vi.fn> };
beforeEach(() => {
  values = new Map();
  storage = { getItem: vi.fn((key: string) => values.get(key) ?? null), setItem: vi.fn((key: string, value: string) => { values.set(key, value); }), removeItem: vi.fn((key: string) => { values.delete(key); }) };
  vi.stubGlobal('localStorage', storage); validate.mockReset(); validate.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());

describe('configured program preference transactions', () => {
  it('stores literal argument boundaries and restores defaults without starting any program', async () => {
    const service = new ConfiguredToolsService();
    await service.save(profile(), true);
    const restored = new ConfiguredToolsService();
    expect(restored.defaultTerminal()).toEqual(profile());
    expect(validate).toHaveBeenCalledExactlyOnceWith({ profile: profile() });
    expect(restored.profiles()[0].arguments).toEqual(['', '{repository}', "literal 'quoted';$(text)"]);
  });
  it('preserves a corrupt stored value until an explicit clear, including failed clears', async () => {
    values.set(TOOL_PROFILES_STORAGE_KEY, '{owned malformed');
    const service = new ConfiguredToolsService();
    expect(service.storageError()).toBeTruthy();
    await expect(service.save(profile(), true)).rejects.toThrow('unreadable');
    expect(values.get(TOOL_PROFILES_STORAGE_KEY)).toBe('{owned malformed');
    storage.removeItem.mockImplementationOnce(() => { throw new Error('Read only'); });
    expect(() => service.clearUnreadableStorage()).toThrow('Read only');
    expect(service.storageError()).toBeTruthy();
    service.clearUnreadableStorage();
    await service.save(profile(), true);
    expect(service.defaultTerminal()?.id).toBe('owned');
  });
  it('keeps live and persisted preferences unchanged when validation or storage fails', async () => {
    const service = new ConfiguredToolsService(); await service.save(profile(), true);
    const original = values.get(TOOL_PROFILES_STORAGE_KEY);
    validate.mockRejectedValueOnce({ message: 'Missing required argument' });
    await expect(service.save(profile('rejected'), true)).rejects.toEqual({ message: 'Missing required argument' });
    storage.setItem.mockImplementationOnce(() => { throw new Error('Storage full'); });
    await expect(service.save(profile('not-stored'), true)).rejects.toThrow('Storage full');
    expect(service.profiles()).toEqual([profile()]); expect(service.defaultTerminal()?.id).toBe('owned');
    expect(values.get(TOOL_PROFILES_STORAGE_KEY)).toBe(original);
  });
  it('captures the submitted profile and merges concurrent validated saves against current state', async () => {
    const service = new ConfiguredToolsService();
    let finish!: () => void;
    validate.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const submitted = profile('first'); const pending = service.save(submitted, true);
    submitted.executable = '/changed-after-submit'; submitted.arguments.push('changed');
    await service.save(profile('second'), false); finish(); await pending;
    expect(service.profiles().map(p => p.id)).toEqual(['second', 'first']);
    expect(service.defaultTerminal()).toEqual(profile('first'));
  });
  it('removes a deleted default while preserving other profiles and never launches sessions', async () => {
    const service = new ConfiguredToolsService(); await service.save(profile(), true); await service.save(profile('other'), false);
    service.remove('owned'); expect(service.defaultTerminal()).toBeNull(); expect(service.profiles()).toEqual([profile('other')]);
    await service.save(profile('other'), true); service.useSystemTerminal(); expect(service.defaultTerminal()).toBeNull();
  });
  it('refuses unsupported versions, duplicate IDs, dangling defaults, extra fields and excessive data', () => {
    const good = { version: 1, profiles: [profile()], defaultTerminalId: 'owned' };
    for (const invalid of [
      { ...good, version: 2 }, { ...good, profiles: [profile(), profile()] },
      { ...good, defaultTerminalId: 'missing' }, { ...good, extra: true },
      { ...good, profiles: [{ ...profile(), extra: true }] },
      { ...good, profiles: [{ ...profile(), role: 'editor' }] },
      { ...good, profiles: [{ ...profile(), arguments: ['bad\0arg'] }] },
      { ...good, profiles: [{ ...profile(), arguments: Array(33).fill('') }] },
    ]) expect(() => decodeToolProfiles(JSON.stringify(invalid))).toThrow();
    expect(() => decodeToolProfiles(' '.repeat(131073))).toThrow('size');
  });
});

describe('version two file program preferences', () => {
  const fileProfile = (role: 'editor' | 'diff' | 'merge', id = role): ToolProfile => ({
    version: 1, id, name: `Owned ${role}`, role, executable: '/owned/file program',
    arguments: role === 'editor' ? ['{file}', '{line}'] : role === 'diff' ? ['{before}', '{after}'] : ['{base}', '{before}', '{after}', '{merged}'],
  });
  it('reads legacy data without writing or launching, then preserves every profile on the first explicit version two save', async () => {
    const terminal = profile(), agent = { ...profile('agent'), role: 'agent' as const };
    const migrated = { ...agent, role: 'terminal' as const };
    const raw = JSON.stringify({ version: 1, profiles: [terminal, agent], defaultTerminalId: terminal.id });
    values.set(TOOL_PROFILES_STORAGE_KEY, raw);
    const service = new ConfiguredToolsService();
    expect(service.profiles()).toEqual([terminal, migrated]); expect(service.defaultTerminal()).toEqual(terminal);
    expect(service.legacyProfilesMigrated()).toBe(true);
    expect(service.defaultFor('editor')).toBeNull(); expect(storage.setItem).not.toHaveBeenCalled(); expect(validate).not.toHaveBeenCalled();
    expect(values.get(TOOL_PROFILES_STORAGE_KEY)).toBe(raw);
    await service.save(fileProfile('editor'), true);
    const stored = JSON.parse(values.get(TOOL_PROFILES_STORAGE_KEY)!);
    expect(stored.version).toBe(2); expect(stored.profiles).toEqual([terminal, migrated, fileProfile('editor')]);
    const restored = new ConfiguredToolsService(); expect(restored.defaultTerminal()).toEqual(terminal); expect(restored.defaultFor('editor')).toEqual(fileProfile('editor')); expect(restored.legacyProfilesMigrated()).toBe(false);
  });
  it('migrates version two legacy profiles without changing defaults or stored bytes until a successful explicit edit', async () => {
    const agent = { ...profile('old'), role: 'agent' as const };
    const raw = JSON.stringify({ version: 2, profiles: [agent, fileProfile('editor')], defaultTerminalId: null, defaultEditorId: 'editor', defaultDiffId: null, defaultMergeId: null });
    values.set(TOOL_PROFILES_STORAGE_KEY, raw);
    const service = new ConfiguredToolsService();
    expect(service.profiles()).toEqual([{ ...agent, role: 'terminal' }, fileProfile('editor')]);
    expect(service.defaultTerminal()).toBeNull(); expect(service.defaultFor('editor')).toEqual(fileProfile('editor'));
    expect(service.legacyProfilesMigrated()).toBe(true);
    expect(storage.setItem).not.toHaveBeenCalled(); expect(validate).not.toHaveBeenCalled();
    storage.setItem.mockImplementationOnce(() => { throw new Error('Storage full'); });
    await expect(service.save(fileProfile('merge'), true)).rejects.toThrow('Storage full');
    expect(values.get(TOOL_PROFILES_STORAGE_KEY)).toBe(raw);
    expect(service.profiles()).toEqual([{ ...agent, role: 'terminal' }, fileProfile('editor')]);
    await service.save(fileProfile('merge'), true);
    const stored = JSON.parse(values.get(TOOL_PROFILES_STORAGE_KEY)!);
    expect(stored.profiles[0]).toEqual({ ...agent, role: 'terminal' }); expect(stored.defaultTerminalId).toBeNull();
  });
  it('rejects a legacy agent as a terminal default before converting it', () => {
    const raw = JSON.stringify({ version: 2, profiles: [{ ...profile('old'), role: 'agent' }], defaultTerminalId: 'old', defaultEditorId: null, defaultDiffId: null, defaultMergeId: null });
    values.set(TOOL_PROFILES_STORAGE_KEY, raw);
    const service = new ConfiguredToolsService();
    expect(service.storageError()).toBeTruthy(); expect(service.profiles()).toEqual([]);
    expect(values.get(TOOL_PROFILES_STORAGE_KEY)).toBe(raw); expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('keeps defaults role-bound and independent across profile edits, deletion and terminal fallback', async () => {
    const service = new ConfiguredToolsService(); await service.save(profile(), true);
    for (const role of ['editor', 'diff', 'merge'] as const) await service.save(fileProfile(role), true);
    expect(service.defaultFor('editor')).toEqual(fileProfile('editor')); expect(service.defaultFor('diff')).toEqual(fileProfile('diff')); expect(service.defaultFor('merge')).toEqual(fileProfile('merge'));
    await service.save({ ...fileProfile('editor'), role: 'terminal', arguments: [] }, false);
    expect(service.defaultFor('editor')).toBeNull(); expect(service.defaultFor('diff')?.id).toBe('diff');
    service.remove('diff'); expect(service.defaultFor('diff')).toBeNull(); expect(service.defaultFor('merge')?.id).toBe('merge');
    service.useSystemTerminal(); expect(service.defaultTerminal()).toBeNull(); expect(service.defaultFor('merge')?.id).toBe('merge');
    const restored = new ConfiguredToolsService(); expect(restored.defaultFor('merge')).toEqual(fileProfile('merge')); expect(restored.defaultTerminal()).toBeNull();
  });
  it('preserves legacy storage and live data when an explicit migration write fails', async () => {
    const raw = JSON.stringify({ version: 1, profiles: [profile()], defaultTerminalId: 'owned' }); values.set(TOOL_PROFILES_STORAGE_KEY, raw);
    const service = new ConfiguredToolsService(); storage.setItem.mockImplementationOnce(() => { throw new Error('Storage full'); });
    await expect(service.save(fileProfile('merge'), true)).rejects.toThrow('Storage full');
    expect(values.get(TOOL_PROFILES_STORAGE_KEY)).toBe(raw); expect(service.profiles()).toEqual([profile()]); expect(service.defaultTerminal()).toEqual(profile()); expect(service.defaultFor('merge')).toBeNull();
  });
  it('preserves unknown versions and malformed file defaults until an explicit clear', () => {
    const good = { version: 2, profiles: [fileProfile('editor')], defaultTerminalId: null, defaultEditorId: 'editor', defaultDiffId: null, defaultMergeId: null };
    expect(decodeToolProfiles(JSON.stringify(good))).toEqual(good);
    for (const invalid of [{ ...good, version: 3 }, { ...good, defaultEditorId: 'missing' },
      { ...good, defaultTerminalId: 'editor' }, { ...good, defaultDiffId: 'editor' },
      { ...good, extra: true }, { ...good, profiles: [{ ...fileProfile('editor'), role: 'unknown' }] }]) {
      const raw = JSON.stringify(invalid); values.set(TOOL_PROFILES_STORAGE_KEY, raw);
      const service = new ConfiguredToolsService(); expect(service.storageError()).toBeTruthy(); expect(service.profiles()).toEqual([]); expect(values.get(TOOL_PROFILES_STORAGE_KEY)).toBe(raw);
    }
    expect(storage.setItem).not.toHaveBeenCalled(); expect(storage.removeItem).not.toHaveBeenCalled(); expect(validate).not.toHaveBeenCalled();
  });
});
