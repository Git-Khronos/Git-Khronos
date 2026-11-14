import { computed, Injectable, signal } from '@angular/core';
import { ipc, type AppError, type WindowsLauncherInspection, type WindowsShortcut } from '@git-khronos/contracts';

const STORAGE_KEY = 'git-khronos.windows-shortcut-acknowledgements';
type Acknowledgement = { path: string; fingerprint: string };

@Injectable({ providedIn: 'root' })
export class WindowsLauncherService {
  readonly inspection = signal<WindowsLauncherInspection | null>(null);
  readonly checking = signal(false);
  readonly error = signal<Partial<AppError> | null>(null);
  readonly storageError = signal('');
  private readonly acknowledgements = signal<Acknowledgement[]>([]);
  private started = false;
  private inFlight: Promise<void> | null = null;
  readonly status = computed(() => {
    if (this.checking() || !this.started) return 'Checking…';
    const data = this.inspection();
    if (!data?.supported || this.error()) return "Couldn't check";
    if (data.shortcuts.some(item => item.launch !== 'works')) return 'Needs attention';
    if (data.incomplete.length || !data.shortcuts.length) return "Couldn't check";
    if (!data.shortcuts.some(item => item.location === 'taskbarPin')) return 'No matching taskbar pin file found';
    return 'No launcher problems in checked files';
  });

  constructor() {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
      if (!Array.isArray(value) || !value.every(item => item && typeof item.path === 'string' && typeof item.fingerprint === 'string')) throw new Error('Invalid settings');
      this.acknowledgements.set(value);
    } catch {
      this.storageError.set('Shortcut acknowledgements could not be read. Existing settings have been preserved.');
    }
  }

  isAcknowledged(shortcut: WindowsShortcut): boolean {
    return !!shortcut.fingerprint && this.acknowledgements().some(item => item.path === shortcut.path && item.fingerprint === shortcut.fingerprint);
  }

  acknowledge(shortcut: WindowsShortcut, acknowledged: boolean): void {
    if (this.storageError() || !shortcut.fingerprint) return;
    const next = this.acknowledgements().filter(item => item.path !== shortcut.path);
    if (acknowledged) next.push({ path: shortcut.path, fingerprint: shortcut.fingerprint });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      this.acknowledgements.set(next);
    } catch {
      this.storageError.set('The shortcut acknowledgement could not be saved.');
    }
  }

  ensureChecked(): Promise<void> {
    return this.started ? this.inFlight ?? Promise.resolve() : this.refresh();
  }

  refresh(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.started = true;
    this.checking.set(true);
    const operation = (async () => {
      try {
        this.inspection.set(await Promise.resolve().then(() => ipc.inspect_windows_launcher()));
        this.error.set(null);
      } catch (error) {
        this.inspection.set(null);
        this.error.set(error && typeof error === 'object' ? error as Partial<AppError> : { message: 'The Windows shortcuts could not be checked.' });
      } finally {
        this.checking.set(false);
        this.inFlight = null;
      }
    })();
    this.inFlight = operation;
    return operation;
  }
}
