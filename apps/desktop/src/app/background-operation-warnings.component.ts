import { ChangeDetectionStrategy, Component, ElementRef, inject, input } from '@angular/core';
import { GitKhronosService } from './git-khronos.service';

@Component({
  selector: 'gc-background-operation-warnings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.floating]': 'floating()' },
  template: `
    <section aria-label="Background operation warnings">
      @for (warning of git.backgroundOperationWarnings(); track warning.operationId) {
        <div class="background-operation-warning">
          <p role="alert">{{ warning.message }}</p>
          <button type="button" aria-label="Dismiss background operation warning" (click)="dismiss(warning.operationId, $event)">Dismiss</button>
        </div>
      }
    </section>
  `,
  styles: `
    :host{display:block;min-width:0}
    :host(.floating){position:fixed;right:18px;bottom:calc(var(--statusbar-height) + 82px);z-index:40;width:min(560px,calc(100vw - 36px))}
    section{display:grid;gap:6px;max-height:min(40dvh,280px);overflow:auto}
    .background-operation-warning{display:flex;align-items:start;gap:12px;padding:10px;border:1px solid var(--danger);background:var(--inspector-list);color:var(--text)}
    :host(.floating) .background-operation-warning{box-shadow:0 12px 32px rgb(0 0 0 / .4)}
    p{flex:1;min-width:0;margin:0;font-size:13px;line-height:1.5;overflow-wrap:anywhere}
    button{flex:none;min-height:32px;padding:6px 10px;border:1px solid var(--inspector-divider);background:var(--inspector-row);color:var(--text);font:inherit;font-size:12px;cursor:pointer}
    button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  `,
})
export class BackgroundOperationWarningsComponent {
  protected readonly git = inject(GitKhronosService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly floating = input(false);

  dismiss(operationId: string, event: MouseEvent): void {
    const button = event.currentTarget;
    if (button instanceof HTMLElement && document.activeElement === button) {
      const host = this.host.nativeElement;
      const scope = host.closest<HTMLElement>('dialog, [role="dialog"]') ?? document;
      const remaining = [...host.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
        .find(candidate => candidate !== button);
      const fallback = [...scope.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])')]
        .find(candidate => !host.contains(candidate) && !candidate.closest('[inert]') && candidate.getClientRects().length > 0 && candidate.getAttribute('aria-disabled') !== 'true');
      (remaining ?? fallback)?.focus();
    }
    this.git.dismissBackgroundOperationWarning(operationId);
  }
}
