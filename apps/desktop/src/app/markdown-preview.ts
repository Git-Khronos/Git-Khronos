import { Lexer, type Token, type Tokens } from 'marked';

export const MARKDOWN_PREVIEW_BYTES = 128 * 1024;
export type MarkdownNodeKind = 'text' | 'paragraph' | 'heading' | 'strong' | 'em' | 'delete'
  | 'quote' | 'list' | 'item' | 'code' | 'codeSpan' | 'line' | 'rule' | 'table' | 'row' | 'cell' | 'image' | 'link';
export interface MarkdownNode {
  kind: MarkdownNodeKind;
  text?: string;
  children?: MarkdownNode[];
  level?: number;
  ordered?: boolean;
  start?: number;
  header?: boolean;
}
export type MarkdownPreview = { nodes: MarkdownNode[]; error: string | null };

// Ordinary text only; unknown named entities stay literal. This bounded preview
// does not claim full CommonMark parity. Code and literal HTML are untouched.
function textEntities(text: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
  return text.replace(/&(#(?:x[0-9a-f]{1,6}|[0-9]{1,7})|amp|lt|gt|quot|apos|nbsp);/gi, (raw, name: string) => {
    if (name[0] !== '#') return named[name] ?? raw;
    const hex = name[1]?.toLowerCase() === 'x';
    const value = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
    return value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff) ? String.fromCodePoint(value) : '\ufffd';
  });
}
export function buildMarkdownPreview(source: string): MarkdownPreview {
  if (source.length > MARKDOWN_PREVIEW_BYTES || new TextEncoder().encode(source).length > MARKDOWN_PREVIEW_BYTES) {
    return { nodes: [], error: 'Markdown preview is limited to 128 KiB of UTF-8 text. Your draft is unchanged.' };
  }
  let remaining = 6000;
  const reserve = () => { if (--remaining < 0) throw new Error('preview budget'); };
  const text = (value: string, kind: MarkdownNodeKind = 'text'): MarkdownNode => { reserve(); return { kind, text: value }; };
  const convert = (tokens: Token[], depth = 0): MarkdownNode[] => {
    if (depth > 24) throw new Error('preview depth');
    return tokens.flatMap((token): MarkdownNode[] => {
      const nested = (children: Token[]) => convert(children, depth + 1);
      const branch = (kind: MarkdownNodeKind, children: Token[], extra: Partial<MarkdownNode> = {}): MarkdownNode[] => {
        reserve(); return [{ kind, children: nested(children), ...extra }];
      };
      switch (token.type) {
        case 'space': case 'def': return [];
        case 'paragraph': return branch('paragraph', (token as Tokens.Paragraph).tokens);
        case 'heading': return branch('heading', (token as Tokens.Heading).tokens, { level: Math.max(1, Math.min(6, (token as Tokens.Heading).depth)) });
        case 'strong': return branch('strong', (token as Tokens.Strong).tokens);
        case 'em': return branch('em', (token as Tokens.Em).tokens);
        case 'del': return branch('delete', (token as Tokens.Del).tokens);
        case 'blockquote': return branch('quote', (token as Tokens.Blockquote).tokens);
        case 'list': {
          const list = token as Tokens.List;
          reserve();
          return [{ kind: 'list', ordered: list.ordered, start: typeof list.start === 'number' ? list.start : 1,
            children: list.items.map(item => {
              reserve();
              return { kind: 'item', children: [...(item.task ? [text(item.checked ? '[x] ' : '[ ] ')] : []), ...nested(item.tokens)] };
            }) }];
        }
        case 'table': {
          const table = token as Tokens.Table;
          reserve();
          return [{ kind: 'table', children: [table.header, ...table.rows].map((row, index) => {
            reserve(); return { kind: 'row', children: row.map(cell => {
              reserve(); return { kind: 'cell', header: index === 0, children: nested(cell.tokens) };
            }) };
          }) }];
        }
        case 'code': return [text((token as Tokens.Code).text, 'code')];
        case 'codespan': return [text((token as Tokens.Codespan).text, 'codeSpan')];
        case 'br': reserve(); return [{ kind: 'line' }];
        case 'hr': reserve(); return [{ kind: 'rule' }];
        case 'html': return [text(token.raw)];
        case 'escape': return [text((token as Tokens.Escape).text)];
        case 'link': {
          const link = token as Tokens.Link;
          return branch('link', link.tokens, { text: link.href });
        }
        case 'image': {
          const image = token as Tokens.Image;
          return [text(`[Image: ${textEntities(image.text)}] (${image.href})`, 'image')];
        }
        case 'text': {
          const value = token as Tokens.Text;
          return value.tokens ? nested(value.tokens) : [text(textEntities(value.text))];
        }
        default: return [text(token.raw)];
      }
    });
  };
  try { return { nodes: convert(Lexer.lex(source, { gfm: true, breaks: false })), error: null }; }
  catch { return { nodes: [], error: 'This Markdown could not be previewed within the rendering limits. Your draft is unchanged.' }; }
}
