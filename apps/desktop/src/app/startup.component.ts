import {
  ChangeDetectionStrategy,
  Component,
  EnvironmentInjector,
  OnInit,
  ViewContainerRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';

/**
 * Tiny first-paint shell. The full repository workspace is loaded only after
 * Angular has rendered this accessible state, so expensive startup parsing
 * cannot leave the native window looking blank.
 */
@Component({
  selector: 'gk-root',
  template: `
    @if (!loaded()) {
      <main class="startup" [attr.aria-busy]="!loadError()" aria-live="polite">
        <span class="startup-mark" aria-hidden="true">GK</span>
        <strong>Git Khronos</strong>
        @if (loadError()) {
          <p role="alert">The workspace could not be loaded.</p>
          <button type="button" (click)="retry()">Retry</button>
        } @else {
          <p role="status">Loading your workspace…</p>
        }
      </main>
    }
    <ng-container #appOutlet />
  `,
  styles: [`
    :host { display: block; min-height: 100vh; background: #151521; color: #f2f2f7; }
    .startup { min-height: 100vh; display: grid; align-content: center; justify-items: center; gap: 12px; font: 13px/1.4 system-ui, sans-serif; }
    .startup-mark { display: grid; place-items: center; width: 38px; height: 38px; border: 1px solid #54d6ad; border-radius: 10px; color: #54d6ad; font-weight: 700; }
    .startup p { margin: 0; color: #a4a4b6; }
    .startup button { min-height: 36px; padding: 0 14px; border: 1px solid #54d6ad; border-radius: 5px; background: transparent; color: inherit; cursor: pointer; }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StartupComponent implements OnInit {
  private readonly outlet = viewChild.required('appOutlet', { read: ViewContainerRef });
  private readonly environmentInjector = inject(EnvironmentInjector);
  protected readonly loaded = signal(false);
  protected readonly loadError = signal(false);
  private generation = 0;

  ngOnInit(): void {
    void this.loadWorkspace();
  }

  protected retry(): void {
    void this.loadWorkspace();
  }

  private async loadWorkspace(): Promise<void> {
    const generation = ++this.generation;
    this.loadError.set(false);
    try {
      const { AppComponent } = await import('./app.component');
      if (generation !== this.generation) return;
      this.outlet().clear();
      this.outlet().createComponent(AppComponent, { environmentInjector: this.environmentInjector });
      this.loaded.set(true);
    } catch (error) {
      console.error('Git Khronos workspace startup failed', error);
      if (generation === this.generation) this.loadError.set(true);
    }
  }
}
