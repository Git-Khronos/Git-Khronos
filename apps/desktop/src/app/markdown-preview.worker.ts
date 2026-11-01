/// <reference lib="webworker" />
import { buildMarkdownPreview } from './markdown-preview';

addEventListener('message', ({ data }: MessageEvent<unknown>) => {
  postMessage(typeof data === 'string' ? buildMarkdownPreview(data)
    : { nodes: [], error: 'Markdown preview received an invalid text request.' });
});
