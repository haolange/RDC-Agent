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

/**
 * 启动 Electron app，使用临时 userData 和 workspace
 */
export async function launchApp(options: LaunchAppOptions = {}): Promise<AppContext> {
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
  const providerId = options.providerId ?? 'ollama-test-provider';
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
            label: 'Test Ollama',
            enabled: true,
            apiKey: '',
            secretRef: `provider-${nextProviderId}-api-key`,
            hasStoredSecret: true,
            baseUrl: 'http://127.0.0.1:11434/v1',
            models: [{ id: nextModelId, label: 'Debugger Test Model', enabled: true, contextWindowTokens: 8192 }],
            recommendedModels: [nextModelId],
            docsUrl: '',
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
 * 关闭 app 并清理临时目录
 */
export async function closeApp(ctx: AppContext, options?: { cleanup?: boolean }): Promise<void> {
  await ctx.app.close();
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
