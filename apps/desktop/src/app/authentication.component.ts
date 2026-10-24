import {
  ChangeDetectionStrategy, Component, ElementRef, OnDestroy, afterRenderEffect,
  computed, inject, signal, viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ipc, events, type GitAuthenticationPrompt as AuthenticationPrompt } from '@git-khronos/contracts';
import { type UnlistenFn } from '@tauri-apps/api/event';
import { GitKhronosService } from './git-khronos.service';

@Component({
  selector: 'gc-authentication',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dialog [attr.aria-labelledby]="prompt() ? 'authentication-title' : null" [attr.aria-describedby]="prompt() ? 'authentication-help' : null"
      (cancel)="cancel($event)">
      @if (prompt(); as request) {
        <form (ngSubmit)="answer(value())">
          <h2 id="authentication-title">Git authentication</h2>
          <p>{{ operationName() }} · {{ repositoryName() }}</p>
          <p id="authentication-help">Git requested a credential. Saved credentials remain managed by your
            configured Git credential helper or SSH agent, not Git Khronos.</p>
          <p class="hint">Cancel stops this operation. Git may already have made partial changes;
            repository state is refreshed after cancellation.</p>
          <label for="authentication-value">{{ request.secret ? 'Password or key passphrase' : 'Username' }}</label>
          <input #credential id="authentication-value" name="credential"
            [type]="request.secret ? 'password' : 'text'"
            [attr.autocomplete]="request.secret ? 'current-password' : 'username'"
            [ngModel]="value()" (ngModelChange)="value.set($event)"
            [disabled]="sending()" spellcheck="false" autocapitalize="off" />
          @if (error()) { <p role="alert">{{ error() }}</p> }
          <div class="actions">
            <button type="button" (click)="answer(null)" [disabled]="sending()">Cancel operation</button>
            <button type="submit" [disabled]="sending()">{{ sending() ? 'Sending…' : 'Continue' }}</button>
          </div>
        </form>
      }
    </dialog>
  `,
  styles: `
    dialog { color: var(--text); background: var(--panel);
      border: 1px solid var(--border); border-radius: 12px;
      width: min(440px, calc(100vw - 48px)); padding: 24px; }
    dialog::backdrop { background: rgb(0 0 0 / 65%); }
    h2 { margin-top: 0; font-size: 20px; }
    p { line-height: 1.5; overflow-wrap: anywhere; }
    label { display: block; margin-bottom: 8px; }
    input { box-sizing: border-box; width: 100%; color: inherit; background: transparent;
      padding: 10px; border: 1px solid var(--border); border-radius: 6px; }
    .actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px; }
    button { color: inherit; background: var(--surface-raised); border: 1px solid var(--border);
      border-radius: 6px; padding: 10px 12px; cursor: pointer; }
    :is(input, button):focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
    button:disabled { opacity: .5; cursor: default; }
  `,
})
export class AuthenticationComponent implements OnDestroy {
  private readonly git = inject(GitKhronosService);
  private readonly requests = signal<AuthenticationPrompt[]>([]);
  readonly prompt = computed(() => this.requests()[0] ?? null);
  readonly repositoryName = computed(() => {
    const id = this.prompt()?.repositoryId;
    return this.git.repositories().find((repository) => repository.id === id)?.name ?? 'Repository operation';
  });
  readonly operationName = computed(() => {
    const id = this.prompt()?.operationId;
    return this.git.activityLogs().find((entry) => entry.operationId === id)?.description
      ?? 'Git operation';
  });
  readonly sending = signal(false);
  readonly error = signal<string | null>(null);
  readonly value = signal('');
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dialog');
  private readonly credential = viewChild<ElementRef<HTMLInputElement>>('credential');
  private activeRequestId: string | null = null;
  private unlisteners: UnlistenFn[] = [];
  private readonly dismissed = new Set<string>();
  private destroyed = false;
  private connecting = false;
  private answeringRequestId: string | null = null;

  constructor() {
    afterRenderEffect(() => {
      const prompt = this.prompt();
      const dialog = this.dialog()?.nativeElement;
      if (!dialog) return;
      if (!prompt) {
        this.value.set('');
        this.activeRequestId = null;
        this.answeringRequestId = null;
        this.sending.set(false);
        this.error.set(null);
        if (dialog.open) dialog.close();
      } else if (prompt.requestId !== this.activeRequestId) {
        this.activeRequestId = prompt.requestId;
        this.answeringRequestId = null;
        this.value.set('');
        this.error.set(null);
        this.sending.set(false);
        if (!dialog.open) dialog.showModal();
        this.credential()?.nativeElement.focus();
      }
    });
    if ('__TAURI_INTERNALS__' in window) void this.connect();
  }

  receive(prompt: AuthenticationPrompt): void {
    if (this.destroyed || this.dismissed.has(prompt.requestId)) return;
    this.requests.update((requests) => requests.some((item) => item.requestId === prompt.requestId)
      ? requests : [...requests, prompt]);
  }

  dismiss(requestId: string): void {
    if (this.destroyed) return;
    this.dismissed.add(requestId);
    if (this.dismissed.size > 256) this.dismissed.delete(this.dismissed.values().next().value!);
    this.requests.update((requests) => requests.filter((request) => request.requestId !== requestId));
  }

  private async connect(): Promise<void> {
    if (this.destroyed || this.connecting || this.unlisteners.length) return;
    this.connecting = true;
    try {
      try {
        if (!await this.ownListener(events.gitAuthenticationPrompt.listen(
          (event) => this.receive(event.payload)))) return;
        if (!await this.ownListener(events.gitAuthenticationDismissed.listen(
          (event) => this.dismiss(event.payload)))) return;
      } catch {
        this.releaseListeners();
        return;
      }
      try {
        for (const prompt of await ipc.pending_authentication()) this.receive(prompt);
      } catch {
        // A failed initial snapshot must not disable working event listeners.
        // Native requests still time out safely if delivery is unavailable.
      }
    } finally {
      this.connecting = false;
    }
  }

  private async ownListener(listener: Promise<UnlistenFn>): Promise<boolean> {
    const unlisten = await listener;
    if (this.destroyed) {
      this.stopListening(unlisten);
      return false;
    }
    this.unlisteners.push(unlisten);
    return true;
  }

  private stopListening(unlisten: UnlistenFn): void {
    try { void Promise.resolve(unlisten()).catch(() => undefined); } catch {
      // One teardown failure must not prevent releasing the other listeners.
    }
  }

  private releaseListeners(): void {
    for (const unlisten of this.unlisteners.splice(0)) this.stopListening(unlisten);
  }

  async answer(answer: string | null): Promise<void> {
    const prompt = this.prompt();
    if (this.destroyed || !prompt || this.sending()) return;
    this.answeringRequestId = prompt.requestId;
    this.sending.set(true);
    this.error.set(null);
    this.value.set('');
    try {
      await ipc.answer_authentication({ requestId: prompt.requestId, answer });
      if (!this.destroyed) this.dismiss(prompt.requestId);
    } catch {
      if (!this.destroyed && this.answeringRequestId === prompt.requestId
        && this.prompt()?.requestId === prompt.requestId) {
        if (answer === null) {
          this.dismiss(prompt.requestId);
          this.git.error.set('Git Khronos could not confirm cancellation of the authentication request. The Git operation may still be running; check its status before retrying.');
        } else {
          this.error.set('The request expired or could not be answered. Cancel and retry the Git operation.');
        }
      }
    } finally {
      if (this.answeringRequestId === prompt.requestId) {
        this.answeringRequestId = null;
        this.sending.set(false);
      }
    }
  }

  cancel(event: Event): void {
    event.preventDefault();
    void this.answer(null);
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.value.set('');
    this.error.set(null);
    this.sending.set(false);
    this.answeringRequestId = null;
    this.releaseListeners();
    this.requests.set([]);
  }
}
