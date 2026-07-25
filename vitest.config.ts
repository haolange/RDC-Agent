import { defineConfig } from 'vitest/config';
import path from 'path';
import { providerCatalogVitePlugin } from './src/main/provider-catalog/providerCatalogVitePlugin';

export default defineConfig({
  plugins: [providerCatalogVitePlugin(__dirname)],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globalSetup: ['./scripts/vitest-global-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // Phase 5 baseline thresholds — raise gradually as suites expand.
      // Impact: `pnpm run test:coverage` fails when below; default `pnpm test` is unaffected.
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 50,
      },
    },
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@main': path.resolve(__dirname, 'src/main'),
      '@renderer': path.resolve(__dirname, 'src/renderer'),
    },
  },
});
