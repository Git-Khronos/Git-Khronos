export class ResizePointer {
  private pointerId: number | null = null;
  private target: HTMLElement | null = null;
  private previousCursor = '';
  private previousUserSelect = '';

  begin(event: PointerEvent, cursor: 'col-resize' | 'row-resize'): boolean {
    if (event.button !== 0 || !event.isPrimary || this.pointerId !== null) return false;
    event.preventDefault();
    event.stopPropagation();
    this.pointerId = event.pointerId;
    this.target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    this.previousCursor = document.documentElement.style.cursor;
    this.previousUserSelect = document.documentElement.style.userSelect;
    document.documentElement.style.cursor = cursor;
    document.documentElement.style.userSelect = 'none';
    this.target?.focus({ preventScroll: true });
    if (event.isTrusted) this.target?.setPointerCapture(event.pointerId);
    return true;
  }

  matches(event: PointerEvent): boolean {
    return this.pointerId !== null && event.pointerId === this.pointerId;
  }

  finish(event?: PointerEvent): boolean {
    if (this.pointerId === null || (event && !this.matches(event))) return false;
    const pointerId = this.pointerId;
    const target = this.target;
    this.pointerId = null;
    this.target = null;
    if (target?.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
    document.documentElement.style.cursor = this.previousCursor;
    document.documentElement.style.userSelect = this.previousUserSelect;
    return true;
  }
}
