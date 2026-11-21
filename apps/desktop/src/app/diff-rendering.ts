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

export interface DiffLine {
  text: string;
  kind: 'addition' | 'deletion' | 'hunk' | 'header' | 'context';
  oldLine: number | null;
  newLine: number | null;
  hunkIndex: number | null;
  changeIndices: number[];
  segments: DiffTextSegment[];
  tokens: DiffSyntaxToken[];
}

export interface SplitDiffRow {
  kind: 'pair' | 'header' | 'hunk';
  left: DiffLine | null;
  right: DiffLine | null;
  label: string | null;
  hunkIndex: number | null;
}

export function renderDiffLines(patch: string | null | undefined, path: string): DiffLine[] {
  if (!patch) return [];
  const patchLines = patch.split('\n');
  // split() adds an empty entry for the patch's terminating newline. A
  // real empty context line has its own row, even with suppressBlankEmpty.
  if (patchLines.at(-1) === '') patchLines.pop();
  const decorate = shouldDecorateDiff(patch.length, patchLines.length);
  let oldLine = 0;
  let newLine = 0;
  let hunkIndex = 0;
  let currentHunkIndex: number | null = null;
  let changeIndex = 0;
  const lines = patchLines.map((text): DiffLine => {
    if (text.startsWith('diff --git ')) currentHunkIndex = null;
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      currentHunkIndex = hunkIndex++;
      changeIndex = 0;
      return { text, kind: 'hunk', oldLine: null, newLine: null, hunkIndex: currentHunkIndex, changeIndices: [], segments: [], tokens: [] };
    }
    // Only the first byte of a hunk body identifies a change. Content
    // starting with ++ or -- must still advance the native change index.
    // Backslash notices (such as a missing final newline) consume neither
    // a source line nor a change index.
    if (currentHunkIndex === null || text.startsWith('\\ ')) {
      return { text, kind: 'header', oldLine: null, newLine: null, hunkIndex: null, changeIndices: [], segments: [], tokens: [] };
    }
    if (text.startsWith('+')) {
      return { text, kind: 'addition', oldLine: null, newLine: newLine++, hunkIndex: currentHunkIndex, changeIndices: [changeIndex++], segments: [], tokens: [] };
    }
    if (text.startsWith('-')) {
      return { text, kind: 'deletion', oldLine: oldLine++, newLine: null, hunkIndex: currentHunkIndex, changeIndices: [changeIndex++], segments: [], tokens: [] };
    }
    const line: DiffLine = { text, kind: 'context', oldLine, newLine, hunkIndex: currentHunkIndex, changeIndices: [], segments: [], tokens: [] };
    oldLine += 1;
    newLine += 1;
    return line;
  });

  let index = 0;
  while (index < lines.length) {
    if (lines[index].kind !== 'deletion') {
      index += 1;
      continue;
    }
    const { deletions, additions, next } = diffReplacementRun(lines, index);
    index = next;
    for (let pair = 0; pair < Math.min(deletions.length, additions.length); pair += 1) {
      const group = [...deletions[pair].changeIndices, ...additions[pair].changeIndices];
      deletions[pair].changeIndices = group;
      additions[pair].changeIndices = group;
      if (decorate) {
        const [left, right] = wordDiffSegments(deletions[pair].text, additions[pair].text);
        deletions[pair].segments = left;
        additions[pair].segments = right;
      }
    }
  }

  for (const line of lines) {
    if (!line.segments.length) line.segments = [{ text: line.text, changed: false }];
    line.tokens = decorate
      ? tokenizeDiffLine(line.segments, path)
      : [{ text: line.text, kind: 'plain', changed: false }];
  }
  return lines;
}

export function splitRenderedDiff(lines: readonly DiffLine[]): SplitDiffRow[] {
  const rows: SplitDiffRow[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.kind === 'header' || line.kind === 'hunk') {
      rows.push({ kind: line.kind, left: null, right: null, label: line.text, hunkIndex: line.hunkIndex });
      index += 1;
      continue;
    }
    if (line.kind === 'deletion') {
      const { deletions, additions, notices, next } = diffReplacementRun(lines, index);
      index = next;
      const count = Math.max(deletions.length, additions.length);
      for (let pair = 0; pair < count; pair += 1) {
        rows.push({ kind: 'pair', left: deletions[pair] ?? null, right: additions[pair] ?? null, label: null, hunkIndex: null });
      }
      for (const notice of notices) {
        rows.push({ kind: 'header', left: null, right: null, label: notice, hunkIndex: null });
      }
      continue;
    }
    if (line.kind === 'addition') {
      rows.push({ kind: 'pair', left: null, right: line, label: null, hunkIndex: null });
    } else {
      rows.push({ kind: 'pair', left: line, right: line, label: null, hunkIndex: null });
    }
    index += 1;
  }
  return rows;
}

function diffReplacementRun(lines: readonly DiffLine[], start: number) {
  const notices: string[] = [];
  let next = start;
  const take = (kind: 'deletion' | 'addition', side: string): DiffLine[] => {
    const rows: DiffLine[] = [];
    while (lines[next]?.kind === kind) {
      rows.push(lines[next++]);
      if (lines[next]?.kind === 'header' && lines[next].text.startsWith('\\ ')) {
        notices.push(`${side}: ${lines[next++].text.slice(2)}`);
      }
    }
    return rows;
  };
  const deletions = take('deletion', 'Before');
  const additions = take('addition', 'After');
  return { deletions, additions, notices, next };
}

function wordDiffSegments(left: string, right: string): [DiffTextSegment[], DiffTextSegment[]] {
  const leftMarker = left.slice(0, 1);
  const rightMarker = right.slice(0, 1);
  const leftWords = splitDiffWords(left.slice(1));
  const rightWords = splitDiffWords(right.slice(1));
  if (leftWords.length * rightWords.length > 16_000) {
    return [
      [{ text: leftMarker, changed: false }, { text: left.slice(1), changed: true }],
      [{ text: rightMarker, changed: false }, { text: right.slice(1), changed: true }],
    ];
  }
  const table = Array.from({ length: leftWords.length + 1 }, () => new Uint16Array(rightWords.length + 1));
  for (let leftIndex = leftWords.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = rightWords.length - 1; rightIndex >= 0; rightIndex -= 1) {
      table[leftIndex][rightIndex] = leftWords[leftIndex] === rightWords[rightIndex]
        ? table[leftIndex + 1][rightIndex + 1] + 1
        : Math.max(table[leftIndex + 1][rightIndex], table[leftIndex][rightIndex + 1]);
    }
  }
  const leftSegments: DiffTextSegment[] = [{ text: leftMarker, changed: false }];
  const rightSegments: DiffTextSegment[] = [{ text: rightMarker, changed: false }];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < leftWords.length || rightIndex < rightWords.length) {
    if (leftWords[leftIndex] === rightWords[rightIndex]) {
      appendDiffSegment(leftSegments, leftWords[leftIndex], false);
      appendDiffSegment(rightSegments, rightWords[rightIndex], false);
      leftIndex += 1;
      rightIndex += 1;
    } else if (rightIndex >= rightWords.length || (leftIndex < leftWords.length && table[leftIndex + 1][rightIndex] >= table[leftIndex][rightIndex + 1])) {
      appendDiffSegment(leftSegments, leftWords[leftIndex++], true);
    } else {
      appendDiffSegment(rightSegments, rightWords[rightIndex++], true);
    }
  }
  return [leftSegments, rightSegments];
}

function splitDiffWords(text: string): string[] {
  return text.match(/\s+|[\p{L}\p{N}_$]+|./gu) ?? [];
}

function appendDiffSegment(segments: DiffTextSegment[], text: string | undefined, changed: boolean): void {
  if (!text) return;
  const previous = segments.at(-1);
  if (previous?.changed === changed) previous.text += text;
  else segments.push({ text, changed });
}
