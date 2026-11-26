// The desktop preload runs sandboxed: it can require `electron` and nothing else, so an npm package (or a Node
// builtin) anywhere in its runtime import graph leaves the preload script unloadable and the window without its
// bridge. This walks the value imports from src/preload/index.ts and fails on any module outside src/preload and
// src/shared, and on any bare specifier other than `electron`. Type-only imports are erased and are not followed.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const entry = path.join(root, 'src/preload/index.ts');
const allowedRoots = [path.join(root, 'src/preload'), path.join(root, 'src/shared')].map((dir) => dir + path.sep);
const errors = [];

function resolveModule(specifier, from) {
  const base = specifier.startsWith('@shared/')
    ? path.join(root, 'src/shared', specifier.slice('@shared/'.length))
    : path.resolve(path.dirname(from), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Value imports and re-exports of one module; `import type`, `export type` and all-type specifier lists are erased. */
function valueSpecifiers(file) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const specifiers = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      const typeOnly =
        clause?.isTypeOnly ||
        (clause &&
          !clause.name &&
          clause.namedBindings &&
          ts.isNamedImports(clause.namedBindings) &&
          clause.namedBindings.elements.length > 0 &&
          clause.namedBindings.elements.every((element) => element.isTypeOnly));
      if (!typeOnly) specifiers.push(statement.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && !statement.isTypeOnly) {
      const named = statement.exportClause && ts.isNamedExports(statement.exportClause) ? statement.exportClause : null;
      if (!named || named.elements.length === 0 || !named.elements.every((element) => element.isTypeOnly))
        specifiers.push(statement.moduleSpecifier.text);
    }
  }
  return specifiers;
}

const seen = new Set();
const queue = [entry];
while (queue.length) {
  const file = queue.pop();
  if (seen.has(file)) continue;
  seen.add(file);
  const rel = path.relative(root, file);
  for (const specifier of valueSpecifiers(file)) {
    if (specifier === 'electron') continue;
    if (!specifier.startsWith('.') && !specifier.startsWith('@shared/')) {
      errors.push(`${rel} imports ${specifier}; the sandboxed preload can load only electron`);
      continue;
    }
    const resolved = resolveModule(specifier, file);
    if (!resolved) errors.push(`${rel} imports ${specifier}, which does not resolve to a source file`);
    else if (!allowedRoots.some((dir) => resolved.startsWith(dir)))
      errors.push(`${rel} imports ${path.relative(root, resolved)}, outside src/preload and src/shared`);
    else queue.push(resolved);
  }
}

if (errors.length) {
  for (const error of errors) console.error(`[preload-imports] ${error}`);
  process.exit(1);
}
console.log(`[preload-imports] OK (${seen.size} modules, electron only)`);
