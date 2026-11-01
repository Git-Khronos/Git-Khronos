import { InjectionToken, signal } from '@angular/core';
import { ipc, type ToolProfile } from '@git-khronos/contracts';

export const TOOL_PROFILES_STORAGE_KEY = 'git-khronos.tools.v1';
interface StoredProfiles { version: 1; profiles: ToolProfile[]; defaultTerminalId: string | null }
const EMPTY: StoredProfiles = { version: 1, profiles: [], defaultTerminalId: null };

/** Storage is data only. Loading or changing a default never launches a program. */
export function decodeToolProfiles(raw: string | null): StoredProfiles {
  if (raw === null) return structuredClone(EMPTY);
  if (raw.length > 131072) throw new Error('Stored tool profiles exceed the size limit.');
  const data = JSON.parse(raw);
  if (!data || data.version !== 1 || !Array.isArray(data.profiles) || data.profiles.length > 16
    || Object.keys(data).some((key) => !['version', 'profiles', 'defaultTerminalId'].includes(key))) {
    throw new Error('Stored tool profiles have an unsupported format.');
  }
  const ids = new Set<string>();
  for (const p of data.profiles) {
    if (!p || p.version !== 1 || typeof p.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(p.id)
      || ids.has(p.id) || !['terminal', 'agent'].includes(p.role)
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
  if (data.defaultTerminalId !== null && (typeof data.defaultTerminalId !== 'string'
    || !data.profiles.some((p: ToolProfile) => p.id === data.defaultTerminalId && p.role === 'terminal'))) {
    throw new Error('The default terminal profile is missing.');
  }
  return data;
}

export class ConfiguredToolsService {
  private readonly state = signal<StoredProfiles>(structuredClone(EMPTY));
  readonly storageError = signal<string | null>(null);
  readonly profiles = () => this.state().profiles;
  readonly defaultTerminal = () => this.state().profiles.find((p) => p.id === this.state().defaultTerminalId) ?? null;

  constructor() {
    try { this.state.set(decodeToolProfiles(localStorage.getItem(TOOL_PROFILES_STORAGE_KEY))); }
    catch { this.storageError.set('Stored tool profiles could not be read. They have been preserved. Clear them explicitly to start again.'); }
  }

  async save(profile: ToolProfile, makeDefault: boolean): Promise<void> {
    const snapshot = structuredClone(profile);
    await ipc.validate_tool_profile({ profile: snapshot });
    // Merge against current state after native validation, never an old snapshot.
    const current = this.state();
    const profiles = current.profiles.filter((p) => p.id !== snapshot.id).concat(snapshot);
    const defaultTerminalId = makeDefault && snapshot.role === 'terminal' ? snapshot.id
      : current.defaultTerminalId === snapshot.id ? null : current.defaultTerminalId;
    this.persist({ version: 1, profiles, defaultTerminalId });
  }

  remove(id: string): void {
    const current = this.state();
    this.persist({ version: 1, profiles: current.profiles.filter((p) => p.id !== id),
      defaultTerminalId: current.defaultTerminalId === id ? null : current.defaultTerminalId });
  }

  useSystemTerminal(): void { this.persist({ ...this.state(), defaultTerminalId: null }); }

  clearUnreadableStorage(): void {
    localStorage.removeItem(TOOL_PROFILES_STORAGE_KEY);
    this.state.set(structuredClone(EMPTY));
    this.storageError.set(null);
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
