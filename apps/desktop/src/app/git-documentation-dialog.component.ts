import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GitKhronosService } from './git-khronos.service';
import { GitDocumentationService } from './git-documentation.service';
import { GIT_DOCUMENTATION_TOPICS, GIT_RELATED_MANUALS } from './git-documentation-topics';

@Component({
  selector: 'gc-git-documentation-dialog',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (documentation.request()) {
      <div class="backdrop" (click)="close()">
        <section #dialog role="dialog" aria-modal="true" aria-labelledby="git-documentation-title"
          (click)="$event.stopPropagation()" (keydown)="handleKey($event)">
          <h2 id="git-documentation-title">Git command reference</h2>
          <p>Short hints for Git Khronos workflows. Official manuals describe Git’s full capabilities,
            not a promise that every option is supported here. Links open in your browser only when selected.</p>
          <label for="git-documentation-search">Find a feature or command</label>
          <input id="git-documentation-search" type="search" [ngModel]="query()" (ngModelChange)="query.set($event)" />
          @if (error()) { <p role="alert" tabindex="-1">{{ error() }}</p> }
          <div class="topics">
            @for (topic of topics(); track topic.id) {
              <details [open]="selected() === topic.id" (toggle)="trackOpen(topic.id, $event)">
                <summary>{{ topic.title }}</summary>
                <code>{{ topic.commands }}</code>
                <p>{{ topic.hint }}</p>
                <p class="caution"><strong>Before you act:</strong> {{ topic.caution }}</p>
                <div class="manuals">
                  <button type="button" [disabled]="opening() || git.busy()" (click)="openManual(topic.manual)">Official manual: {{ topic.title }} (opens browser)</button>
                  @for (manual of relatedManuals[topic.id] ?? []; track manual.url) {
                    <button type="button" [disabled]="opening() || git.busy()" (click)="openManual(manual.url)">Official manual: {{ manual.command }} (opens browser)</button>
                  }
                </div>
              </details>
            } @empty {
              <p role="status">No matching feature. Try a Git command such as fetch, stash or worktree.</p>
            }
          </div>
          <footer><button data-docs-close type="button" [disabled]="opening()" (click)="close()">Close</button></footer>
        </section>
      </div>
    }
  `,
  styles: [`
    .backdrop { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center; padding: 18px; background: var(--overlay-backdrop); }
    section { box-sizing: border-box; width: min(680px, 100%); max-height: calc(100dvh - 36px); overflow: auto; padding: 20px; border: 1px solid var(--inspector-divider); border-radius: 7px; background: var(--inspector-list); color: var(--text); }
    h2 { margin: 0 0 12px; font-size: 16px; }
    p, summary, label, button { font-size: 13px; line-height: 1.5; }
    input { box-sizing: border-box; width: 100%; min-width: 0; margin: 6px 0 12px; padding: 8px; color: var(--text); background: var(--inspector-row); border: 1px solid var(--inspector-divider); }
    details { border-bottom: 1px solid var(--inspector-divider); padding: 10px 0; }
    summary { cursor: pointer; }
    code { display: block; margin-top: 8px; font-size: 12px; overflow-wrap: anywhere; }
    button { padding: 8px 12px; border-radius: 4px; color: var(--accent); background: var(--inspector-row); text-align: left; overflow-wrap: anywhere; cursor: pointer; }
    footer { display: flex; justify-content: flex-end; margin-top: 18px; }
    .manuals { display: flex; flex-wrap: wrap; gap: 8px; }
    button:disabled { opacity: .5; cursor: not-allowed; }
    input:focus-visible, summary:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    [role=alert] { color: var(--danger); }
  `],
})
export class GitDocumentationDialogComponent {
  readonly documentation = inject(GitDocumentationService);
  readonly git = inject(GitKhronosService);
  readonly query = signal('');
  readonly selected = signal<string | null>(null);
  readonly opening = signal(false);
  readonly error = signal('');
  readonly relatedManuals = GIT_RELATED_MANUALS;
  readonly topics = computed(() => {
    const query = this.query().trim().toLowerCase();
    return GIT_DOCUMENTATION_TOPICS.filter(topic =>
      `${topic.title} ${topic.commands} ${topic.hint} ${topic.caution}`.toLowerCase().includes(query));
  });
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');

  constructor() {
    effect(() => {
      const target = this.documentation.request();
      if (!target) return;
      this.query.set('');
      this.selected.set(target.topic);
      this.error.set('');
      setTimeout(() => {
        if (this.documentation.request() !== target) return;
        const element = this.dialog()?.nativeElement;
        const selected = element?.querySelector<HTMLElement>('details[open] summary');
        (selected ?? element?.querySelector<HTMLElement>('input'))?.focus();
        selected?.scrollIntoView({ block: 'nearest' });
      });
    });
  }

  trackOpen(id: string, event: Event): void {
    if ((event.target as HTMLDetailsElement).open) this.selected.set(id);
    else if (this.selected() === id) this.selected.set(null);
  }

  async openManual(url: string): Promise<void> {
    if (this.opening() || this.git.busy()) return;
    this.opening.set(true);
    this.error.set('');
    try {
      await this.git.openExternalUrl(url, 'Official Git documentation opened');
      const error = this.git.error();
      if (error) this.error.set(error);
    } finally {
      this.opening.set(false);
    }
    if (this.error()) setTimeout(() => this.dialog()?.nativeElement.querySelector<HTMLElement>('[role=alert]')?.focus());
  }

  close(): void {
    if (!this.opening()) this.documentation.close();
  }

  handleKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); return; }
    if (event.key !== 'Tab') return;
    const controls = [...(this.dialog()?.nativeElement.querySelectorAll<HTMLElement>('input,summary,button:not(:disabled)') ?? [])]
      .filter(element => !!element.getClientRects().length);
    if (!controls.length) return;
    const index = controls.indexOf(document.activeElement as HTMLElement);
    event.preventDefault(); event.stopPropagation();
    controls[event.shiftKey ? (index <= 0 ? controls.length - 1 : index - 1) : (index + 1) % controls.length].focus();
  }
}
