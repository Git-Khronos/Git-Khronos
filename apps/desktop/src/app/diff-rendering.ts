export const MAX_DETAILED_DIFF_CHARACTERS = 64_000;
export const MAX_DETAILED_DIFF_LINES = 1_500;
export const MAX_SYNTAX_LINE_CHARACTERS = 2_048;
export const MAX_SYNTAX_TOKENS_PER_LINE = 256;

export interface DiffTextSegment {
  text: string;
  changed: boolean;
}

export interface DiffSyntaxToken extends DiffTextSegment {
  kind: 'plain' | 'keyword' | 'string' | 'number' | 'comment' | 'type' | 'literal' | 'punctuation';
}

/**
 * Detailed word and syntax decoration is useful for ordinary source files, but
 * it multiplies the amount of work and DOM created for generated or minified
 * patches. Large previews remain readable as plain diff text.
 */
export function shouldDecorateDiff(patchLength: number, lineCount: number): boolean {
  return Number.isFinite(patchLength)
    && Number.isFinite(lineCount)
    && patchLength <= MAX_DETAILED_DIFF_CHARACTERS
    && lineCount <= MAX_DETAILED_DIFF_LINES;
}

const DIFF_KEYWORDS = new Set([
  'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'crate', 'def', 'default',
  'do', 'else', 'enum', 'export', 'extends', 'extern', 'fn', 'for', 'from', 'function', 'if', 'impl', 'import',
  'in', 'interface', 'let', 'loop', 'match', 'mod', 'move', 'mut', 'new', 'of', 'override', 'package', 'private',
  'protected', 'pub', 'readonly', 'return', 'self', 'static', 'struct', 'super', 'switch', 'this', 'throw', 'trait',
  'try', 'type', 'typeof', 'use', 'var', 'where', 'while', 'with', 'yield',
]);

const DIFF_LITERALS = new Set(['false', 'null', 'None', 'true', 'undefined']);
const SYNTAX_TOKEN_PATTERN = /(\/\/.*$|#(?!\[).*?$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b|[{}()[\].,:;<>!=+*/|&?-])/gm;

// Long or dense lines can block syntax scanning or create thousands of renderer elements.
export function tokenizeDiffLine(segments: readonly DiffTextSegment[], path: string): DiffSyntaxToken[] {
  let length = 0;
  for (const segment of segments) {
    length += segment.text.length;
    if (length > MAX_SYNTAX_LINE_CHARACTERS) return plainDiffTokens(segments);
  }

  const tokens: DiffSyntaxToken[] = [];
  for (const segment of segments) {
    let offset = 0;
    for (const match of segment.text.matchAll(SYNTAX_TOKEN_PATTERN)) {
      const index = match.index ?? 0;
      if (index > offset) tokens.push({ text: segment.text.slice(offset, index), kind: 'plain', changed: segment.changed });
      const text = match[0];
      tokens.push({ text, kind: syntaxTokenKind(text, path), changed: segment.changed });
      if (tokens.length > MAX_SYNTAX_TOKENS_PER_LINE) return plainDiffTokens(segments);
      offset = index + text.length;
    }
    if (offset < segment.text.length) {
      tokens.push({ text: segment.text.slice(offset), kind: 'plain', changed: segment.changed });
      if (tokens.length > MAX_SYNTAX_TOKENS_PER_LINE) return plainDiffTokens(segments);
    }
  }
  return tokens;
}

function plainDiffTokens(segments: readonly DiffTextSegment[]): DiffSyntaxToken[] {
  const nonempty = segments.filter((segment) => segment.text);
  if (nonempty.length > MAX_SYNTAX_TOKENS_PER_LINE) {
    return [{ text: nonempty.map((segment) => segment.text).join(''), kind: 'plain', changed: false }];
  }
  return nonempty.map((segment): DiffSyntaxToken => ({ ...segment, kind: 'plain' }));
}

function syntaxTokenKind(text: string, path: string): DiffSyntaxToken['kind'] {
  if (text.startsWith('//') || (text.startsWith('#') && !path.endsWith('.css') && !path.endsWith('.scss'))) return 'comment';
  if (/^["'`]/.test(text)) return 'string';
  if (/^\d/.test(text)) return 'number';
  if (DIFF_KEYWORDS.has(text)) return 'keyword';
  if (DIFF_LITERALS.has(text)) return 'literal';
  if (/^[A-Z][\w$]*$/.test(text)) return 'type';
  if (/^[{}()[\].,:;<>!=+*/|&?-]$/.test(text)) return 'punctuation';
  return 'plain';
}
