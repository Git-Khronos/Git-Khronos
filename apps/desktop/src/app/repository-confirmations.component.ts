import { ChangeDetectionStrategy, Component, effect, ElementRef, inject, input, output, viewChild } from '@angular/core';
import type { Remote } from '@git-khronos/contracts';
import { GitKhronosService } from './git-khronos.service';
import { IconComponent } from './icon.component';

export interface ForcePushReview {
  repositoryId: string;
  branchRef: string;
  branchName: string;
  remote: string;
  remoteBranch: string;
  expectedRemoteOid: string;
  expectedHeadOid: string;
}

export interface WorktreeRemovalReview {
  path: string;
  branch: string | null;
  deleteBranch: boolean;
  changes: number;
}

@Component({
  selector: 'gc-repository-confirmations',
  imports: [IconComponent],
  templateUrl: './repository-confirmations.component.html',
  styleUrl: './repository-confirmations.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepositoryConfirmationsComponent {
  protected readonly git = inject(GitKhronosService);
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
  readonly remote = input<Remote | null>(null);
  readonly sparseAction = input<'set' | 'disable' | null>(null);
  readonly sparsePathCount = input(0);
  readonly forcePush = input<ForcePushReview | null>(null);
  readonly worktree = input<WorktreeRemovalReview | null>(null);
  readonly forceWorktreeRemoval = input(false);
  readonly publishBranch = input<string | null>(null);
  readonly publishRemote = input('');
  readonly remoteClosed = output<void>();
  readonly remoteConfirmed = output<void>();
  readonly sparseClosed = output<void>();
  readonly sparseConfirmed = output<void>();
  readonly forcePushClosed = output<void>();
  readonly forcePushConfirmed = output<void>();
  readonly worktreeClosed = output<void>();
  readonly worktreeConfirmed = output<void>();
  readonly worktreeForceChanged = output<boolean>();
  readonly publishClosed = output<void>();
  readonly publishConfirmed = output<void>();
  readonly publishRemoteChanged = output<string>();
  readonly publishAddRemote = output<void>();

  constructor() {
    effect(() => {
      this.remote();
      this.sparseAction();
      this.forcePush();
      this.worktree();
      this.publishBranch();
      setTimeout(() => this.dialog()?.nativeElement.querySelector<HTMLButtonElement>('footer button')?.focus());
    });
  }

  protected close(): void {
    if (this.remote()) this.remoteClosed.emit();
    else if (this.sparseAction()) this.sparseClosed.emit();
    else if (this.worktree()) this.worktreeClosed.emit();
    else if (this.forcePush()) this.forcePushClosed.emit();
    else this.publishClosed.emit();
  }

  protected handleKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); return; }
    if (event.key !== 'Tab') return;
    const controls = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)')];
    if (!controls.length) return;
    const index = controls.indexOf(document.activeElement as HTMLElement);
    event.preventDefault();
    controls[event.shiftKey ? (index <= 0 ? controls.length - 1 : index - 1) : (index + 1) % controls.length].focus();
  }
}
