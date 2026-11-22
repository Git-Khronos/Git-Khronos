import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import ts from 'typescript';

// Rust is the only schema. The TypeScript AST adapter keeps existing named
// argument calls ergonomic without parsing Rust or duplicating its signatures.
export function adaptBindings(source) {
  const file = ts.createSourceFile('native.ts', source, ts.ScriptTarget.Latest, true);
  const declaration = file.statements.flatMap(statement => ts.isVariableStatement(statement)
    ? [...statement.declarationList.declarations] : [])
    .find(declaration => declaration.name.getText(file) === 'commands');
  if (!declaration || !ts.isObjectLiteralExpression(declaration.initializer)) throw new Error('Missing generated commands');
  const names = [];
  const entries = declaration.initializer.properties.map(method => {
    if (!ts.isMethodDeclaration(method) || !method.type) throw new Error('Unexpected generated command');
    let command;
    function visit(node) {
      if (ts.isCallExpression(node) && node.expression.getText(file) === 'TAURI_INVOKE'
        && ts.isStringLiteral(node.arguments[0])) command = node.arguments[0].text;
      ts.forEachChild(node, visit);
    }
    visit(method.body);
    if (!command) throw new Error(`Missing native command for ${method.name.getText(file)}`);
    const fields = method.parameters.map(parameter => {
      const name = parameter.name.getText(file), type = parameter.type.getText(file);
      // Tauri accepts absent top-level Option arguments as null.
      const nullable = ts.isUnionTypeNode(parameter.type)
        && parameter.type.types.some(type => type.kind === ts.SyntaxKind.NullKeyword
          || (ts.isLiteralTypeNode(type) && type.literal.kind === ts.SyntaxKind.NullKeyword));
      return { name, type, nullable };
    });
    const args = fields.length
      ? `{ ${fields.map(field => `${field.name}${field.nullable ? '?' : ''}: ${field.type}`).join('; ')} }`
      : '{}';
    const optional = fields.every(field => field.nullable);
    const bind = optional ? '__bindOptionalCommand__' : '__bindCommand__';
    names.push(command);
    return `export const ${command}: (args${optional ? '?' : ''}: ${args}) => ${method.type.getText(file)} = /* @__PURE__ */ ${bind}(${JSON.stringify(command)});`;
  });
  const statement = file.statements.find(statement => ts.isVariableStatement(statement)
    && statement.declarationList.declarations.includes(declaration));
  const payloadsAndEvents = source.slice(0, statement.getStart(file)) + source.slice(statement.end);
  const transport = payloadsAndEvents.replace(/import\s*\{([^}]*\binvoke\s+as\s+TAURI_INVOKE[^}]*)\}\s*from\s*["']@tauri-apps\/api\/core["'];?/, (_, specifiers) => {
    const remaining = specifiers.replace(/\binvoke\s+as\s+TAURI_INVOKE\s*,?/, '').trim();
    return (remaining ? `import { ${remaining} } from "@tauri-apps/api/core";\n` : '')
      + "import { safeInvoke as TAURI_INVOKE } from './safe-json';";
  });
  if (transport === payloadsAndEvents) throw new Error('Missing generated Tauri transport import');
  // Factories share implementation, keep each export independently tree-shakable
  // and retain the previous distinction between required and default-empty calls.
  const binders = `
// Named-argument functions derived from the generated command AST.
function __bindCommand__<Args extends Record<string, unknown>, R>(command: string): (args: Args) => Promise<R> {
  return args => TAURI_INVOKE<R>(command, args);
}
function __bindOptionalCommand__<Args extends Record<string, unknown>, R>(command: string): (args?: Args) => Promise<R> {
  return (args: Args | Record<string, never> = {}) => TAURI_INVOKE<R>(command, args);
}

`;
  const output = transport + '\n' + binders
    + entries.join('\n')
    + '\nexport type CommandMap = {\n' + names.map(name => `  ${name}: typeof ${name};`).join('\n') + '\n};\n';
  // Exported documentation can leave spaces before line breaks. Normalize at
  // generation time so freshness checks and checked-in output stay identical.
  return output.replace(/[ \t]+$/gm, '');
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  const result = spawnSync('cargo', ['run', '--locked', '--quiet', '-p', 'git-khronos-desktop', '--example', 'export-ipc'],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'IPC generation failed');
  const output = adaptBindings(result.stdout);
  const path = 'libs/contracts/src/native.ts';
  if (process.argv.includes('--check')) {
    if (readFileSync(path, 'utf8') !== output) throw new Error('Native IPC bindings are stale. Run pnpm nx run contracts:generate');
    console.log('Native IPC bindings are current.');
  } else {
    writeFileSync(path, output);
    console.log(`Generated ${path}`);
  }
}
