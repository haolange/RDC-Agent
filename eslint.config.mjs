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
const hostPlatformMessage = 'Host-specific behavior lives in src/main/platform; use currentHost() or a platform capability.';
const hostEnvNames = '/^(APPDATA|LOCALAPPDATA|USERPROFILE|SystemRoot)$/';
export const hostPlatformRestrictions = [
  "MemberExpression[object.name='process'][property.name=/^(platform|arch)$/]",
  "MemberExpression[object.name='process'][property.value=/^(platform|arch)$/]",
  "CallExpression[callee.object.name='os'][callee.property.name=/^(platform|arch)$/]",
  "ImportDeclaration[source.value=/^(node:)?os$/] > ImportSpecifier[imported.name=/^(platform|arch)$/]",
  `MemberExpression[property.name=${hostEnvNames}]`,
  `MemberExpression[property.value=${hostEnvNames}]`,
  `VariableDeclarator[init.property.name='env'] > ObjectPattern > Property[key.name=${hostEnvNames}]`,
  'Literal[value=/^(taskkill(\\.exe)?|powershell\\.exe)$/i]',
  'Literal[value=/Get-CimInstance/i]',
  'TemplateElement[value.raw=/Get-CimInstance/i]',
].map((selector) => ({ selector, message: hostPlatformMessage }));

// Dependency direction (ARCHITECTURE.md): shared runs in every process, so it imports no Node
// builtins and no process code; platform and provider-catalog are main-process leaves; ipc is the
// outer adapter only the entry point and the browser bridge call into; nothing ships test support.
const MAIN_DOMAINS = [
  'agent-runtime', 'agent-trace', 'browserAppBridge', 'commands', 'conversation', 'hooks', 'investigation',
  'ipc', 'knowledge', 'lifecycle', 'media', 'platform', 'provider-catalog', 'rdc', 'reports', 'runtime',
  'sessions', 'settings', 'testing', 'tools', 'window', 'workers',
];
const mainDomainImport = (domains, message) => ({
  regex: `^(?:@main/|(?:\\.\\./)+)(?:${domains.join('|')})(?:/|$)`,
  message,
});
const noTestingImport = mainDomainImport(['testing'], 'Production code does not import src/main/testing.');
const noIpcImport = mainDomainImport(['ipc'], 'Only the main entry point and the browser bridge call into src/main/ipc.');
const leafImport = (self) => mainDomainImport(
  MAIN_DOMAINS.filter((domain) => domain !== self),
  `src/main/${self} is a leaf: it imports no other main-process domain.`,
);
const NODE_BUILTINS = [
  'assert', 'buffer', 'child_process', 'crypto', 'events', 'fs', 'fs/promises', 'http', 'https', 'net', 'os',
  'path', 'stream', 'url', 'util', 'worker_threads', 'zlib',
];
const mainTestFiles = ['src/main/**/*.test.ts', 'src/main/testing/**'];

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
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'import/order': ['error', {
        groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'type'],
        'newlines-between': 'ignore',
        distinctGroup: false,
      }],
    },
  },
  {
    files: ['src/main/**/*.ts'],
    ignores: ['src/main/**/*.test.ts', 'src/main/**/*.d.ts', 'src/main/agent-runtime/orchestration/AgentOrchestrator.ts'],
    rules: { 'max-lines': ['error', { max: 900, skipBlankLines: false, skipComments: false }] },
  },
  {
    files: ['src/main/**/*.ts', 'src/shared/**/*.ts', 'src/preload/**/*.ts'],
    ignores: ['src/main/platform/**', 'src/preload/index.ts'],
    rules: { 'no-restricted-syntax': ['error', ...hostPlatformRestrictions] },
  },
  {
    files: ['src/shared/**/*.ts'],
    ignores: ['src/shared/**/*.test.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: NODE_BUILTINS.map((name) => ({ name, message: 'shared code runs in the renderer too; it imports no Node builtins.' })),
        patterns: [
          { regex: '^node:', message: 'shared code runs in the renderer too; it imports no Node builtins.' },
          { regex: '^(?:@main/|@renderer/|(?:\\.\\./)+(?:main|renderer|preload)/)', message: 'shared code imports no process code.' },
        ],
      }],
    },
  },
  {
    files: ['src/main/**/*.ts'],
    ignores: [...mainTestFiles, 'src/main/index.ts', 'src/main/ipc/**', 'src/main/browserAppBridge/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [noTestingImport, noIpcImport] }] },
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
    rules: { 'max-lines': ['error', { max: 300, skipBlankLines: false, skipComments: false }] },
  },
  {
    files: [
      'src/renderer/hooks/**/*.ts',
      'src/renderer/services/**/*.ts',
      'src/renderer/stores/**/*.ts',
      'src/renderer/features/**/use*.ts',
    ],
    rules: { 'max-lines': ['error', { max: 200, skipBlankLines: false, skipComments: false }] },
  },
  {
    files: ['src/renderer/ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
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
      }],
    },
  },
  {
    files: ['src/renderer/patterns/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: ['**/features/**', '**/platform/**', '**/app/**', '**/shell/**'],
      }],
      'no-restricted-syntax': ['error', electronApiRestriction],
    },
  },
  {
    files: ['src/renderer/{stores,hooks}/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: ['**/features/**', '**/ui/**', '**/patterns/**', '**/app/**', '**/shell/**'],
      }],
    },
  },
  {
    files: ['src/renderer/services/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'react', message: 'services must not import React.' },
          { name: 'react-dom', message: 'services must not import React.' },
        ],
        patterns: ['**/features/**', '**/ui/**', '**/patterns/**', '**/stores/**', '**/platform/**', '**/app/**', '**/shell/**'],
      }],
      'no-restricted-syntax': ['error', electronApiRestriction],
    },
  },
  {
    files: ['src/renderer/lib/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
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
      }],
    },
  },
  {
    files: [
      'src/shared/constants/blockers.ts',
      'src/shared/constants/blockers.test.ts',
      'src/shared/constants/rdcProbe.ts',
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
];
