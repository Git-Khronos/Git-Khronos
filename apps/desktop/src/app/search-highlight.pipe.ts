import { Pipe, PipeTransform } from '@angular/core';
import { highlightSearchText, SearchHighlightSegment } from './search-highlight';

@Pipe({
  name: 'searchHighlight',
  standalone: true,
  pure: true,
})
export class SearchHighlightPipe implements PipeTransform {
  transform(value: string, query: string): SearchHighlightSegment[] {
    return highlightSearchText(value, query);
  }
}
