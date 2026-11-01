import { describe, expect, it } from 'vitest';
import { buildMarkdownPreview, MARKDOWN_PREVIEW_BYTES, type MarkdownNode } from './markdown-preview';

function flatten(nodes: MarkdownNode[]): MarkdownNode[] {
  return nodes.flatMap(node => [node, ...flatten(node.children ?? [])]);
}
describe('inert Markdown preview requirements', () => {
  it('represents headings, emphasis, lists, tasks, quotes, code and tables as bounded structure', () => {
    const result = buildMarkdownPreview('# Title\n\n**bold** and *emphasis* with `code`\n\n> quote\n\n3. first\n4. second\n\n- [x] finished\n\n```js\n<script>literal</script>\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |\n');
    expect(result.error).toBeNull();
    const nodes = flatten(result.nodes);
    for (const kind of ['heading', 'strong', 'em', 'quote', 'list', 'item', 'code', 'codeSpan', 'table', 'cell']) {
      expect(nodes.some(node => node.kind === kind), kind).toBe(true);
    }
    expect(nodes.find(node => node.kind === 'heading')?.level).toBe(1);
    expect(nodes.find(node => node.kind === 'list')?.start).toBe(3);
    expect(nodes.find(node => node.kind === 'code')?.text).toBe('<script>literal</script>');
  });
  it('keeps HTML literal and never emits actionable link/image fields for hostile destinations', () => {
    const source = '<img src="https://unrequested.invalid/a" onerror="alert(1)">\n\n[unsafe](javascript:alert%281%29) ![external](https://unrequested.invalid/b)';
    const result = buildMarkdownPreview(source);
    expect(result.error).toBeNull();
    const nodes = flatten(result.nodes);
    expect(nodes.some(node => node.kind === 'text' && node.text?.includes('<img'))).toBe(true);
    expect(nodes.some(node => node.kind === 'link' && node.text?.startsWith('javascript:'))).toBe(true);
    expect(nodes.some(node => node.kind === 'image' && node.text?.includes('unrequested.invalid/b'))).toBe(true);
    for (const node of nodes) {
      expect(node).not.toHaveProperty('html'); expect(node).not.toHaveProperty('src'); expect(node).not.toHaveProperty('href');
    }
  });
  it('decodes common and numeric entities only in ordinary text and leaves code literal', () => {
    const nodes = flatten(buildMarkdownPreview('&lt;script&gt; &amp; &#x1f642; &copy; `&amp;`').nodes);
    expect(nodes.filter(n => n.kind === 'text').map(n => n.text).join('')).toContain('<script> & 🙂 &copy;');
    expect(nodes.find(n => n.kind === 'codeSpan')?.text).toBe('&amp;');
  });
  it('refuses oversize UTF-8 input without rendering a prefix', () => {
    for (const source of ['a'.repeat(MARKDOWN_PREVIEW_BYTES + 1), '🙂'.repeat(MARKDOWN_PREVIEW_BYTES / 4 + 1)]) {
      const result = buildMarkdownPreview(source);
      expect(result.nodes).toEqual([]); expect(result.error).toContain('128 KiB');
    }
  });
  it('refuses excessive node counts or nesting rather than returning a misleading partial preview', () => {
    for (const source of ['**a** '.repeat(3100), `${'> '.repeat(30)}deep`]) {
      const result = buildMarkdownPreview(source);
      expect(result.nodes).toEqual([]); expect(result.error).toContain('limits');
    }
  });
  it('handles the upstream whitespace-regression input with a completed bounded result', () => {
    const result = buildMarkdownPreview('\t\u000b\n');
    expect(Array.isArray(result.nodes)).toBe(true);
  });
});
