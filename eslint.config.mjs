import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import importPlugin from 'eslint-plugin-import';
import reactHooks from 'eslint-plugin-react-hooks';

const electronApiRestriction = {
  selector: "MemberExpression[object.object.name='window'][object.property.name='electronAPI']",
  message: 'window.electronAPI stays in platform, bootstrap, hooks, stores, app, settings, and feature data modules.',
};

export default [
  {
    ignores: ['out/**', 'release/**', 'node_modules/**', 'coverage/**', 'dist/**'],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
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
      'import/order': ['warn', {
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
