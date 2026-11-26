#!/usr/bin/env node
/**
 * Module graph gate (AGENTS.md §5). Two kinds of production code that only add surface are rejected:
 *
 * - Unreachable modules. Every production module under src/ must be reachable through imports from a shipped entry
 *   point (the electron-vite inputs) or from the build, scripts and design-system previews that consume source
 *   directly. A module that only tests import is test support living in the production tree and belongs under a
 *   testing/ directory; a module nothing imports is dead.
 * - Forwarding layers. A class whose public methods mostly pass their parameters unchanged to one call on a member,
 *   and a module whose every exported function passes its parameters unchanged to an imported function, add a name
 *   without behaviour; callers depend on the owner directly. The AgentOrchestrator façade is measured by
 *   check-orchestrator-facade instead.
 *
 * Tests, testing/, fixtures/ and __fixtures__/ directories and declaration files are outside the production tree, as
 * in the coverage configuration.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** What ships: the electron-vite inputs, plus the dev style module vite.renderer.config.ts injects by path. */
const SHIPPED_ENTRIES = [
  'src/main/index.ts',
  'src/main/workers/grepRegexWorker.ts',
  'src/main/workers/turnPreparationWorker.ts',
  'src/preload/index.ts',
  'src/renderer/main.tsx',
  'src/renderer/platform/devStyles.ts',
];
const TOOLING_CONFIGS = ['electron.vite.config.ts', 'vite.renderer.config.ts', 'vitest.config.ts'];
const TOOLING_DIRECTORIES = ['scripts', 'designs'];
const FACADES = new Set(['src/main/agent-runtime/orchestration/AgentOrchestrator.ts']);
/** A class is a forwarding layer when it has at least this many public methods and this share of them forward. */
const CLASS_MIN_METHODS = 3;
const CLASS_FORWARD_SHARE = 0.6;

const toRelative = (file) => path.relative(repoRoot, file).split(path.sep).join('/');
const isOutsideProduction = (relative) =>
  /\.test\.tsx?$/.test(relative) ||
  relative.endsWith('.d.ts') ||
  /(^|\/)(testing|fixtures|__fixtures__)\//.test(relative);

function walk(directory, out = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const tsconfig = ts.readConfigFile(path.join(repoRoot, 'tsconfig.json'), ts.sys.readFile);
const compilerOptions = {
  ...ts.parseJsonConfigFileContent(tsconfig.config, ts.sys, repoRoot).options,
  allowJs: true,
};

const sourceFiles = new Map();
function parse(relative) {
  if (!sourceFiles.has(relative)) {
    const absolute = path.join(repoRoot, relative);
    sourceFiles.set(
      relative,
      ts.createSourceFile(absolute, fs.readFileSync(absolute, 'utf8'), ts.ScriptTarget.Latest, true),
    );
  }
  return sourceFiles.get(relative);
}

function moduleSpecifiers(sourceFile) {
  const specifiers = [];
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      specifiers.push(node.arguments[0].text);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      specifiers.push(node.argument.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}

const importsCache = new Map();
function importsOf(relative) {
  if (!importsCache.has(relative)) {
    const containing = path.join(repoRoot, relative);
    const targets = [];
    for (const specifier of moduleSpecifiers(parse(relative))) {
      const resolved = ts.resolveModuleName(
        specifier.replace(/\?.*$/, ''),
        containing,
        compilerOptions,
        ts.sys,
      ).resolvedModule;
      if (!resolved || resolved.isExternalLibraryImport) continue;
      const target = toRelative(resolved.resolvedFileName);
      if (!target.startsWith('..') && !target.includes('node_modules/')) targets.push(target);
    }
    importsCache.set(relative, targets);
  }
  return importsCache.get(relative);
}

function reachableFrom(roots) {
  const seen = new Set();
  const pending = roots.filter((root) => fs.existsSync(path.join(repoRoot, root)));
  while (pending.length > 0) {
    const current = pending.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    pending.push(...importsOf(current));
  }
  return seen;
}

const productionModules = walk(path.join(repoRoot, 'src'))
  .map(toRelative)
  .filter((relative) => /\.tsx?$/.test(relative) && !isOutsideProduction(relative))
  .sort();
const toolingRoots = [
  ...TOOLING_CONFIGS,
  ...TOOLING_DIRECTORIES.flatMap((directory) => walk(path.join(repoRoot, directory)).map(toRelative)).filter(
    (relative) => /\.(mjs|cjs|js|ts|tsx)$/.test(relative),
  ),
];
const reachable = reachableFrom([...SHIPPED_ENTRIES, ...toolingRoots]);
const importedBy = new Map();
for (const relative of walk(path.join(repoRoot, 'src'))
  .map(toRelative)
  .filter((file) => /\.tsx?$/.test(file))) {
  for (const target of importsOf(relative)) {
    if (!importedBy.has(target)) importedBy.set(target, []);
    importedBy.get(target).push(relative);
  }
}

const problems = [];
for (const relative of productionModules) {
  if (reachable.has(relative)) continue;
  const importers = importedBy.get(relative) ?? [];
  const productionImporters = importers.filter((importer) => !isOutsideProduction(importer));
  if (importers.length === 0) problems.push(`${relative} is imported by nothing; delete it`);
  else if (productionImporters.length === 0) {
    problems.push(
      `${relative} is imported only by tests (${importers.slice(0, 2).join(', ')}); move it under a testing/ directory or delete it`,
    );
  } else {
    problems.push(
      `${relative} is imported only by unreachable modules (${productionImporters.slice(0, 2).join(', ')})`,
    );
  }
}

/** The call a function makes when its whole body passes its own parameters, unchanged and in order, to one call. */
function forwardedCallee(fn) {
  if (!fn.body) return null;
  let expression = null;
  if (ts.isBlock(fn.body)) {
    if (fn.body.statements.length !== 1) return null;
    const [statement] = fn.body.statements;
    if (ts.isReturnStatement(statement)) expression = statement.expression ?? null;
    else if (ts.isExpressionStatement(statement)) expression = statement.expression;
  } else {
    expression = fn.body;
  }
  if (expression && ts.isAwaitExpression(expression)) expression = expression.expression;
  if (!expression || !ts.isCallExpression(expression)) return null;
  const parameters = fn.parameters.map((parameter) => (ts.isIdentifier(parameter.name) ? parameter.name.text : null));
  if (parameters.includes(null) || expression.arguments.length !== parameters.length) return null;
  const passedThrough = expression.arguments.every((argument, index) => {
    const name = ts.isSpreadElement(argument) ? argument.expression : argument;
    return ts.isIdentifier(name) && name.text === parameters[index];
  });
  return passedThrough ? expression.expression.getText() : null;
}

const hasModifier = (node, kind) =>
  (ts.getModifiers?.(node) ?? node.modifiers ?? []).some((modifier) => modifier.kind === kind);

for (const relative of productionModules) {
  if (FACADES.has(relative)) continue;
  const sourceFile = parse(relative);
  const visitClasses = (node) => {
    if (ts.isClassDeclaration(node)) {
      const methods = node.members.filter(
        (member) =>
          ts.isMethodDeclaration(member) &&
          member.body &&
          !hasModifier(member, ts.SyntaxKind.PrivateKeyword) &&
          !hasModifier(member, ts.SyntaxKind.StaticKeyword),
      );
      const forwarding = methods.filter((method) => /^this\.\w+\.\w+$/.test(forwardedCallee(method) ?? ''));
      if (methods.length >= CLASS_MIN_METHODS && forwarding.length / methods.length >= CLASS_FORWARD_SHARE) {
        problems.push(
          `${relative}: class ${node.name?.text ?? '(anonymous)'} forwards ${forwarding.length} of ${methods.length} public methods to members; callers use the owner directly`,
        );
      }
    }
    ts.forEachChild(node, visitClasses);
  };
  visitClasses(sourceFile);

  const importedValues = new Set();
  const exportedFunctions = [];
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause && !statement.importClause.isTypeOnly) {
      const { name, namedBindings } = statement.importClause;
      if (name) importedValues.add(name.text);
      if (namedBindings && ts.isNamespaceImport(namedBindings)) importedValues.add(namedBindings.name.text);
      if (namedBindings && ts.isNamedImports(namedBindings)) {
        for (const element of namedBindings.elements) if (!element.isTypeOnly) importedValues.add(element.name.text);
      }
    }
    if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue;
    if (ts.isFunctionDeclaration(statement)) exportedFunctions.push(statement);
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const initializer = declaration.initializer;
        if (initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)))
          exportedFunctions.push(initializer);
      }
    }
  }
  const forwardsImport = (fn) => importedValues.has((forwardedCallee(fn) ?? '').split('.')[0]);
  if (exportedFunctions.length >= 2 && exportedFunctions.every(forwardsImport)) {
    problems.push(`${relative}: every exported function forwards to an import; callers use the owner directly`);
  }
}

if (problems.length > 0) {
  console.error(`[module-graph] ${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`[module-graph] OK (${productionModules.length} production modules reachable, no forwarding layers)`);
