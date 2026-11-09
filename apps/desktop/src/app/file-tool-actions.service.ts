import { Injectable, signal } from '@angular/core';

interface PendingToolAction {
  id: string;
  description: string;
}

interface UncertainToolAction {
  id: string;
  guidance: string;
}

@Injectable({ providedIn: 'root' })
export class FileToolActionsService {
  readonly pending = signal<PendingToolAction | null>(null);
  readonly uncertain = signal<UncertainToolAction | null>(null);

  begin(action: PendingToolAction): boolean {
    if (this.pending() || this.uncertain()) return false;
    this.pending.set(action);
    return true;
  }

  finish(id: string): void {
    if (this.pending()?.id === id) this.pending.set(null);
  }

  requireInspection(action: UncertainToolAction): void {
    this.uncertain.set(action);
  }

  acknowledge(): void {
    if (!this.pending()) this.uncertain.set(null);
  }
}
