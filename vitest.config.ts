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
      reporter: ['text', 'lcov', 'json-summary'],
      reportsDirectory: './coverage',
      // Node unit-test surface: main + shared. Renderer validated via browser QA + check:*.
      include: ['src/main/**/*.{ts,tsx}', 'src/shared/**/*.{ts,tsx}'],
      exclude: [
        '**/*.test.ts',
        '**/fixtures/**',
        '**/__fixtures__/**',
        '**/generated/**',
        '**/*.generated.ts',
        '**/dist/**',
        // Electron / process entry glue — not a meaningful node unit-test surface.
        'src/main/index.ts',
        'src/main/**/index.ts',
        'src/main/ipc/*Handlers.ts',
        'src/main/ipc/handlers.ts',
        'src/main/ipc/sessionOutputs.ts',
        'src/main/ipc/channels.ts',
        'src/main/ipc/HandshakeRegistry.ts',
        // Bridge HTTP server + SSE hub: browser QA / smoke; keep unit coverage on bridgeSecurity + proxy.
        'src/main/browserAppBridge/BrowserAppBridgeServer.ts',
        'src/main/browserAppBridge/rendererEventHub.ts',
        'src/main/telemetry/**',
        // Worker threads / pool glue — integration / process bound.
        'src/main/workers/turnPreparationWorker.ts',
        'src/main/workers/TurnPreparationWorkerPool.ts',
        // Desktop shell / external CLI / local device / media — Electron or OS-bound.
        'src/main/tools/**',
        'src/main/runtime/TerminalSessionService.ts',
        'src/main/runtime/KnowledgeBrowseService.ts',
        'src/main/media/**',
        'src/main/captures/**',
        // Electron/RDX session orchestration + OAuth/browser auth (browser QA / integration).
        'src/main/sessions/RdxSessionService.ts',
        'src/main/sessions/RewindService.ts',
        'src/main/sessions/SessionBranchService.ts',
        'src/main/sessions/SessionResumeService.ts',
        'src/main/settings/oauth/**',
        'src/main/settings/ProviderAccountAuthService.ts',
        'src/main/settings/ProviderConnectionService.ts',
        'src/main/settings/providerConnection*.ts',
        // Unused/legacy registries and thin facades (no production callers / daemon).
        'src/main/agent-runtime/core/ModelRegistry.ts',
        'src/main/agent-runtime/core/ProviderRegistry.ts',
        'src/main/agent-runtime/agent/MCPOAuth.ts',
        'src/main/agent-runtime/providers/ProviderAuth.ts',
        'src/main/agent-runtime/scheduler/BackgroundTaskRunner.ts',
        'src/main/workflow/debugger/DebuggerRuntime.ts',
        'src/main/daemon/**',
        'src/main/sdk/**',
        'src/main/reports/**',
        'src/main/testing/faux/**',
        'src/main/commands/**',
      ],
      // Floor thresholds; `pnpm run check:coverage-ratchet` enforces measured ratchet (only up).
      thresholds: {
        lines: 40,
        functions: 40,
        branches: 30,
        statements: 40,
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
