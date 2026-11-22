import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, inject, input, output } from '@angular/core';
import type { Branch, RepositorySnapshot } from '@git-khronos/contracts';
import { IconComponent, type IconName } from './icon.component';
import { PULL_STRATEGY_CHOICES, PULL_STRATEGY_LABEL, type PullStrategy } from './pull-strategy';

export type ToolbarOptionsKind = 'fetch' | 'pull' | 'push' | 'branch' | 'stash' | 'lfs' | 'sparseCheckout';

interface MenuIdentity {
  /** Opaque root-owned lease, stable across presentation updates. */
  readonly visit: object;
  readonly id: string;
  readonly className: string;
  readonly label: string;
  readonly busy: boolean;
}

interface RemoteTarget {
  readonly remote: string | null;
  readonly branch: string | null;
  readonly icon: IconName;
  readonly upstream: boolean;
}

export type ToolbarOptionsView = MenuIdentity & (
  | { readonly kind: 'fetch'; readonly remoteCount: number; readonly detail: string; readonly disabled: boolean }
  | { readonly kind: 'pull'; readonly destination: RemoteTarget; readonly behind: number; readonly strategy: PullStrategy; readonly hasSubmodules: boolean }
  | { readonly kind: 'push'; readonly destination: RemoteTarget; readonly ahead: number; readonly hasUpstream: boolean; readonly summary: string }
  | { readonly kind: 'branch'; readonly branchName: string | null; readonly head: string; readonly headState: string; readonly branches: readonly Branch[]; readonly previousAvailable: boolean }
  | { readonly kind: 'stash'; readonly head: string; readonly changeCount: number }
  | { readonly kind: 'lfs'; readonly lfs: RepositorySnapshot['lfs'] }
  | { readonly kind: 'sparseCheckout'; readonly sparse: RepositorySnapshot['sparseCheckout'] }
);

export type ToolbarOptionsAction =
  | 'fetchAll' | 'fetchOptions' | 'push' | 'forcePush' | 'createBranch' | 'integrate' | 'previousBranch'
  | 'stashAll' | 'stashOptions' | 'pullLfs' | 'pruneLfs' | 'editSparse' | 'reapplySparse' | 'disableSparse'
  | { readonly kind: 'pull' | 'defaultPull'; readonly strategy: PullStrategy }
  | { readonly kind: 'checkout'; readonly branch: Branch };

/** Stateless menu presentation; the app retains checkout ownership and Git dispatch. */
@Component({
  selector: 'div[gcToolbarOptions]',
  imports: [IconComponent],
  templateUrl: './toolbar-options.component.html',
  styleUrl: './toolbar-options.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToolbarOptionsComponent {
  readonly view = input.required<ToolbarOptionsView>();
  readonly activate = output<ToolbarOptionsAction>();
  readonly ready = output<HTMLElement>();
  protected readonly choices = PULL_STRATEGY_CHOICES;
  protected readonly strategyLabel = PULL_STRATEGY_LABEL;

  constructor() {
    const host = inject(ElementRef<HTMLElement>).nativeElement;
    afterNextRender(() => this.ready.emit(host));
  }
}
