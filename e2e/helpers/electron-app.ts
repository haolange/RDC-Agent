import { _electron as electron, ConsoleMessage, ElectronApplication, Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';

export interface AppContext {
  app: ElectronApplication;
  page: Page;
  tempDir: string;
  userDataDir: string;
  workspaceDir: string;
  cleanupOnClose: boolean;
}

interface LaunchAppOptions {
  tempDir?: string;
  cleanupOnClose?: boolean;
  testMode?: boolean;
  userDataDir?: string;
  workspaceDir?: string;
  onConsole?: (message: ConsoleMessage) => void;
  onPageError?: (error: Error) => void;
}

let pendingPlaywrightTransportCleanup: NodeJS.Timeout | null = null;

function cancelPendingPlaywrightTransportCleanup(): void {
  if (pendingPlaywrightTransportCleanup) {
    clearTimeout(pendingPlaywrightTransportCleanup);
    pendingPlaywrightTransportCleanup = null;
  }
}

function schedulePlaywrightTransportCleanup(): void {
  cancelPendingPlaywrightTransportCleanup();
  pendingPlaywrightTransportCleanup = setTimeout(() => {
    pendingPlaywrightTransportCleanup = null;
    const activeHandles = (process as typeof process & {
      _getActiveHandles?: () => unknown[];
    })._getActiveHandles?.() ?? [];
    for (const handle of activeHandles) {
      const socket = handle as {
        constructor?: { name?: string };
        fd?: number;
        destroy?: () => void;
      };
      if (socket.constructor?.name === 'Socket' && socket.fd == null) {
        socket.destroy?.();
      }
    }
  }, 5000);
}

/**
 * 启动 Electron app，使用临时 userData 和 workspace
 */
export async function launchApp(options: LaunchAppOptions = {}): Promise<AppContext> {
  cancelPendingPlaywrightTransportCleanup();
  const tempDir = options.tempDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-agent-e2e-'));
  const userDataDir = options.userDataDir ?? path.join(tempDir, 'userData');
  const workspaceDir = options.workspaceDir ?? path.join(tempDir, 'workspace');
  const testMode = options.testMode !== false;
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(workspaceDir, { recursive: true });

  // 复制 fixture .rdc 文件到临时 workspace
  const manifestPath = path.join(__dirname, '..', 'fixtures', 'fixture-manifest.json');
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    for (const fixture of manifest.captures ?? []) {
      if (fs.existsSync(fixture.sourcePath)) {
        const destPath = path.join(workspaceDir, path.basename(fixture.sourcePath));
        if (!fs.existsSync(destPath)) {
          fs.copyFileSync(fixture.sourcePath, destPath);
        }
      }
    }
  }

  const app = await electron.launch({
    args: [path.join(__dirname, '..', '..', 'out', 'main', 'index.js')],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      ...(testMode ? { RDC_AGENT_TEST_MODE: '1' } : {}),
      ...(options.userDataDir || testMode ? { RDC_AGENT_USER_DATA: userDataDir } : {}),
      ...(options.workspaceDir || testMode ? { RDC_AGENT_WORKSPACE: workspaceDir } : {}),
    },
  });

  const page = await app.firstWindow();
  if (options.onConsole) {
    page.on('console', options.onConsole);
  }
  if (options.onPageError) {
    page.on('pageerror', options.onPageError);
  }
  await page.waitForLoadState('domcontentloaded');
  await page.locator('.app-titlebar').waitFor({ state: 'visible', timeout: 10000 });
  const loadingScreen = page.locator('.loading-screen');
  if (await loadingScreen.count()) {
    await loadingScreen.first().waitFor({ state: 'detached', timeout: 10000 }).catch(() => undefined);
  }
  await page.waitForTimeout(300);

  return {
    app,
    page,
    tempDir,
    userDataDir,
    workspaceDir,
    cleanupOnClose: options.cleanupOnClose ?? true,
  };
}

interface ConfigureTestDebuggerRoutesOptions {
  withRoutes?: boolean;
  providerId?: string;
  modelId?: string;
}

const TEST_AGENT_IDS = [
  'ask_agent',
  'rdc-debugger',
  'triage_agent',
  'capture_repro_agent',
  'pass_graph_pipeline_agent',
  'pixel_forensics_agent',
  'shader_ir_agent',
  'driver_device_agent',
  'skeptic_agent',
  'curator_agent',
] as const;

export async function configureTestDebuggerRoutes(
  page: Page,
  options: ConfigureTestDebuggerRoutesOptions = {},
): Promise<void> {
  const providerId = options.providerId ?? 'ollama';
  const modelId = options.modelId ?? 'debugger-test-model';
  const withRoutes = options.withRoutes !== false;

  await page.evaluate(async ({ nextProviderId, nextModelId, nextWithRoutes }) => {
    const settings = await window.electronAPI.settings.get();
    await window.electronAPI.settings.set({
      llm: {
        providers: [
          {
            id: nextProviderId,
            kind: 'ollama',
            authMode: 'local',
            catalogGroup: 'local',
            modelDiscovery: 'ollama-tags',
            label: 'Test Ollama',
            enabled: true,
            apiKey: '',
            secretRef: `provider-${nextProviderId}-api-key`,
            hasStoredSecret: true,
            baseUrl: 'http://127.0.0.1:11434/v1',
            models: [{ id: nextModelId, label: 'Debugger Test Model', enabled: true, contextWindowTokens: 8192 }],
            recommendedModels: [nextModelId],
            docsUrl: '',
            status: 'verified',
            lastTestedAt: new Date().toISOString(),
            lastModelRefreshAt: new Date().toISOString(),
            isConfigured: true,
          },
        ],
        agentRoutes: (settings.llm.agentRoutes.length > 0
          ? settings.llm.agentRoutes
          : TEST_AGENT_IDS.map((agentId) => ({
              agentId,
              providerId: '',
              modelId: '',
            }))).map((route) => ({
          ...route,
          providerId: nextWithRoutes ? nextProviderId : '',
          modelId: nextWithRoutes ? nextModelId : '',
        })),
      },
    });

    const confirmed = await window.electronAPI.settings.get();
    (window as typeof window & {
      __RDC_AGENT_E2E__?: {
        setAppSettings: (settings: unknown) => void;
      };
    }).__RDC_AGENT_E2E__?.setAppSettings(confirmed);
    const debuggerRoute = confirmed.llm.agentRoutes.find((route) => route.agentId === 'rdc-debugger');
    if (nextWithRoutes && (!debuggerRoute?.providerId || !debuggerRoute?.modelId)) {
      throw new Error('Failed to persist debugger routes for E2E test setup');
    }
  }, {
    nextProviderId: providerId,
    nextModelId: modelId,
    nextWithRoutes: withRoutes,
  });
}

/**
 * Start a debugger workflow from the first seeded project input.
 */
export async function startDebuggerPlanFromFirstInput(page: Page, goal: string): Promise<string> {
  return page.evaluate(async (nextGoal) => {
    const e2e = (window as typeof window & {
      __RDC_AGENT_E2E__?: {
        getWorkbenchState: () => {
          currentProject: { projectId: string } | null;
          currentSession: { sessionId: string } | null;
          projectInputs: Array<{ inputId: string; filePath: string }>;
        };
        seedWorkbenchState: (state: unknown) => void;
      };
    }).__RDC_AGENT_E2E__;
    const state = e2e?.getWorkbenchState();
    const currentProject = state?.currentProject;
    const currentSession = state?.currentSession;
    const primaryInput = state?.projectInputs[0];
    if (!e2e || !currentProject || !currentSession || !primaryInput) {
      throw new Error('Missing seeded project/session/input for debugger workflow E2E setup');
    }

    const captures = state.projectInputs.map((input) => ({
      id: input.inputId,
      filePath: input.filePath,
      role: 'primary' as const,
      backendHint: 'local' as const,
      status: 'pending' as const,
    }));
    const started = await window.electronAPI.workflow.start({
      projectId: currentProject.projectId,
      sessionId: currentSession.sessionId,
      mode: 'debugger',
      goal: nextGoal,
      captures,
      primaryCaptureId: primaryInput.inputId,
    });
    if (!started.success || !started.runId) {
      throw new Error(started.error || 'Failed to start debugger workflow for E2E setup');
    }

    const runs = await window.electronAPI.run.list(currentSession.sessionId);
    const workflow = await window.electronAPI.workflow.getState();
    const currentRun = runs.runs.find((run) => run.runId === started.runId) ?? null;
    e2e.seedWorkbenchState({
      ...state,
      currentRun,
      runs: runs.runs,
      workflowState: workflow,
    });
    return started.runId;
  }, goal);
}

function waitForProcessExit(proc: ReturnType<ElectronApplication['process']>, timeoutMs: number): Promise<boolean> {
  if (!proc || proc.killed || proc.exitCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    proc.once('close', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

function markPlaywrightElectronClosed(app: ElectronApplication): void {
  const appInternals = app as ElectronApplication & {
    emit?: (eventName: string) => boolean;
    context: () => ReturnType<ElectronApplication['context']> & {
      _onClose?: () => void;
    };
  };
  appInternals.emit?.('close');
  appInternals.context()._onClose?.();
}

export async function closeApp(ctx: AppContext, options?: { cleanup?: boolean }): Promise<void> {
  const proc = ctx.app.process();

  if (proc && !proc.killed) {
    await ctx.app.evaluate(({ app }) => {
      app.quit();
      setTimeout(() => app.exit(0), 100).unref?.();
    }).catch(() => undefined);

    const exited = await waitForProcessExit(proc, 5000);
    if (!exited && !proc.killed) {
      proc.kill();
      await waitForProcessExit(proc, 5000);
    }
  }
  markPlaywrightElectronClosed(ctx.app);
  schedulePlaywrightTransportCleanup();

  const shouldCleanup = options?.cleanup ?? ctx.cleanupOnClose;
  // 清理临时目录
  if (shouldCleanup) {
    try {
      fs.rmSync(ctx.tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}
