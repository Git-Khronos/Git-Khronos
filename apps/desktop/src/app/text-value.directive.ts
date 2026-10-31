import { Directive, ElementRef, inject, input, output } from '@angular/core';

@Directive({
  selector: 'input[gcTextValue], textarea[gcTextValue]',
  host: {
    '[value]': 'textValue()',
    '(input)': 'handleInput()',
    '(compositionstart)': 'handleCompositionStart()',
    '(compositionend)': 'handleCompositionEnd()',
  },
})
export class TextValueDirective {
  readonly textValue = input.required<string>({ alias: 'gcTextValue' });
  readonly textValueChange = output<string>({ alias: 'gcTextValueChange' });
  private readonly element = inject<ElementRef<HTMLInputElement | HTMLTextAreaElement>>(ElementRef);
  private composing = false;

  protected handleInput(): void {
    // Keep filters and drafts unchanged until an IME composition is committed.
    if (!this.composing) this.publishValue();
  }

  protected handleCompositionStart(): void {
    this.composing = true;
  }

  protected handleCompositionEnd(): void {
    this.composing = false;
    this.publishValue();
  }

  private publishValue(): void {
    this.textValueChange.emit(this.element.nativeElement.value);
  }
}
