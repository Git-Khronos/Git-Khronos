import { computed, signal } from '@angular/core';

export type ActiveOverlay<T> = T & { readonly returnFocus: HTMLElement | null };

/** One owner per mutually exclusive region; modal and nested regions stay independent. */
export class OverlayController<T extends { kind: string }> {
  private readonly state = signal<ActiveOverlay<T> | null>(null);
  readonly activeOverlay = this.state.asReadonly();
  private revision = 0;

  isOpen(kind: T['kind']) {
    return computed(() => this.state()?.kind === kind);
  }

  open(overlay: T, returnFocus: HTMLElement | null = null): void {
    ++this.revision;
    this.state.set({ ...overlay, returnFocus });
  }

  toggle(overlay: T, returnFocus: HTMLElement | null = null): boolean {
    if (this.state()?.kind === overlay.kind) {
      this.close(overlay.kind);
      return false;
    }
    this.open(overlay, returnFocus);
    return true;
  }

  close(kind: T['kind'], restoreFocus = false): void {
    if (this.state()?.kind === kind) this.closeAll(restoreFocus);
  }

  closeAll(restoreFocus = false): void {
    const target = this.state()?.returnFocus;
    const revision = ++this.revision;
    this.state.set(null);
    if (restoreFocus) queueMicrotask(() => {
      if (revision === this.revision && target?.isConnected && !target.closest('[inert]')) target.focus();
    });
  }
}
