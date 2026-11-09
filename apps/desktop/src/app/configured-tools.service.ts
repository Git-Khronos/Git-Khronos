import { InjectionToken, signal } from '@angular/core';
import { ipc, type ToolProfile } from '@git-khronos/contracts';

export const TOOL_PROFILES_STORAGE_KEY = 'git-khronos.tools.v1';
interface StoredProfiles {
  version: 2;
  profiles: ToolProfile[];
  defaultTerminalId: string | null;
  defaultEditorId: string | null;
  defaultDiffId: string | null;
  defaultMergeId: string | null;
}
type StoredToolProfile = Omit<ToolProfile, 'role'> & { role: ToolProfile['role'] | 'agent' };
type LegacyStoredProfiles = Omit<StoredProfiles, 'profiles'> & { profiles: StoredToolProfile[] };
interface DecodedProfiles { value: StoredProfiles; migratedAgentProfiles: boolean }
const DEFAULTS = { terminal: 'defaultTerminalId', editor: 'defaultEditorId', diff: 'defaultDiffId', merge: 'defaultMergeId' } as const;
const DEFAULT_ROLES = ['terminal', 'editor', 'diff', 'merge'] as const;
const EMPTY: StoredProfiles = { version: 2, profiles: [], defaultTerminalId: null, defaultEditorId: null, defaultDiffId: null, defaultMergeId: null };

/** Storage is data only. Loading or changing a default never launches a program. */
export function decodeToolProfiles(raw: string | null): StoredProfiles {
  return readToolProfiles(raw).value;
}

function readToolProfiles(raw: string | null): DecodedProfiles {
  if (raw === null) return { value: structuredClone(EMPTY), migratedAgentProfiles: false };
  if (raw.length > 131072) throw new Error('Stored tool profiles exceed the size limit.');
  const data = JSON.parse(raw);
  const legacy = data?.version === 1;
  const keys = legacy ? ['version', 'profiles', 'defaultTerminalId']
    : ['version', 'profiles', ...Object.values(DEFAULTS)];
  if (!data || ![1, 2].includes(data.version) || !Array.isArray(data.profiles) || data.profiles.length > 16
    || Object.keys(data).some((key) => !keys.includes(key))) {
    throw new Error('Stored tool profiles have an unsupported format.');
  }
  const ids = new Set<string>();
  for (const p of data.profiles) {
    if (!p || p.version !== 1 || typeof p.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(p.id)
      || ids.has(p.id) || !(legacy ? ['terminal', 'agent'] : ['terminal', 'agent', 'editor', 'diff', 'merge']).includes(p.role)
      || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 128
      || typeof p.executable !== 'string' || !p.executable || p.executable.length > 16384
      || !Array.isArray(p.arguments) || p.arguments.length > 32
      || p.arguments.some((value: unknown) => typeof value !== 'string' || value.length > 16384 || value.includes('\0'))
      || p.arguments.reduce((sum: number, value: string) => sum + value.length, 0) > 65536
      || Object.keys(p).some((key) => !['version', 'id', 'name', 'role', 'executable', 'arguments'].includes(key))) {
      throw new Error('A stored tool profile is invalid.');
    }
    ids.add(p.id);
  }
  const restored: LegacyStoredProfiles = legacy ? { ...structuredClone(EMPTY), profiles: data.profiles, defaultTerminalId: data.defaultTerminalId } : data;
  for (const role of DEFAULT_ROLES) {
    const id = restored[DEFAULTS[role]];
    if (id !== null && (typeof id !== 'string' || !restored.profiles.some((p) => p.id === id && p.role === role))) {
      throw new Error('A default program profile is missing or has another role.');
    }
  }
  const migratedAgentProfiles = restored.profiles.some((profile) => profile.role === 'agent');
  const profiles: ToolProfile[] = restored.profiles.map((profile) => ({
    ...profile,
    role: profile.role === 'agent' ? 'terminal' : profile.role,
  }));
  return { value: { ...restored, profiles }, migratedAgentProfiles };
}

export class ConfiguredToolsService {
  private readonly state = signal<StoredProfiles>(structuredClone(EMPTY));
  readonly storageError = signal<string | null>(null);
  readonly legacyProfilesMigrated = signal(false);
  readonly profiles = () => this.state().profiles;
  readonly defaultTerminal = () => this.defaultFor('terminal');
  readonly defaultFor = (role: ToolProfile['role']) =>
    this.state().profiles.find((p) => p.id === this.state()[DEFAULTS[role]] && p.role === role) ?? null;

  constructor() {
    try {
      const decoded = readToolProfiles(localStorage.getItem(TOOL_PROFILES_STORAGE_KEY));
      this.state.set(decoded.value);
      this.legacyProfilesMigrated.set(decoded.migratedAgentProfiles);
    }
    catch { this.storageError.set('Stored tool profiles could not be read. They have been preserved. Clear them explicitly to start again.'); }
  }

  async save(profile: ToolProfile, makeDefault: boolean): Promise<void> {
    const snapshot = structuredClone(profile);
    await ipc.validate_tool_profile({ profile: snapshot });
    // Merge against current state after native validation, never an old snapshot.
    const current = this.state();
    const profiles = current.profiles.filter((p) => p.id !== snapshot.id).concat(snapshot);
    const next: StoredProfiles = { ...current, profiles };
    for (const role of DEFAULT_ROLES) {
      const key = DEFAULTS[role];
      next[key] = makeDefault && snapshot.role === role ? snapshot.id
        : current[key] === snapshot.id ? null : current[key];
    }
    this.persist(next);
  }

  remove(id: string): void {
    const current = this.state();
    const next: StoredProfiles = { ...current, profiles: current.profiles.filter((p) => p.id !== id) };
    for (const role of DEFAULT_ROLES) if (next[DEFAULTS[role]] === id) next[DEFAULTS[role]] = null;
    this.persist(next);
  }

  useSystemTerminal(): void { this.persist({ ...this.state(), defaultTerminalId: null }); }

  clearUnreadableStorage(): void {
    localStorage.removeItem(TOOL_PROFILES_STORAGE_KEY);
    this.state.set(structuredClone(EMPTY));
    this.storageError.set(null);
    this.legacyProfilesMigrated.set(false);
  }

  private persist(value: StoredProfiles): void {
    if (this.storageError()) throw new Error('Clear the unreadable tool profiles before saving replacements.');
    const encoded = JSON.stringify(value);
    const checked = decodeToolProfiles(encoded);
    // A failed write must leave both the live preferences and stored value alone.
    localStorage.setItem(TOOL_PROFILES_STORAGE_KEY, encoded);
    this.state.set(checked);
  }
}

export const CONFIGURED_TOOLS = new InjectionToken<ConfiguredToolsService>('Configured tools', {
  providedIn: 'root', factory: () => new ConfiguredToolsService(),
});
