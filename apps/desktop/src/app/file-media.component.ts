import { ChangeDetectionStrategy, Component, computed, effect, input, signal, untracked } from '@angular/core';
import { ipc, type FileComparisonRequest, type FileMediaComparison, type FileMediaSide } from '@git-khronos/contracts';

export interface FileMediaSelection { repoId: string; request: FileComparisonRequest; }

@Component({
  selector: 'gc-file-media',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-label="Selected file content" [attr.aria-busy]="busy()">
      <header>
        <div><h3>Content comparison</h3><p>Original file bytes · read only</p></div>
        <button type="button" (click)="reload()" [disabled]="busy() || !selection()">Reload content</button>
      </header>
      @if (busy()) {
        <div class="notice" role="status">Reading selected sides… <button type="button" (click)="cancel()">Cancel content load</button></div>
      }
      @if (error()) { <div class="notice error" role="alert">{{ error() }} <button type="button" (click)="reload()">Retry content load</button></div> }
      @if (content(); as comparison) {
        <div class="controls">
          <div role="group" aria-label="Content sides">
            @for (option of views; track option.value) {
              <button type="button" [attr.aria-pressed]="view() === option.value" (click)="view.set(option.value)">{{ option.label }}</button>
            }
          </div>
          @if (hasRaster()) {
            <div role="group" aria-label="Image scale">
              <button type="button" [attr.aria-pressed]="zoom() === null" (click)="zoom.set(null)">Fit images</button>
              <button type="button" [attr.aria-pressed]="zoom() === 1" (click)="zoom.set(1)">Actual size</button>
              <button type="button" aria-label="Zoom images out" [disabled]="zoom() !== null && zoom()! <= .25" (click)="changeZoom(-1)">−</button>
              <output aria-label="Image zoom">{{ zoom() === null ? 'Fit' : zoom()! * 100 + '%' }}</output>
              <button type="button" aria-label="Zoom images in" [disabled]="zoom() !== null && zoom()! >= 8" (click)="changeZoom(1)">+</button>
            </div>
          }
        </div>
        <div class="sides" [class.single]="view() !== 'both'">
          @for (entry of visibleSides(); track entry.side) {
            <article [attr.aria-label]="entry.position + ' content'">
              <h4>{{ entry.position }} · {{ entry.side.label }}</h4>
              <p class="path">{{ entry.side.path }}</p>
              <dl>
                <div><dt>Type</dt><dd>{{ typeLabel(entry.side) }}</dd></div>
                <div><dt>Bytes</dt><dd>{{ entry.side.size === null ? 'Unknown' : entry.side.size }}</dd></div>
                @if (entry.side.oid) { <div><dt>Git object</dt><dd><code>{{ entry.side.oid }}</code></dd></div> }
                @if (entry.side.raster; as raster) { <div><dt>Encoded size</dt><dd>{{ raster.width }} × {{ raster.height }} px</dd></div> }
              </dl>
              @if (entry.side.message) { <p class="notice">{{ entry.side.message }}</p> }
              @if (entry.side.lfs; as pointer) {
                <p>Referenced LFS object: {{ pointer.size }} bytes</p><code class="identity">{{ pointer.sha256 }}</code>
              }
              @if (safeImage(entry.side); as url) {
                @if (imageErrors()[entry.position]) {
                  <p class="notice error" role="alert">{{ imageErrors()[entry.position] }}</p>
                } @else {
                  @if (!imageSizes()[entry.position]) { <p role="status">Decoding {{ entry.position.toLowerCase() }} image…</p> }
                  <div class="image-area" tabindex="0" role="region" [attr.aria-label]="entry.position + ' image preview'" [class.fit]="zoom() === null">
                    <img [src]="url" [alt]="entry.position + ': ' + entry.side.path" decoding="async"
                      [style.width.px]="zoom() !== null && imageSizes()[entry.position] ? imageSizes()[entry.position]!.width * zoom()! : null"
                      (load)="loaded(entry.position, entry.side, $event)" (error)="failed(entry.position, entry.side)" />
                  </div>
                  @if (imageSizes()[entry.position]; as size) { <p class="caption">Displayed orientation: {{ size.width }} × {{ size.height }} px</p> }
                }
              } @else if (entry.side.state === 'text') {
                <p class="notice">Text content is available in the Diff view. SVG remains text.</p>
              } @else if (entry.side.state === 'binary') {
                <p class="notice">Binary content. No image preview is available for this format.</p>
              } @else if (entry.side.state === 'absent') {
                <p class="notice">File is absent on this side.</p>
              } @else if (entry.side.state === 'symbolicLink') {
                <p class="notice">Symbolic link. Its target is not opened for preview.</p>
              } @else if (entry.side.state === 'submodule') {
                <p class="notice">Submodule reference. Use the submodule workflow to inspect it.</p>
              } @else if (entry.side.state === 'unmerged') {
                <p class="notice">Unresolved index entries. Use conflict resolution to select a side.</p>
              } @else if (entry.side.state === 'raster') {
                <p class="notice error" role="alert">Image response is invalid. Reload content to try again.</p>
              }
            </article>
          }
        </div>
      }
    </section>
  `,
  styles: `
    :host{display:block;min-width:0;min-height:0;overflow:auto;flex:1;grid-column:1 / -1}section{padding:16px;min-width:0;color:var(--text)}
    header,.controls,.controls>div{display:flex;align-items:center;gap:8px;flex-wrap:wrap}header{justify-content:space-between;margin-bottom:16px}
    h3{font-size:15px;margin:0}h4{font-size:13px;margin:0 0 8px}p{font-size:13px;line-height:1.5;overflow-wrap:anywhere;margin:6px 0}
    button{font:inherit;font-size:12px;min-height:32px;padding:6px 10px;color:var(--text);background:var(--inspector-row);border:1px solid var(--inspector-divider);cursor:pointer}
    button[aria-pressed=true]{border-color:var(--accent);box-shadow:inset 0 -2px var(--accent)}button:disabled{opacity:.5;cursor:default}
    button:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.controls{justify-content:space-between;margin-bottom:12px}
    output{font-size:12px;min-width:4ch;text-align:center}.sides{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.sides.single{grid-template-columns:minmax(0,1fr)}
    article{min-width:0;padding:12px;border:1px solid var(--inspector-divider)}.path,code{overflow-wrap:anywhere}code{font-size:11px}.identity{display:block}
    dl{margin:10px 0;font-size:12px}dl>div{display:flex;gap:12px;margin:6px 0}dt{flex:0 0 80px;color:var(--muted)}dd{margin:0;min-width:0;overflow-wrap:anywhere}
    .notice{padding:10px;background:var(--inspector-row);font-size:13px;line-height:1.5;overflow-wrap:anywhere}.error{color:var(--danger)}
    .image-area{min-height:100px;max-height:60vh;overflow:auto;background:repeating-conic-gradient(var(--inspector-row) 0% 25%,var(--inspector-divider) 0% 50%) 0 0/16px 16px;padding:12px;box-sizing:border-box}
    img{display:block;max-width:none;height:auto}.fit{display:flex;align-items:center;justify-content:center}.fit img{max-width:100%;max-height:50vh;object-fit:contain}
    .caption{font-size:12px;color:var(--muted)}@container (max-width:620px){.sides{grid-template-columns:minmax(0,1fr)}}
    :host{container-type:inline-size}@media(max-width:620px){.sides{grid-template-columns:minmax(0,1fr)}}
  `,
})
export class FileMediaComponent {
  readonly selection = input<FileMediaSelection | null>(null);
  readonly content = signal<FileMediaComparison | null>(null);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly view = signal<'both' | 'before' | 'after'>('both');
  readonly zoom = signal<number | null>(null);
  readonly imageErrors = signal<Record<string, string>>({});
  readonly imageSizes = signal<Record<string, { width: number; height: number }>>({});
  readonly views = [{ value: 'both', label: 'Both sides' }, { value: 'before', label: 'Before only' }, { value: 'after', label: 'After only' }] as const;
  readonly visibleSides = computed(() => {
    const data = this.content();
    return data ? [
      ...(this.view() !== 'after' ? [{ position: 'Before', side: data.before }] : []),
      ...(this.view() !== 'before' ? [{ position: 'After', side: data.after }] : []),
    ] : [];
  });
  readonly hasRaster = computed(() => !!this.content() && [this.content()!.before, this.content()!.after].some(side => side.state === 'raster'));
  private generation = 0;
  private operation: string | null = null;

  constructor() {
    effect(cleanup => {
      const selected = this.selection();
      untracked(() => { this.view.set('both'); this.zoom.set(null); void this.load(selected); });
      cleanup(() => this.stop());
    });
  }
  private stop(): void {
    this.generation++;
    const operationId = this.operation;
    this.operation = null;
    if (operationId) void ipc.cancel_git_operation({ operationId }).catch(() => {});
  }
  cancel(): void { this.stop(); this.busy.set(false); this.error.set('Content load cancelled.'); }
  reload(): void { void this.load(this.selection()); }
  private async load(selected: FileMediaSelection | null): Promise<void> {
    this.stop();
    this.content.set(null); this.error.set(''); this.imageErrors.set({}); this.imageSizes.set({});
    if (!selected) { this.busy.set(false); return; }
    const generation = this.generation;
    const operationId = `media-${crypto.randomUUID()}`;
    this.operation = operationId;
    this.busy.set(true);
    try {
      const content = await ipc.inspect_file_media({ ...selected, operationId });
      if (generation === this.generation) this.content.set(content);
    } catch (error: unknown) {
      if (generation === this.generation) this.error.set(error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Selected content could not load.');
    } finally {
      if (generation === this.generation) { this.busy.set(false); this.operation = null; }
    }
  }
  changeZoom(direction: number): void { this.zoom.set(Math.max(.25, Math.min(8, (this.zoom() ?? 1) * (direction > 0 ? 2 : .5)))); }
  typeLabel(side: FileMediaSide): string { return side.raster?.mime ?? ({ absent: 'Absent', text: 'Text', binary: 'Binary', raster: 'Image', invalidRaster: 'Invalid image', overLimit: 'Preview limit', symbolicLink: 'Symbolic link', submodule: 'Submodule', unmerged: 'Unmerged', unavailable: 'Unavailable', lfsPointer: 'Git LFS pointer' }[side.state]); }
  private readonly imageUrls = new WeakMap<FileMediaSide, string | null>();
  safeImage(side: FileMediaSide): string | null {
    if (this.imageUrls.has(side)) return this.imageUrls.get(side)!;
    const url = side.dataUrl;
    const raster = side.raster;
    const safe = side.state === 'raster' && raster && Number.isInteger(raster.width) && Number.isInteger(raster.height)
      && raster.width > 0 && raster.height > 0 && raster.width <= 16384 && raster.height <= 16384 && raster.width * raster.height <= 40_000_000
      && url && url.length <= 11_184_920 && /^data:image\/(?:png|jpeg|gif|webp|bmp|x-icon);base64,[A-Za-z0-9+/]*={0,2}$/.test(url)
      && url.startsWith('data:' + raster.mime + ';base64,') ? url : null;
    this.imageUrls.set(side, safe);
    return safe;
  }
  private current(side: FileMediaSide): boolean { return this.content()?.before === side || this.content()?.after === side; }
  loaded(position: string, side: FileMediaSide, event: Event): void {
    if (!this.current(side)) return;
    const image = event.target as HTMLImageElement;
    const width = image.naturalWidth, height = image.naturalHeight;
    if (!width || !height || width > 16384 || height > 16384 || width * height > 40_000_000) {
      this.imageErrors.update(errors => ({ ...errors, [position]: 'Decoded image exceeds preview dimensions or has no pixels.' }));
    } else {
      this.imageSizes.update(sizes => ({ ...sizes, [position]: { width, height } }));
    }
  }
  failed(position: string, side: FileMediaSide): void {
    if (this.current(side)) this.imageErrors.update(errors => ({ ...errors, [position]: 'Image decoding failed. Reload content to try again.' }));
  }
}
