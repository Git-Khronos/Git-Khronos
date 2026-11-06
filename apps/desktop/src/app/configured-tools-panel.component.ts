import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { ToolProfile } from '@git-khronos/contracts';
import { CONFIGURED_TOOLS } from './configured-tools.service';

@Component({
  selector: 'gc-configured-tools-panel',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host{display:grid;gap:12px;min-width:0;font-size:13px}
    form,fieldset{display:grid;gap:12px;min-width:0}fieldset{border:0;padding:0;margin:0}
    legend{font-weight:600;margin-bottom:12px}label{display:grid;gap:5px;color:var(--muted)}
    input,select,button{min-height:34px;box-sizing:border-box;border:1px solid var(--inspector-divider);border-radius:5px;background:var(--inspector-row);color:var(--text);font:inherit;padding:7px 10px}
    input,select{width:100%;min-width:0}button{cursor:pointer}button:disabled{opacity:.55;cursor:default}
    button:hover:not(:disabled){border-color:var(--muted)}input:focus-visible,select:focus-visible,button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
    small{color:var(--muted);line-height:1.5;overflow-wrap:anywhere}
    .argument,.actions{display:flex;flex-wrap:wrap;align-items:end;gap:8px}.argument label{flex:1 1 150px;min-width:0}.argument button{flex:none}
    .profiles{display:grid;gap:6px}.profiles button{text-align:left;overflow-wrap:anywhere}
    .default-choice{display:flex;align-items:center;gap:8px}.default-choice input{width:16px;height:16px;min-height:0;margin:0;flex:none}
  `],
  template: `
    <strong>Programs and arguments</strong>
    <small>Choose installed editor, comparison, merge and terminal programs. Each argument below is passed separately. Use &#123;repository&#125; for the current checkout and doubled braces for literal braces.</small>
    @if (tools.legacyProfilesMigrated()) {
      <p role="status">Previously saved agent profiles are now terminal profiles. They were not started or set as defaults during this migration; review their commands before launching them.</p>
    }
    @if (tools.storageError(); as message) {
      <p role="alert">{{ message }}</p>
      @if (confirmClear()) { <div class="actions"><button type="button" (click)="clearStorage()">Clear unreadable profiles</button><button type="button" (click)="confirmClear.set(false)">Keep stored data</button></div> }
      @else { <button type="button" (click)="confirmClear.set(true)">Review clearing stored profiles…</button> }
    }
    <div class="profiles" aria-label="Saved program profiles">
      @for (profile of tools.profiles(); track profile.id) {
        <button type="button" [disabled]="busy()" (click)="edit(profile)">{{ profile.name }} · {{ profile.role }}{{ tools.defaultFor(profile.role)?.id === profile.id ? ' · default ' + profile.role : '' }}</button>
      }
    </div>
    <button type="button" [disabled]="busy() || !!tools.storageError()" (click)="edit(null)">New program profile</button>
    @if (tools.defaultTerminal()) { <button type="button" [disabled]="busy()" (click)="useSystem()">Use system shell for new terminal tabs</button> }
    @if (draft(); as value) {
      <form (ngSubmit)="save()">
        <fieldset [disabled]="busy()">
          <legend>{{ editingId ? 'Edit program profile' : 'New program profile' }}</legend>
          <label>Display name<input name="toolName" aria-label="Program profile name" maxlength="128" [ngModel]="value.name" (ngModelChange)="patch({name: $event})" /></label>
          <label>Use for<select name="toolRole" aria-label="Program profile role" [ngModel]="value.role" (ngModelChange)="patch({role: $event})"><option value="editor">Editor</option><option value="diff">Comparison</option><option value="merge">Merge</option><option value="terminal">Terminal</option></select></label>
          <label>Executable path<input name="toolExecutable" aria-label="Program executable path" autocomplete="off" spellcheck="false" [ngModel]="value.executable" (ngModelChange)="patch({executable: $event})" /></label>
          <small>Enter the absolute executable path without surrounding quotes. Shell commands require an explicitly selected shell program.</small>
          @if (value.role === 'editor') { <small>Include &#123;file&#125; for the saved working file. Use &#123;line&#125; for a one-based line when the program supports it. Unsaved editor text is reviewed before handoff.</small> }
          @if (value.role === 'diff') { <small>Include &#123;before&#125; and &#123;after&#125; for private comparison copies. The original files are unchanged.</small> }
          @if (value.role === 'merge') { <small>Use &#123;base&#125;, &#123;before&#125; and &#123;after&#125; for the base, current and incoming copies. Include &#123;merged&#125; for the separate output file. Saving and staging that result require another review.</small> }
          @for (argument of value.arguments; track $index; let index = $index) {
            <div class="argument"><label>Argument {{ index + 1 }}<input [name]="'toolArgument' + index" [attr.aria-label]="'Program argument ' + (index + 1)" autocomplete="off" spellcheck="false" [ngModel]="argument" (ngModelChange)="setArgument(index, $event)" /></label><button type="button" [attr.aria-label]="'Remove program argument ' + (index + 1)" (click)="removeArgument(index)">Remove</button></div>
          }
          <button type="button" [disabled]="value.arguments.length >= 32" (click)="addArgument()">Add argument</button>
          <label class="default-choice"><input name="toolDefault" type="checkbox" [ngModel]="makeDefault()" (ngModelChange)="makeDefault.set($event)" /> {{ value.role === 'terminal' ? 'Use for new terminal tabs' : 'Use by default for this file action' }}</label>
          <div class="actions"><button type="submit">{{ busy() ? 'Saving…' : 'Save program profile' }}</button><button type="button" (click)="draft.set(null)">Cancel profile changes</button>
            @if (editingId) { <button type="button" (click)="remove()">Delete program profile</button> }
          </div>
        </fieldset>
      </form>
    }
    @if (error(); as message) { <p role="alert">{{ message }}</p> }
    @if (notice(); as message) { <p role="status">{{ message }}</p> }
  `,
})
export class ConfiguredToolsPanelComponent {
  protected readonly tools = inject(CONFIGURED_TOOLS);
  protected readonly draft = signal<ToolProfile | null>(null);
  protected readonly makeDefault = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly confirmClear = signal(false);
  protected editingId: string | null = null;

  protected edit(profile: ToolProfile | null): void {
    this.editingId = profile?.id ?? null;
    this.draft.set(profile ? structuredClone(profile) : { version: 1, id: crypto.randomUUID(), name: '', role: 'terminal', executable: '', arguments: [] });
    this.makeDefault.set(!!profile && this.tools.defaultFor(profile.role)?.id === profile.id);
    this.error.set(null); this.notice.set(null);
  }
  protected patch(update: Partial<ToolProfile>): void { this.draft.update((p) => p ? { ...p, ...update } : null); }
  protected addArgument(): void { this.patch({ arguments: [...this.draft()!.arguments, ''] }); }
  protected setArgument(index: number, value: string): void {
    const args = [...this.draft()!.arguments]; args[index] = value; this.patch({ arguments: args });
  }
  protected removeArgument(index: number): void { this.patch({ arguments: this.draft()!.arguments.filter((_, i) => i !== index) }); }
  protected async save(): Promise<void> {
    const value = this.draft(); if (!value || this.busy()) return;
    this.busy.set(true); this.error.set(null); this.notice.set(null);
    try { await this.tools.save(value, this.makeDefault()); this.draft.set(null); this.notice.set('Profile saved. Programs start only through an explicit launch.'); }
    catch (cause) { this.error.set(this.message(cause)); }
    finally { this.busy.set(false); }
  }
  protected remove(): void { this.perform(() => { this.tools.remove(this.editingId!); this.draft.set(null); this.notice.set('Profile deleted. Existing sessions continue.'); }); }
  protected useSystem(): void { this.perform(() => { this.tools.useSystemTerminal(); this.makeDefault.set(false); }); }
  protected clearStorage(): void { this.perform(() => { this.tools.clearUnreadableStorage(); this.confirmClear.set(false); }); }
  private perform(action: () => void): void { this.error.set(null); try { action(); } catch (cause) { this.error.set(this.message(cause)); } }
  private message(cause: unknown): string { return cause && typeof cause === 'object' && 'message' in cause ? String(cause.message) : 'The profile could not be saved.'; }
}
