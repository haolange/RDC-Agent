import fs from 'node:fs';
import path from 'node:path';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import importPlugin from 'eslint-plugin-import';
import reactHooks from 'eslint-plugin-react-hooks';

const electronApiRestriction = {
  selector: "MemberExpression[object.object.name='window'][object.property.name='electronAPI']",
  message: 'window.electronAPI stays in platform, bootstrap, hooks, stores, app, settings, and feature data modules.',
};

// Host platform gate (docs/architecture/host-platform.md): only src/main/platform reads the
// host OS, and only src/preload/index.ts exposes it to the renderer. PowerShell or cmd command
// text checked by shellHardDeny is command content, not a host check, so the literal ban names
// the host utilities themselves rather than any text that mentions them.
const hostPlatformMessage =
  'Host-specific behavior lives in src/main/platform; use currentHost() or a platform capability.';
const hostEnvNames = '/^(APPDATA|LOCALAPPDATA|USERPROFILE|SystemRoot)$/';
export const hostPlatformRestrictions = [
  "MemberExpression[object.name='process'][property.name=/^(platform|arch)$/]",
  "MemberExpression[object.name='process'][property.value=/^(platform|arch)$/]",
  "CallExpression[callee.object.name='os'][callee.property.name=/^(platform|arch)$/]",
  'ImportDeclaration[source.value=/^(node:)?os$/] > ImportSpecifier[imported.name=/^(platform|arch)$/]',
  `MemberExpression[property.name=${hostEnvNames}]`,
  `MemberExpression[property.value=${hostEnvNames}]`,
  `VariableDeclarator[init.property.name='env'] > ObjectPattern > Property[key.name=${hostEnvNames}]`,
  'Literal[value=/^(taskkill(\\.exe)?|powershell\\.exe)$/i]',
  'Literal[value=/Get-CimInstance/i]',
  'TemplateElement[value.raw=/Get-CimInstance/i]',
].map((selector) => ({ selector, message: hostPlatformMessage }));

// Error contract (docs/contracts/failure-model.md): a failure that crosses a boundary is an AppError with a registered
// code, never a coded message string; a rethrow inside catch keeps what it caught as the cause.
const errorContractMessage = 'Throw new AppError(code, detail) with a code from src/shared/errors/errorCodes.ts.';
export const errorContractRestrictions = [
  {
    selector: "NewExpression[callee.name='Error'] > Literal.arguments:first-child[value=/^[A-Z][A-Z0-9_]{2,}(:|$)/]",
    message: errorContractMessage,
  },
  {
    selector:
      "NewExpression[callee.name='Error'] > TemplateLiteral.arguments:first-child > TemplateElement:first-child[value.raw=/^[A-Z][A-Z0-9_]{2,}(:|$)/]",
    message: errorContractMessage,
  },
  {
    selector:
      "CatchClause[param] ThrowStatement > NewExpression[callee.name='AppError']:not(:has(Property[key.name='cause']))",
    message: 'A rethrow inside catch passes { cause } so the original failure stays inspectable.',
  },
];
// Boundary parsing (ARCHITECTURE.md): parsed JSON is validated with a schema, never cast. `as unknown` stays allowed,
// since it only replaces JSON.parse's `any` with a type that must be narrowed before use.
const jsonParseCall = "CallExpression[callee.object.name='JSON'][callee.property.name='parse']";
const boundaryParseMessage =
  'Parse JSON through a zod schema (or parseJsonValue from @shared/utils/jsonValue) instead of casting it.';
export const boundaryParseRestrictions = [
  `TSAsExpression[typeAnnotation.type!='TSUnknownKeyword'] > ${jsonParseCall}.expression`,
  `TSTypeAssertion[typeAnnotation.type!='TSUnknownKeyword'] > ${jsonParseCall}.expression`,
  `TSAsExpression > TSAsExpression[typeAnnotation.type='TSUnknownKeyword'] > ${jsonParseCall}.expression`,
].map((selector) => ({ selector, message: boundaryParseMessage }));
// Storage primitives (src/main/runtime/atomicFile.ts): persisted files are written through writeFileAtomic and
// renamed only by src/main/platform/fileRename.ts, which owns the host differences.
export const storageRestrictions = [
  {
    selector: 'CallExpression[callee.property.name=/^rename(Sync)?$/]',
    message:
      'Write files with writeFileAtomic (src/main/runtime/atomicFile.ts); move paths with renameWithRetry (src/main/platform/fileRename.ts).',
  },
];
// Renderer colors come from design tokens; a hex literal inside a style prop bypasses theming and contrast checks.
const inlineHexStyleMessage = 'Inline hex color in a style prop; use a design token such as rgb(var(--color-…)).';
export const inlineHexStyleRestrictions = [
  "JSXAttribute[name.name='style'] Literal[value=/#[0-9a-fA-F]{3,8}\\b/]",
  "JSXAttribute[name.name='style'] TemplateElement[value.raw=/#[0-9a-fA-F]{3,8}\\b/]",
].map((selector) => ({ selector, message: inlineHexStyleMessage }));
// Tests assert behavior, not wording: a test that reads source code or the repository's documents to match text pins
// phrasing instead of what the code does (AGENTS.md "测行为与契约"). Fixtures, shipped resources and files a test
// wrote itself stay readable.
const sourceTextMessage =
  'Tests do not read source files or repository documents to assert on their text; test the behavior.';
const readFileCall =
  'CallExpression:matches([callee.name=/^readFile(Sync)?$/], [callee.property.name=/^readFile(Sync)?$/])';
const sourceOrDocumentPath =
  '/\\.(tsx?|mjs|cjs)$|(^|\\/)docs\\/|(^|\\/)(AGENTS|ARCHITECTURE|DESIGN|README(\\.en)?)\\.md$/';
export const sourceTextRestrictions = [
  `${readFileCall} Literal[value=${sourceOrDocumentPath}]`,
  `${readFileCall} TemplateElement[value.raw=${sourceOrDocumentPath}]`,
].map((selector) => ({ selector, message: sourceTextMessage }));
const testSources = ['src/**/*.test.{ts,tsx}', 'src/main/testing/**/*.ts'];
// Production code, as check-module-graph counts it: everything under src except tests, test support directories
// (testing/, fixtures/, __fixtures__/) and declaration files.
export const productionCode = {
  files: ['src/**/*.{ts,tsx}'],
  ignores: ['src/**/*.test.{ts,tsx}', 'src/**/{testing,fixtures,__fixtures__}/**', 'src/**/*.d.ts'],
};

// Function budgets (AGENTS.md §5): every production function stays within `budget` in scripts/function-budgets.json
// (lines without blank lines and comments, cyclomatic complexity, parameters). A file listed in `exceptions` is held
// at the largest value measured in it, so its functions cannot grow either; scripts/check-function-budgets.mjs keeps
// each entry at that measured maximum, so the list only shrinks.
export const functionBudgets = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, 'scripts/function-budgets.json'), 'utf8'),
);
export const functionBudgetRules = ({ lines, complexity, params }) => ({
  'max-lines-per-function': ['error', { max: lines, skipBlankLines: true, skipComments: true, IIFEs: true }],
  complexity: ['error', complexity],
  'max-params': ['error', params],
});

// Dependency direction (ARCHITECTURE.md): shared runs in every process, so it imports no Node
// builtins and no process code; platform and provider-catalog are main-process leaves; ipc is the
// outer adapter only the entry point and the browser bridge call into; nothing ships test support.
const MAIN_DOMAINS = [
  'agent-runtime',
  'agent-trace',
  'browserAppBridge',
  'commands',
  'conversation',
  'hooks',
  'investigation',
  'ipc',
  'knowledge',
  'lifecycle',
  'media',
  'platform',
  'provider-catalog',
  'rdc',
  'reports',
  'runtime',
  'sessions',
  'settings',
  'testing',
  'tools',
  'window',
  'workers',
];
const mainDomainImport = (domains, message) => ({
  regex: `^(?:@main/|(?:\\.\\./)+)(?:${domains.join('|')})(?:/|$)`,
  message,
});
const noTestingImport = mainDomainImport(['testing'], 'Production code does not import src/main/testing.');
const noIpcImport = mainDomainImport(
  ['ipc'],
  'Only the main entry point and the browser bridge call into src/main/ipc.',
);
const leafImport = (self) =>
  mainDomainImport(
    MAIN_DOMAINS.filter((domain) => domain !== self),
    `src/main/${self} is a leaf: it imports no other main-process domain.`,
  );
// Main-process domain direction (ARCHITECTURE.md "进程间与主进程依赖方向"): a domain imports only domains in lower
// layers, so the domain graph has no cycle. Peers in one layer do not import each other. Type-only imports carry no
// runtime dependency and are allowed. Files directly under src/main (index.ts) are the composition root, above all.
export const MAIN_DOMAIN_LAYERS = [
  ['platform', 'provider-catalog', 'lifecycle'],
  ['runtime'],
  ['hooks'],
  ['settings'],
  ['window', 'tools', 'media'],
  ['sessions'],
  ['rdc'],
  ['investigation'],
  ['reports'],
  ['knowledge'],
  ['agent-runtime'],
  ['agent-trace', 'workers'],
  ['conversation'],
  ['commands'],
  ['ipc'],
  ['browserAppBridge'],
];
const MAIN_ROOT = path.join(import.meta.dirname, 'src/main');
const mainDomainLayer = new Map(
  MAIN_DOMAIN_LAYERS.flatMap((domains, layer) => domains.map((domain) => [domain, layer])),
);
for (const entry of fs.readdirSync(MAIN_ROOT, { withFileTypes: true })) {
  if (entry.isDirectory() && entry.name !== 'testing' && !mainDomainLayer.has(entry.name)) {
    throw new Error(`eslint.config.mjs: src/main/${entry.name} has no layer in MAIN_DOMAIN_LAYERS.`);
  }
}
const mainDomainOf = (absolutePath) => {
  const [first, ...rest] = path.relative(MAIN_ROOT, absolutePath).split(path.sep);
  return first && first !== '..' && (rest.length > 0 || mainDomainLayer.has(first)) ? first : null;
};
const mainDomainDirection = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      upward:
        'src/main/{{from}} (layer {{fromLayer}}) must not import src/main/{{to}} (layer {{toLayer}}): a domain imports only ' +
        'lower layers. Move the shared primitive down (src/main/runtime for primitives) or bind the implementation at ' +
        'the composition root.',
    },
  },
  create(context) {
    const from = mainDomainOf(context.filename);
    if (!from || !mainDomainLayer.has(from)) return {};
    const check = (node, source, typeOnly) => {
      if (typeOnly || typeof source !== 'string') return;
      const target = source.startsWith('@main/')
        ? path.join(MAIN_ROOT, source.slice(6))
        : source.startsWith('.')
          ? path.resolve(path.dirname(context.filename), source)
          : null;
      const to = target ? mainDomainOf(target) : null;
      if (!to || to === from || !mainDomainLayer.has(to)) return;
      const fromLayer = mainDomainLayer.get(from);
      const toLayer = mainDomainLayer.get(to);
      if (toLayer >= fromLayer) context.report({ node, messageId: 'upward', data: { from, to, fromLayer, toLayer } });
    };
    const typeOnlyImport = (node) =>
      node.importKind === 'type' ||
      (node.specifiers.length > 0 &&
        node.specifiers.every((spec) => spec.type === 'ImportSpecifier' && spec.importKind === 'type'));
    return {
      ImportDeclaration: (node) => check(node, node.source.value, typeOnlyImport(node)),
      ExportNamedDeclaration: (node) => node.source && check(node, node.source.value, node.exportKind === 'type'),
      ExportAllDeclaration: (node) => check(node, node.source.value, node.exportKind === 'type'),
      ImportExpression: (node) => node.source.type === 'Literal' && check(node, node.source.value, false),
    };
  },
};
const NODE_BUILTINS = [
  'assert',
  'buffer',
  'child_process',
  'crypto',
  'events',
  'fs',
  'fs/promises',
  'http',
  'https',
  'net',
  'os',
  'path',
  'stream',
  'url',
  'util',
  'worker_threads',
  'zlib',
];
const mainTestFiles = ['src/main/**/*.test.ts', 'src/main/testing/**'];

// No file-level import cycle in production code (ARCHITECTURE.md Verification Gate): import/no-cycle follows value
// imports (type-only imports carry no runtime edge) through relative paths and the tsconfig aliases, resolved by
// scripts/lib/eslint-import-resolver.cjs. IMPORT_CYCLE_PENDING names the files still on a cycle and why; the list only
// shrinks, and scripts/check-import-cycles.mjs fails while a listed file is off every cycle, gone or outside the rule.
export const importCycleLint = {
  ...productionCode,
  settings: {
    'import/extensions': ['.ts', '.tsx', '.js', '.mjs'],
    'import/parsers': { '@typescript-eslint/parser': ['.ts', '.tsx'] },
    'import/resolver': { [path.join(import.meta.dirname, 'scripts/lib/eslint-import-resolver.cjs')]: {} },
  },
  rules: { 'import/no-cycle': 'error' },
};
export const IMPORT_CYCLE_PENDING = {};

// One typed program for all of src (src/tsconfig.lint.json, read only by ESLint): the repository settings plus
// noUncheckedIndexedAccess, so a lookup that can miss stays guarded. Every typed rule below uses it, so no file is
// parsed by two TypeScript programs.
const typedLintProgram = {
  parserOptions: {
    project: './src/tsconfig.lint.json',
    tsconfigRootDir: import.meta.dirname,
  },
};
// Inside the boundaries the types are the contract (ARCHITECTURE.md Verification Gate): production code in every
// process runs no-unnecessary-condition, so a null check, optional chain, fallback or branch the types already rule out
// is an error. UNNECESSARY_CONDITION_PENDING names the files still exempt and why; the list only shrinks, and
// scripts/check-unnecessary-condition.mjs fails while a listed file is clean, gone or outside the rule.
export const typedLint = {
  ...productionCode,
  languageOptions: typedLintProgram,
  rules: {
    '@typescript-eslint/no-unnecessary-condition': ['error', { allowConstantLoopConditions: 'only-allowed-literals' }],
  },
};
export const UNNECESSARY_CONDITION_PENDING = {
  'src/main/runtime/AppPathService.ts':
    'Electron types app and process.resourcesPath as always present, but main-process ' +
    'modules also run under vitest without Electron, where both are undefined; the guards stay until those runs ' +
    'provide them',
};

export default [
  {
    ignores: ['out/**', 'release/**', 'node_modules/**', 'coverage/**', 'dist/**'],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
      import: importPlugin,
    },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'type'],
          'newlines-between': 'ignore',
          distinctGroup: false,
        },
      ],
    },
  },
  {
    ...productionCode,
    rules: {
      'no-restricted-syntax': [
        'error',
        ...errorContractRestrictions,
        ...boundaryParseRestrictions,
        ...inlineHexStyleRestrictions,
      ],
      'preserve-caught-error': ['error', { requireCatchParameter: false }],
    },
  },
  { ...productionCode, rules: functionBudgetRules(functionBudgets.budget) },
  ...Object.entries(functionBudgets.exceptions).map(([file, limits]) => ({
    files: [file],
    rules: functionBudgetRules({ ...functionBudgets.budget, ...limits }),
  })),
  {
    files: ['src/main/**/*.ts'],
    ignores: [
      'src/main/**/*.test.ts',
      'src/main/**/*.d.ts',
      'src/main/agent-runtime/orchestration/AgentOrchestrator.ts',
    ],
    rules: { 'max-lines': ['error', { max: 900, skipBlankLines: false, skipComments: false }] },
  },
  {
    files: ['src/main/**/*.ts', 'src/shared/**/*.ts', 'src/preload/**/*.ts'],
    ignores: ['src/main/platform/**', 'src/preload/index.ts'],
    rules: { 'no-restricted-syntax': ['error', ...hostPlatformRestrictions] },
  },
  {
    files: ['src/main/**/*.ts', 'src/shared/**/*.ts', 'src/preload/**/*.ts'],
    ignores: [...productionCode.ignores, 'src/main/platform/**', 'src/preload/index.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...hostPlatformRestrictions,
        ...errorContractRestrictions,
        ...boundaryParseRestrictions,
        ...storageRestrictions,
      ],
    },
  },
  {
    files: ['src/shared/**/*.ts'],
    ignores: ['src/shared/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: NODE_BUILTINS.map((name) => ({
            name,
            message: 'shared code runs in the renderer too; it imports no Node builtins.',
          })),
          patterns: [
            { regex: '^node:', message: 'shared code runs in the renderer too; it imports no Node builtins.' },
            {
              regex: '^(?:@main/|@renderer/|(?:\\.\\./)+(?:main|renderer|preload)/)',
              message: 'shared code imports no process code.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/main/**/*.ts'],
    ignores: [...mainTestFiles, 'src/main/index.ts', 'src/main/ipc/**', 'src/main/browserAppBridge/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [noTestingImport, noIpcImport] }] },
  },
  {
    files: ['src/main/**/*.ts'],
    ignores: [...mainTestFiles, 'src/main/**/*.d.ts'],
    plugins: { 'main-domains': { rules: { direction: mainDomainDirection } } },
    rules: { 'main-domains/direction': 'error' },
  },
  {
    files: ['src/main/ipc/**/*.ts', 'src/main/browserAppBridge/**/*.ts'],
    ignores: mainTestFiles,
    rules: { 'no-restricted-imports': ['error', { patterns: [noTestingImport] }] },
  },
  {
    files: ['src/main/platform/**/*.ts'],
    ignores: mainTestFiles,
    rules: { 'no-restricted-imports': ['error', { patterns: [leafImport('platform')] }] },
  },
  {
    files: ['src/main/provider-catalog/**/*.ts'],
    ignores: mainTestFiles,
    rules: { 'no-restricted-imports': ['error', { patterns: [leafImport('provider-catalog')] }] },
  },
  {
    files: ['src/main/agent-runtime/orchestration/AgentOrchestrator.ts'],
    rules: { 'max-lines': ['error', { max: 799, skipBlankLines: false, skipComments: false }] },
  },
  {
    files: ['src/renderer/**/*.tsx'],
    ignores: ['src/renderer/**/*.test.tsx'],
    rules: { 'max-lines': ['error', { max: 300, skipBlankLines: false, skipComments: false }] },
  },
  {
    files: [
      'src/renderer/hooks/**/*.ts',
      'src/renderer/services/**/*.ts',
      'src/renderer/stores/**/*.ts',
      'src/renderer/features/**/use*.ts',
    ],
    ignores: ['src/renderer/**/*.test.ts'],
    rules: { 'max-lines': ['error', { max: 200, skipBlankLines: false, skipComments: false }] },
  },
  {
    files: ['src/renderer/ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            '**/features/**',
            '**/patterns/**',
            '**/stores/**',
            '**/services/**',
            '**/platform/**',
            '**/hooks/**',
            '**/app/**',
            '**/shell/**',
          ],
        },
      ],
    },
  },
  {
    files: ['src/renderer/patterns/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: ['**/features/**', '**/platform/**', '**/app/**', '**/shell/**'],
        },
      ],
      'no-restricted-syntax': [
        'error',
        electronApiRestriction,
        ...errorContractRestrictions,
        ...boundaryParseRestrictions,
        ...inlineHexStyleRestrictions,
      ],
    },
  },
  {
    files: ['src/renderer/{stores,hooks}/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: ['**/features/**', '**/ui/**', '**/patterns/**', '**/app/**', '**/shell/**'],
        },
      ],
    },
  },
  {
    files: ['src/renderer/services/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'services must not import React.' },
            { name: 'react-dom', message: 'services must not import React.' },
          ],
          patterns: [
            '**/features/**',
            '**/ui/**',
            '**/patterns/**',
            '**/stores/**',
            '**/platform/**',
            '**/app/**',
            '**/shell/**',
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        electronApiRestriction,
        ...errorContractRestrictions,
        ...boundaryParseRestrictions,
      ],
    },
  },
  {
    files: ['src/renderer/lib/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            '**/features/**',
            '**/ui/**',
            '**/patterns/**',
            '**/stores/**',
            '**/services/**',
            '**/platform/**',
            '**/app/**',
            '**/shell/**',
          ],
        },
      ],
    },
  },
  {
    // An unobserved rejection in main is an unreported failure: every promise is awaited, handled or explicitly voided.
    files: ['src/main/**/*.ts', 'src/shared/constants/rdcProbe.ts'],
    ignores: ['src/main/**/*.test.ts'],
    languageOptions: typedLintProgram,
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
  {
    ...typedLint,
    ignores: [...typedLint.ignores, ...Object.keys(UNNECESSARY_CONDITION_PENDING)],
  },
  {
    ...importCycleLint,
    ignores: [...importCycleLint.ignores, ...Object.keys(IMPORT_CYCLE_PENDING)],
  },
  {
    files: testSources,
    rules: { 'no-restricted-syntax': ['error', ...sourceTextRestrictions] },
  },
  {
    // Main, shared and preload tests outside src/main/platform keep the host-platform gate as well.
    files: ['src/main/**/*.test.ts', 'src/main/testing/**/*.ts', 'src/shared/**/*.test.ts', 'src/preload/**/*.test.ts'],
    ignores: ['src/main/platform/**'],
    rules: { 'no-restricted-syntax': ['error', ...hostPlatformRestrictions, ...sourceTextRestrictions] },
  },
];
