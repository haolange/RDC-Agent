import { defineConfig } from 'vitest/config';
import path from 'path';
import { providerCatalogVitePlugin } from './src/main/provider-catalog/providerCatalogVitePlugin';

const shared = {
  plugins: [providerCatalogVitePlugin(__dirname)],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@main': path.resolve(__dirname, 'src/main'),
      '@renderer': path.resolve(__dirname, 'src/renderer'),
    },
  },
};

const coverageExclude = [
  '**/*.test.ts',
  '**/*.d.ts',
  '**/fixtures/**',
  '**/__fixtures__/**',
  '**/generated/**',
  '**/*.generated.ts',
  '**/dist/**',
  'src/main/index.ts',
  'src/main/**/index.ts',
  'src/main/ipc/*Handlers.ts',
  'src/main/ipc/handlers.ts',
  'src/main/browserAppBridge/BrowserAppBridgeServer.ts',
  'src/main/browserAppBridge/rendererEventHub.ts',
  'src/main/workers/turnPreparationWorker.ts',
  'src/main/workers/TurnPreparationWorkerPool.ts',
  'src/main/tools/**',
  'src/main/media/**',
  'src/main/rdc/captures/**',
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
];

export default defineConfig({
  ...shared,
  test: {
    globals: true,
    // One isolated temp/home/app-data root for the whole run (a second per-project copy would nest
    // TMPDIR and push Unix socket paths past their length limit).
    globalSetup: ['./scripts/vitest-global-setup.ts'],
    // Vitest reads coverage only here, not per project. The test:coverage scripts pick the project's
    // source set (--coverage.include) and report directory, so files no test imports still count.
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json'],
      exclude: coverageExclude,
    },
    projects: [
      {
        ...shared,
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/main/**/*.test.ts', 'src/shared/**/*.test.ts', 'src/preload/**/*.test.ts'],
        },
      },
      {
        ...shared,
        test: {
          name: 'renderer',
          environment: 'happy-dom',
          include: ['src/renderer/**/*.test.ts'],
        },
      },
    ],
  },
});
