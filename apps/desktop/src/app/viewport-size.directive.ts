import { AfterViewInit, Directive, ElementRef, OnDestroy, inject, output } from '@angular/core';

/** Keeps virtual windows aligned with resizers, maximized panels and font changes. */
@Directive({ selector: '[gcViewportSize],[gcViewportWidth]' })
export class ViewportSizeDirective implements AfterViewInit, OnDestroy {
  readonly viewportSize = output<number>({ alias: 'gcViewportSize' });
  readonly viewportWidth = output<number>({ alias: 'gcViewportWidth' });
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private observer?: ResizeObserver;

  ngAfterViewInit(): void {
    this.observer = new ResizeObserver(() => {
      this.viewportSize.emit(this.element.nativeElement.clientHeight);
      this.viewportWidth.emit(this.element.nativeElement.offsetWidth);
    });
    this.observer.observe(this.element.nativeElement);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }
}
