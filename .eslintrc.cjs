module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    node: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
    },
  },
  plugins: ['@typescript-eslint', 'react-hooks'],
  extends: ['eslint:recommended', 'plugin:react-hooks/recommended'],
  ignorePatterns: [
    'out/',
    'release/',
    'test-results/',
    'node_modules/',
  ],
  rules: {
    'no-undef': 'off',
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': ['error', {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_',
    }],
    'react-hooks/exhaustive-deps': 'error',
  },
  overrides: [
    {
      // Renderer layer boundaries. Structural enforcement lives in
      // scripts/check-renderer-structure.mjs; this mirrors the rules in-editor.
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
      // patterns/ may read stores (see patterns/README.md) but must stay above
      // features and outside the app/shell chrome.
      files: ['src/renderer/patterns/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': ['error', {
          patterns: [
            '**/features/**',
            '**/platform/**',
            '**/app/**',
            '**/shell/**',
          ],
        }],
      },
    },
    {
      files: ['src/renderer/{stores,services,hooks}/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': ['error', {
          patterns: [
            '**/features/**',
            '**/ui/**',
            '**/patterns/**',
            '**/app/**',
            '**/shell/**',
          ],
        }],
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
  ],
};
