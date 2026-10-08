import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { CommitSignature } from '@git-chronos/contracts';
import { IconComponent, type IconName } from './icon.component';

@Component({
  selector: 'gc-commit-signature',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="commit-signature {{ signature().status }}" [attr.aria-label]="label()" [title]="detail()">
      <span><gc-icon [name]="icon()" [size]="12" /></span>
      <div><strong>{{ label() }}</strong><small>{{ detail() }}</small></div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .commit-signature { display: flex; align-items: center; gap: 8px; margin: 11px 14px 0; padding: 8px 9px; border: 1px solid var(--signature-neutral-border); border-radius: 4px; background: var(--signature-neutral-surface); color: var(--signature-neutral-text); }
    .commit-signature > span { display: grid; width: 24px; height: 24px; flex: none; place-items: center; border-radius: 50%; background: var(--signature-neutral-icon); }
    .commit-signature > div { min-width: 0; display: grid; gap: 2px; }
    .commit-signature strong, .commit-signature small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .commit-signature strong { color: var(--signature-neutral-strong); font-size: 12px; }
    .commit-signature small { color: var(--signature-neutral-muted); font-size: 12px; }
    .commit-signature.valid { border-color: var(--signature-valid-border); background: var(--signature-valid-surface); color: var(--signature-valid-text); }
    .commit-signature.valid > span { background: var(--signature-valid-icon); }
    .commit-signature.valid strong { color: var(--signature-valid-strong); }
    .commit-signature.valid-unknown { border-color: var(--signature-warning-border); background: var(--signature-warning-surface); color: var(--signature-warning-text); }
    .commit-signature.invalid, .commit-signature.expired-signature, .commit-signature.expired-key, .commit-signature.revoked-key, .commit-signature.unverifiable { border-color: var(--signature-danger-border); background: var(--signature-danger-surface); color: var(--signature-danger-text); }
    .commit-signature.unsigned { opacity: .82; }
  `],
})
export class CommitSignatureComponent {
  readonly signature = input.required<CommitSignature>();
  readonly label = computed(() => ({
    valid: 'Verified signature',
    'valid-unknown': 'Valid signature · unknown trust',
    invalid: 'Invalid signature',
    'expired-signature': 'Expired signature',
    'expired-key': 'Expired signing key',
    'revoked-key': 'Revoked signing key',
    unverifiable: 'Signature could not be verified',
    unsigned: 'Unsigned',
  })[this.signature().status]);
  readonly detail = computed(() => {
    const signature = this.signature();
    if (signature.signer && signature.key) return `${signature.signer} · key ${signature.key}`;
    if (signature.signer) return signature.signer;
    if (signature.key) return `Key ${signature.key}`;
    return signature.status === 'unsigned'
      ? 'No cryptographic signature is stored in this commit.'
      : "Check Git's signing tools and trust configuration.";
  });
  readonly icon = computed<IconName>(() => {
    const status = this.signature().status;
    if (status === 'valid' || status === 'valid-unknown') return 'check';
    return status === 'unsigned' ? 'edit' : 'warning';
  });
}
