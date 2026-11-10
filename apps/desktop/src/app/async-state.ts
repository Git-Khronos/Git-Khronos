import { computed, signal } from '@angular/core';

export type AsyncState<T> =
  | { kind: 'idle' }
  | { kind: 'loading'; previous: T; error: string | null }
  | { kind: 'ready'; value: T }
  | { kind: 'error'; previous: T; message: string };

/** Request ownership is separate from listener lifetime and accepted write receipts. */
export class AsyncStateController<T> {
  private readonly current = signal<AsyncState<T>>({ kind: 'idle' });
  private generation = 0;
  readonly state = this.current.asReadonly();
  readonly value = computed(() => {
    const state = this.current();
    switch (state.kind) {
      case 'idle': return this.initial;
      case 'ready': return state.value;
      case 'loading':
      case 'error': return state.previous;
    }
  });
  readonly loading = computed(() => this.current().kind === 'loading');
  readonly error = computed(() => {
    const state = this.current();
    return state.kind === 'error' ? state.message : state.kind === 'loading' ? state.error : null;
  });

  constructor(private readonly initial: T) {}

  begin(showLoading = true): number {
    const request = ++this.generation;
    if (showLoading) this.current.set({ kind: 'loading', previous: this.value(), error: this.error() });
    return request;
  }

  isCurrent(request: number): boolean { return request === this.generation; }

  /** Publish accepted content while dependent hydration may still be running. */
  publish(request: number, value: T): boolean {
    if (!this.isCurrent(request)) return false;
    this.current.set(this.loading()
      ? { kind: 'loading', previous: value, error: null }
      : { kind: 'ready', value });
    return true;
  }

  resolve(request: number, value: T): boolean {
    if (!this.isCurrent(request)) return false;
    this.current.set({ kind: 'ready', value });
    return true;
  }

  fail(request: number, message: string): boolean {
    if (!this.isCurrent(request)) return false;
    this.current.set({ kind: 'error', previous: this.value(), message });
    return true;
  }

  /** Apply a confirmed external change without settling a concurrent read. */
  updateValue(update: (value: T) => T): void {
    const value = update(this.value());
    const state = this.current();
    switch (state.kind) {
      case 'idle':
      case 'ready': this.current.set({ kind: 'ready', value }); break;
      case 'loading':
      case 'error': this.current.set({ ...state, previous: value }); break;
    }
  }

  finish(request: number): void {
    if (!this.isCurrent(request) || !this.loading()) return;
    const error = this.error();
    if (error) this.fail(request, error);
    else this.resolve(request, this.value());
  }

  invalidate(): void {
    this.finish(this.generation);
    ++this.generation;
  }

  reset(): void {
    ++this.generation;
    this.current.set({ kind: 'idle' });
  }
}
