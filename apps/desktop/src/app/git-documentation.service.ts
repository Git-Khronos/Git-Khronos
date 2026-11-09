import { Injectable, signal } from '@angular/core';

export type GitDocumentationTopic =
  | 'repository' | 'stage' | 'diff' | 'commit' | 'signing' | 'branch' | 'checkout'
  | 'fetch' | 'pull' | 'push' | 'remote' | 'tag' | 'stash' | 'merge' | 'rebase'
  | 'cherry-pick' | 'revert' | 'reset' | 'split' | 'merge-rebase' | 'discard' | 'reflog' | 'history' | 'blame'
  | 'worktree' | 'submodule' | 'sparse' | 'lfs' | 'lfs-fetch' | 'lfs-checkout' | 'lfs-locks'
  | 'lfs-prune' | 'attributes' | 'authentication' | 'bisect' | 'ignore' | 'maintenance' | 'patch' | 'bundle' | 'mail-patch';

@Injectable({ providedIn: 'root' })
export class GitDocumentationService {
  readonly request = signal<{ topic: GitDocumentationTopic | null; returnFocus: HTMLElement | null } | null>(null);

  open(topic: GitDocumentationTopic | null, returnFocus: HTMLElement | null): void {
    this.request.set({ topic, returnFocus });
  }

  close(): void {
    const opener = this.request()?.returnFocus;
    this.request.set(null);
    setTimeout(() => {
      if (opener?.isConnected && opener.getClientRects().length) opener.focus();
    });
  }
}
