import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Keeps renderer IPC calls and native command signatures in sync without a
// code generator: both sides are parsed from source and compared.
const root = join(__dirname, '..', '..');
const nativeDir = join(root, 'src-tauri', 'src');
const rendererDir = join(root, 'src', 'app');
const injectedTypes = /^(?:tauri::)?(?:State|AppHandle|Window|WebviewWindow|ipc::Channel|Channel)\b/;
// Renderer helpers that forward a literal command name to `invoke`. Indexes are
// argument positions; `injected` keys are added by the helper itself.
const wrappers: Record<string, { command: number; extra: number; injected: string[] }> = {
  invoke: { command: 0, extra: 1, injected: [] },
  mutate: { command: 0, extra: 3, injected: ['repoId', 'operationId'] },
  mutateWorkingTree: { command: 0, extra: 3, injected: ['repoId'] },
  remote: { command: 0, extra: 1, injected: ['repoId', 'operationId'] },
  lfs: { command: 0, extra: 1, injected: ['repoId', 'operationId'] },
  changeLock: { command: 1, extra: 2, injected: ['repoId'] },
};

interface NativeCommand { required: Set<string>; optional: Set<string> }
interface RendererCall { wrapper: string; command: string; keys: string[] | null; file: string }

const camel = (name: string) => name.replace(/_([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());

function splitTopLevel(text: string, quotes = '"\'`'): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let quote = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = '';
    } else if (quotes.includes(char)) quote = char;
    else if ('([{<'.includes(char)) depth += 1;
    else if (')]}>'.includes(char) && !(char === '>' && text[index - 1] === '=')) depth -= 1;
    else if (char === ',' && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map(part => part.trim()).filter(Boolean);
}

function balanced(text: string, open: number, quotes = '"\'`'): string {
  const pairs: Record<string, string> = { '(': ')', '{': '}' };
  const closing = pairs[text[open]];
  let depth = 0;
  let quote = '';
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = '';
    } else if (quotes.includes(char)) quote = char;
    else if (char === text[open]) depth += 1;
    else if (char === closing && --depth === 0) return text.slice(open + 1, index);
  }
  throw new Error('Unbalanced source text');
}

function nativeCommands(): Map<string, NativeCommand> {
  const commands = new Map<string, NativeCommand>();
  for (const file of readdirSync(nativeDir).filter(name => name.endsWith('.rs'))) {
    const source = readFileSync(join(nativeDir, file), 'utf8');
    for (const match of source.matchAll(/#\[tauri::command[^\]]*\](?:\s*#\[[^\]]*\])*\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)\s*(?:<[^>]*>)?\s*\(/g)) {
      const parameters = balanced(source, (match.index ?? 0) + match[0].length - 1, '"');
      const command: NativeCommand = { required: new Set(), optional: new Set() };
      for (const parameter of splitTopLevel(parameters, '"')) {
        const [name, ...type] = parameter.split(':');
        const typeText = type.join(':').trim();
        if (injectedTypes.test(typeText)) continue;
        (/^Option</.test(typeText) ? command.optional : command.required).add(camel(name.replace(/^mut\s+/, '').trim()));
      }
      commands.set(match[1], command);
    }
  }
  return commands;
}

function registeredCommands(): Set<string> {
  const source = readFileSync(join(nativeDir, 'lib.rs'), 'utf8');
  const start = source.indexOf('generate_handler![');
  const body = source.slice(start + 'generate_handler!['.length, source.indexOf(']', start));
  return new Set(splitTopLevel(body).map(entry => entry.split('::').pop() ?? entry));
}

function objectKeys(argument: string | undefined): string[] | null {
  if (argument === undefined) return [];
  if (!argument.startsWith('{')) return null;
  const keys: string[] = [];
  for (const entry of splitTopLevel(balanced(argument, 0))) {
    if (entry.startsWith('...')) return null;
    const key = /^['"]?(\w+)['"]?\s*(?::|$)/.exec(entry)?.[1];
    if (!key) return null;
    keys.push(key);
  }
  return keys;
}

function cancelableCommands(): Set<string> {
  const source = readFileSync(join(rendererDir, 'git-chronos.service.ts'), 'utf8');
  const start = source.indexOf('private isCancelableCommand(');
  const list = source.slice(source.indexOf('[', start), source.indexOf('].includes(command)', start));
  return new Set([...list.matchAll(/'(\w+)'/g)].map(match => match[1]));
}

const cancelable = cancelableCommands();

function rendererCalls(): RendererCall[] {
  const calls: RendererCall[] = [];
  const pattern = new RegExp(`\\b(${Object.keys(wrappers).join('|')})(?:<[^(]*?>)?\\(`, 'g');
  for (const file of readdirSync(rendererDir).filter(name => name.endsWith('.ts') && !name.endsWith('.spec.ts'))) {
    const source = readFileSync(join(rendererDir, file), 'utf8');
    for (const match of source.matchAll(pattern)) {
      const before = source.slice(Math.max(0, (match.index ?? 0) - 6), match.index);
      if (match[1] === 'invoke' ? before.endsWith('.') : !/(?:this|git)\.$/.test(before)) continue;
      const spec = wrappers[match[1]];
      const args = splitTopLevel(balanced(source, (match.index ?? 0) + match[0].length - 1));
      const command = /^'(\w+)'$/.exec(args[spec.command] ?? '')?.[1];
      if (!command) continue;
      const keys = objectKeys(args[spec.extra]);
      const injected = spec.injected.filter(key => key !== 'operationId' || cancelable.has(command));
      calls.push({ wrapper: match[1], command, keys: keys && [...keys, ...injected], file });
    }
  }
  return calls;
}

describe('renderer and native IPC contract', () => {
  const native = nativeCommands();
  const registered = registeredCommands();
  const calls = rendererCalls();

  it('registers every declared native command exactly once', () => {
    expect([...registered].filter(name => !native.has(name))).toEqual([]);
    expect([...native.keys()].filter(name => !registered.has(name))).toEqual([]);
  });

  it('only calls registered commands and leaves no registered command unused', () => {
    expect(calls.length).toBeGreaterThan(100);
    expect(calls.filter(call => !registered.has(call.command)).map(call => `${call.file}: ${call.command}`)).toEqual([]);
    const used = new Set(calls.map(call => call.command));
    expect([...registered].filter(name => !used.has(name))).toEqual([]);
  });

  it('lets every cancelable renderer command receive its operation identifier', () => {
    expect(cancelable.size).toBeGreaterThan(5);
    expect([...cancelable].filter(name => !native.get(name)?.optional.has('operationId') && !native.get(name)?.required.has('operationId'))).toEqual([]);
  });

  it('passes exactly the argument names each native command declares', () => {
    const mismatches: string[] = [];
    let checked = 0;
    for (const call of calls) {
      const command = native.get(call.command);
      if (!command || !call.keys) continue;
      checked += 1;
      const keys = new Set(call.keys);
            const unknown = [...keys].filter(key => !command.required.has(key) && !command.optional.has(key));
      const missing = [...command.required].filter(key => !keys.has(key));
      if (unknown.length || missing.length) {
        mismatches.push(`${call.file}: ${call.command} unknown=[${unknown}] missing=[${missing}]`);
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(mismatches).toEqual([]);
  });
});
