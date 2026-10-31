import { AfterViewInit, Directive, ElementRef, OnDestroy, inject, output } from '@angular/core';

/** Keeps virtual windows aligned with resizers, maximized panels and font changes. */
@Directive({ selector: '[gcViewportSize]' })
export class ViewportSizeDirective implements AfterViewInit, OnDestroy {
  readonly viewportSize = output<number>({ alias: 'gcViewportSize' });
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private observer?: ResizeObserver;

  ngAfterViewInit(): void {
    this.observer = new ResizeObserver(() => {
      this.viewportSize.emit(this.element.nativeElement.clientHeight);
    });
    this.observer.observe(this.element.nativeElement);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }
}
