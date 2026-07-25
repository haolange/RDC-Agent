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
    // Phase 5: restore as warn first; tighten to error after debt clears.
    '@typescript-eslint/no-unused-vars': ['warn', {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_',
    }],
    'react-hooks/exhaustive-deps': 'warn',
  },
};
