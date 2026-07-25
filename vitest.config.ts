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
      // Node unit-test surface only: main + shared. Renderer is validated via
      // browser QA (`start:agent-browser`) and check:* scripts, not vitest node env.
      include: ['src/main/**/*.{ts,tsx}', 'src/shared/**/*.{ts,tsx}'],
      exclude: [
        '**/*.test.ts',
        '**/fixtures/**',
        // Generated / compiled artifacts if present under source trees.
        '**/generated/**',
        '**/*.generated.ts',
        '**/dist/**',
        // Electron / process entry glue — not a meaningful node unit-test surface.
        'src/main/index.ts',
        'src/main/**/index.ts',
        'src/main/ipc/*Handlers.ts',
        'src/main/ipc/handlers.ts',
        'src/main/ipc/sessionOutputs.ts',
        'src/main/browserAppBridge/BrowserAppBridgeServer.ts',
        'src/main/browserAppBridge/rendererEventHub.ts',
        'src/main/updater/**',
        'src/main/telemetry/**',
        'src/main/workers/turnPreparationWorker.ts',
        'src/main/workers/TurnPreparationWorkerPool.ts',
        // Desktop shell / external CLI / local device wiring (Electron or OS-bound).
        'src/main/tools/RdxCliInvokerService.ts',
        'src/main/tools/RdxShellActionService.ts',
        'src/main/tools/ShellInvocationService.ts',
        'src/main/tools/ToolCheckerService.ts',
        'src/main/runtime/TerminalSessionService.ts',
        'src/main/runtime/KnowledgeBrowseService.ts',
        'src/main/media/FaviconResolveService.ts',
        'src/main/captures/ReplayDeviceService.ts',
        'src/main/captures/CapturePreviewService.ts',
        // Electron/RDX session orchestration + OAuth/browser auth (browser QA / integration).
        'src/main/sessions/RdxSessionService.ts',
        'src/main/sessions/RewindService.ts',
        'src/main/sessions/SessionBranchService.ts',
        'src/main/sessions/SessionResumeService.ts',
        // Unused/legacy registries, OAuth helpers, scheduler loop, thin workflow facade.
        'src/main/agent-runtime/core/ModelRegistry.ts',
        'src/main/agent-runtime/core/ProviderRegistry.ts',
        'src/main/agent-runtime/agent/AgentHooks.ts',
        'src/main/agent-runtime/agent/MCPOAuth.ts',
        'src/main/agent-runtime/providers/ProviderAuth.ts',
        'src/main/agent-runtime/scheduler/BackgroundTaskRunner.ts',
        'src/main/workflow/debugger/DebuggerRuntime.ts',
      ],
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
