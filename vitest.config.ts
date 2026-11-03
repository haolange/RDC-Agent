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
        // Bridge HTTP server + SSE hub: browser QA / smoke; keep unit coverage on bridgeSecurity + proxy.
        'src/main/browserAppBridge/BrowserAppBridgeServer.ts',
        'src/main/browserAppBridge/rendererEventHub.ts',
        // Worker threads / pool glue — integration / process bound.
        'src/main/workers/turnPreparationWorker.ts',
        'src/main/workers/TurnPreparationWorkerPool.ts',
        // Desktop shell / external CLI / local device / media — Electron or OS-bound.
        'src/main/tools/**',
        'src/main/media/**',
        'src/main/rdc/captures/**',
        // Former tools/Rdc* and shell.rdc entry points stay outside the node coverage surface.
        'src/main/rdc/executeRdcShell.ts',
        'src/main/rdc/resolveRdcBatchInvocation.ts',
        'src/main/rdc/withRdcHostRuntimeEnv.ts',
        'src/main/rdc/RdcCliInvokerService.ts',
        'src/main/rdc/RdcExecutionReceipts.ts',
        'src/main/rdc/RdcHostControls.ts',
        'src/main/rdc/RdcInstallationService.ts',
        'src/main/rdc/RdcInvocationRecord.ts',
        'src/main/rdc/RdcNativeProtocol.ts',
        'src/main/rdc/RdcOperationCatalog.ts',
        'src/main/rdc/RdcOperationPolicy.ts',
        'src/main/rdc/RdcProbeLifecycle.ts',
        'src/main/rdc/RdcProcessIdentity.ts',
        'src/main/rdc/RdcShellInput.ts',
        'src/main/rdc/RdcTurnBindings.ts',
        'src/main/rdc/RdcValidatedEvidence.ts',
        // Electron/RDC session orchestration + OAuth/browser auth (browser QA / integration).
        'src/main/rdc/RdcSessionService.ts',
        'src/main/sessions/store/RewindService.ts',
        'src/main/sessions/store/SessionBranchService.ts',
        'src/main/sessions/store/SessionResumeService.ts',
        'src/main/settings/provider-auth/oauth/**',
        'src/main/settings/provider-auth/ProviderAccountAuthService.ts',
        'src/main/settings/provider-auth/ProviderConnectionService.ts',
        'src/main/settings/provider-auth/providerConnection*.ts',
        'src/main/agent-runtime/core/ProviderRegistry.ts',
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
