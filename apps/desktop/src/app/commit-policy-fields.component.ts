import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { CommitIdentity, CommitPolicy } from '@git-chronos/contracts';
import { GitHelpComponent } from './git-help.component';

@Component({
  selector: 'gc-commit-policy-fields',
  imports: [FormsModule, GitHelpComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="toggle"><input type="checkbox" name="signOffCommit" aria-describedby="commit-signoff-help"
      [disabled]="disabled()" [ngModel]="policy().signOff" (ngModelChange)="update({ signOff: $event })" /> Add Signed-off-by trailer</label>
    <p id="commit-signoff-help">Uses Git's committer identity. A sign-off is a project-specific contributor statement, not a cryptographic signature. Check your project's policy before selecting it.</p>
    <label class="toggle"><input type="checkbox" name="allowEmptyCommit" aria-describedby="commit-empty-help"
      [disabled]="disabled()" [ngModel]="policy().allowEmpty" (ngModelChange)="update({ allowEmpty: $event })" /> Allow commit without staged changes</label>
    <p id="commit-empty-help">Allows an unchanged tree. Staged contents are still included when present; unstaged edits are not staged automatically. A nonempty message and successful hooks are still required.</p>
    <p>Skip checks bypasses only pre-commit and commit-msg verification hooks.
      Prepare-commit-msg and other applicable hooks still run. Hooks can edit files or messages;
      a failed commit does not undo their changes. Inspect staged contents before retrying.</p>
    <p>Optional identities for this commit only. No Git configuration is saved.
      Author describes who wrote the change; committer describes who records it.
      Amend keeps its existing author unless explicitly overridden. Signing still follows Git's policy;
      a different committer can change default signing-key selection.</p>
    <label class="toggle"><input type="checkbox" [disabled]="disabled()" [checked]="author() !== null"
      (change)="update({ author: author() ? null : initialIdentity() })" /> Override commit author</label>
    @if (author(); as identity) {
      <label>Author name<input name="commitAuthorName" maxlength="256" [disabled]="disabled()"
        autocomplete="off" [ngModel]="identity.name" (ngModelChange)="update({ author: { name: $event, email: identity.email } })" /></label>
      <label>Author email<input name="commitAuthorEmail" maxlength="320" [disabled]="disabled()"
        autocomplete="off" spellcheck="false" [ngModel]="identity.email" (ngModelChange)="update({ author: { name: identity.name, email: $event } })" /></label>
    }
    <label class="toggle"><input type="checkbox" [disabled]="disabled()" [checked]="committer() !== null"
      (change)="update({ committer: committer() ? null : initialIdentity() })" /> Override commit committer</label>
    @if (committer(); as identity) {
      <label>Committer name<input name="commitCommitterName" maxlength="256" [disabled]="disabled()"
        autocomplete="off" [ngModel]="identity.name" (ngModelChange)="update({ committer: { name: $event, email: identity.email } })" /></label>
      <label>Committer email<input name="commitCommitterEmail" maxlength="320" [disabled]="disabled()"
        autocomplete="off" spellcheck="false" [ngModel]="identity.email" (ngModelChange)="update({ committer: { name: identity.name, email: $event } })" /></label>
    }
    <gc-git-help topic="commit" label="Learn about commit policy…" />
    @if (author() || committer()) {
      <p>Enter complete names and explicit emails. These are checked before committing.
        Signed-off-by uses the effective committer, not the author. Disabling an override discards its entered values.</p>
    }
  `,
  styles: [`
    :host { display: block; margin-top: 10px; border-top: 1px solid var(--inspector-divider); }
    p { font-size: 12px; line-height: 1.5; color: var(--text); }
    label { display: grid; gap: 4px; margin-top: 8px; font-size: 12px; color: var(--text); }
    label.toggle { display: flex; align-items: center; gap: 6px; min-height: 24px; }
    input:not([type=checkbox]) { box-sizing: border-box; width: 100%; min-width: 0; padding: 8px; border: 1px solid var(--inspector-control-border); background: var(--inspector-control); color: var(--text); font: inherit; }
    input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    input:disabled { opacity: .5; }
  `],
})
export class CommitPolicyFieldsComponent {
  readonly policy = input.required<CommitPolicy>();
  readonly author = computed(() => this.policy().author ?? null);
  readonly committer = computed(() => this.policy().committer ?? null);
  readonly defaults = input<CommitIdentity>({ name: '', email: '' });
  readonly disabled = input(false);
  readonly changed = output<CommitPolicy>();

  update(change: Partial<CommitPolicy>): void {
    this.changed.emit({ ...this.policy(), ...change });
  }

  initialIdentity(): CommitIdentity {
    return { ...this.defaults() };
  }
}
