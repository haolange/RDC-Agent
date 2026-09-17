/**
 * Electron Main Process Entry
 */

import { app, BrowserWindow, dialog, Menu, session, shell } from 'electron';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { registerIPCHandlers, setMainWindow, initializeIpcState, stopAllActiveRuns } from './ipc/handlers';
import { storageAdapter } from './sessions/StorageAdapter';
import { rdxSessionService } from './sessions';
import { harvestOwnedRdxDaemons } from './sessions/OwnedRdxDaemonRegistry';
import { settingsService } from './settings/SettingsService';
import { rdxCliInvokerService } from './tools/RdxCliInvokerService';
import { replayDeviceService } from './captures/ReplayDeviceService';
import { runtimeLogService } from './runtime/RuntimeLogService';
import { rendererEventHub } from './browserAppBridge/rendererEventHub';
import {
  shouldStartBrowserAppBridge,
  startBrowserAppBridge,
  stopBrowserAppBridge,
} from './browserAppBridge/BrowserAppBridgeServer';
import { shutdownCoordinator } from './lifecycle/ShutdownCoordinator';
import { APP_MIN_WINDOW_HEIGHT, APP_MIN_WINDOW_WIDTH } from '@shared/constants/layout';
import { conversationService } from './conversation/ConversationService';
import { agentOrchestrator } from './workflow/debugger/AgentOrchestrator';
import { processSupervisor } from './runtime/ProcessSupervisor';
import { turnCoordinator } from './workflow/debugger/TurnCoordinator';
import {
  bindWindowLayoutPersistence,
  resolveWindowCreationOptions,
} from './window/windowLayoutPersistence';
import { resolveCanonicalUserDataPath } from './runtime/userDataPath';
import { acquireUserDataInstanceLock } from './runtime/userDataInstanceLock';

// Re-export for callers that historically imported from main entry.
export { rdxSessionService } from './sessions';

const SHUTDOWN_TIMEOUT_MS = 45_000;
let shutdownStarted = false;

function registerShutdownDisposables(): void {
  shutdownCoordinator.register({
    id: 'conversation.stop-accepting',
    phase: 'stop_accepting_turns',
    dispose: () => {
      conversationService.stopAcceptingTurns();
      agentOrchestrator.backgroundSubagents.stopAccepting();
    },
  });
  shutdownCoordinator.register({
    id: 'conversation.abort-all',
    phase: 'abort_all',
    dispose: async () => {
      await conversationService.abortAllTurns();
      await turnCoordinator.abortAll('app_shutdown');
    },
  });
  shutdownCoordinator.register({
    id: 'runs.stop-all',
    phase: 'join_producers',
    dispose: async () => {
      await stopAllActiveRuns();
    },
  });
  shutdownCoordinator.register({
    id: 'rdx.close-runtime',
    phase: 'release_owned_runtimes',
    dispose: async () => {
      await rdxSessionService.closeAll();
    },
  });
  shutdownCoordinator.register({
    id: 'process-supervisor.join-all',
    phase: 'terminate_processes',
    dispose: async () => {
      await processSupervisor.joinAll({ graceMs: 1_500, forceAfterMs: 4_000 });
    },
  });
  shutdownCoordinator.register({
    id: 'mcp.disconnect-all',
    phase: 'terminate_processes',
    dispose: async () => {
      await agentOrchestrator.disconnectAllMcpServers();
    },
  });
  shutdownCoordinator.register({
    id: 'shell.terminate-all',
    phase: 'terminate_processes',
    dispose: async () => {
      const { shellInvocationService } = await import('./tools/ShellInvocationService');
      shellInvocationService.terminateAll();
    },
  });
  shutdownCoordinator.register({
    id: 'bridge.stop',
    phase: 'terminate_processes',
    dispose: async () => {
      await stopBrowserAppBridge();
    },
  });
  shutdownCoordinator.register({
    id: 'replay.dispose',
    phase: 'flush_storage',
    dispose: () => {
      replayDeviceService.dispose();
    },
  });
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Development environment detection.
const isDev = process.env.NODE_ENV === 'development' && process.env.RDC_AGENT_TEST_MODE !== '1';
const isSettingsRebuildOnly = process.env.RDC_AGENT_REBUILD_SETTINGS_ONLY === '1';
const isTestMode = process.env.RDC_AGENT_TEST_MODE === '1';
const isHeadlessMode = process.env.RDC_AGENT_HEADLESS === '1' || process.env.RDC_AGENT_BROWSER_QA === '1';
if (isHeadlessMode) {
  process.env.RDC_AGENT_HEADLESS = '1';
}

/**
 * Install deny-by-default permission handlers and production CSP.
 * script-src drops unsafe-inline (module scripts are file/URL based).
 * style-src is 'self' only; renderer dynamic values use constructable stylesheets
 * (`useDynStyle`) so style attributes are unnecessary. style-src-attr 'none' makes that explicit.
 */
function installRendererSecurityPolicy(): void {
  const ses = session.defaultSession;

  ses.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  ses.setPermissionCheckHandler(() => false);

  const scriptSrc = isDev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://127.0.0.1:*"
    : "script-src 'self'";
  const styleSrc = "style-src 'self'";
  const styleSrcAttr = "style-src-attr 'none'";
  const csp = [
    "default-src 'self'",
    scriptSrc,
    styleSrc,
    styleSrcAttr,
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' http://127.0.0.1:* https://openrouter.ai https://api.openai.com https://api.anthropic.com https://generativelanguage.googleapis.com",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; ');

  ses.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...details.responseHeaders };
    responseHeaders['Content-Security-Policy'] = [csp];
    callback({ responseHeaders });
  });
}

const qaUserDataRoot = path.resolve(os.tmpdir(), 'rdc-agent');
const qaDisposableUserDataPattern = /^qa-[0-9]+-[0-9a-f]{16}$/;

function createDisposableBrowserQaUserData(): string {
  fs.mkdirSync(qaUserDataRoot, { recursive: true });
  return path.join(qaUserDataRoot, `qa-${Date.now()}-${randomBytes(8).toString('hex')}`);
}

function isValidatedDisposableBrowserQaUserData(targetPath: string): boolean {
  const resolved = path.resolve(targetPath);
  const relativePath = path.relative(qaUserDataRoot, resolved);
  return relativePath !== ''
    && !relativePath.startsWith('..')
    && !path.isAbsolute(relativePath)
    && qaDisposableUserDataPattern.test(path.basename(resolved));
}

const explicitUserDataPath = process.env.RDC_AGENT_USER_DATA?.trim();
const useDisposableBrowserQaUserData = process.env.RDC_AGENT_BROWSER_QA === '1'
  && !explicitUserDataPath
  && process.env.RDC_AGENT_USE_CANONICAL_USERDATA !== '1';
const userDataPath = useDisposableBrowserQaUserData
  ? createDisposableBrowserQaUserData()
  : resolveCanonicalUserDataPath(explicitUserDataPath, app.getPath('appData'));
const cleanupDisposableBrowserQaUserData = useDisposableBrowserQaUserData
  && isValidatedDisposableBrowserQaUserData(userDataPath);
process.env.RDC_AGENT_USER_DATA = userDataPath;
fs.mkdirSync(userDataPath, { recursive: true });
if (useDisposableBrowserQaUserData) {
  const isolatedHome = path.join(userDataPath, '.rdx');
  fs.mkdirSync(isolatedHome, { recursive: true });
  process.env.RDC_AGENT_HOME = isolatedHome;
  console.log(`[RDC-Agent] Isolated Browser QA home: ${isolatedHome}`);
}
app.commandLine.appendSwitch('user-data-dir', userDataPath);
app.setPath('userData', userDataPath);

const userDataLock = acquireUserDataInstanceLock(userDataPath, {
  pid: process.pid,
  mode: isHeadlessMode ? 'browser' : 'desktop',
  startTs: new Date().toISOString(),
});
if (!userDataLock.acquired) {
  const owner = userDataLock.owner;
  console.error(
    `[RDC-Agent] userData is already in use${owner ? ` by pid ${owner.pid} (${owner.mode})` : ''}`
    + `: ${userDataPath}`,
  );
  app.exit(1);
} else {
  process.once('exit', userDataLock.release);
  if (cleanupDisposableBrowserQaUserData) {
    app.once('will-quit', () => {
      if (!isValidatedDisposableBrowserQaUserData(userDataPath)) return;
      try {
        fs.rmSync(userDataPath, { recursive: true, force: true });
      } catch (error) {
        console.warn(`[RDC-Agent] Failed to clean disposable Browser QA userData: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }
}

// Both carriers own the canonical userData lock above. The headless Browser
// skips Electron's window-oriented single-instance redirect; instance.lock is
// the cross-carrier boundary, while visible desktop instances keep both locks.
const hasSingleInstanceLock = isSettingsRebuildOnly
  || isHeadlessMode
  || app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  console.log('[RDC-Agent] Another instance is already running. Reusing the existing instance.');
  app.exit(0);
}

if (isTestMode || isHeadlessMode) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('in-process-gpu');
}

// Main window reference.
let mainWindow: BrowserWindow | null = null;
let headlessKeepAliveTimer: NodeJS.Timeout | null = null;
const allowedNavigationOrigins = new Set<string>();

app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
});

function registerAllowedOrigin(url: string): void {
  try {
    allowedNavigationOrigins.add(new URL(url).origin);
  } catch {
    // Ignore invalid renderer URLs.
  }
}

function emitWindowMaximizedState(): void {
  if (!mainWindow) return;
  rendererEventHub.emit('window:maximized-changed', mainWindow.isMaximized());
  mainWindow.webContents.send('window:maximized-changed', mainWindow.isMaximized());
}

function getDevRendererUrl(): string {
  const configuredUrl = process.env['ELECTRON_RENDERER_URL'] || 'http://127.0.0.1:5173';
  const rendererUrl = new URL(configuredUrl);
  if (rendererUrl.hostname === 'localhost') {
    rendererUrl.hostname = '127.0.0.1';
  }
  return rendererUrl.toString();
}

async function openRdcFiles(): Promise<void> {
  const result = await dialog.showOpenDialog({
    filters: [
      { name: 'RenderDoc Capture', extensions: ['rdc'] },
    ],
    properties: ['openFile', 'multiSelections'],
  });

  if (!result.canceled && result.filePaths.length > 0) {
    runtimeLogService.log({
      scope: 'app',
      namespace: 'system',
      severity: 'info',
      title: 'Open files',
      summary: `已选择 ${result.filePaths.length} 个外部 .rdc 文件。`,
      raw: {
        filePaths: result.filePaths,
      },
    });
    rendererEventHub.emit('file:open', result.filePaths);
    mainWindow?.webContents.send('file:open', result.filePaths);
  }
}

function setupKeyboardShortcuts(window: BrowserWindow): void {
  window.webContents.on('before-input-event', async (event, input) => {
    const commandOrControl = input.control || input.meta;
    if (!commandOrControl || input.type !== 'keyDown') return;

    const key = input.key.toLowerCase();

    if (key === 'o') {
      event.preventDefault();
      await openRdcFiles();
      return;
    }

    if (key === 'n') {
      event.preventDefault();
      rendererEventHub.emit('case:new');
      window.webContents.send('case:new');
      return;
    }

    if (key === ',') {
      event.preventDefault();
      rendererEventHub.emit('settings:open');
      window.webContents.send('settings:open');
    }
  });
}

/**
 * Create the main window.
 */
function createMainWindow(): void {
  const savedWindow = settingsService.getAll().layout.window;
  const windowOptions = resolveWindowCreationOptions(savedWindow);

  mainWindow = new BrowserWindow({
    width: windowOptions.width,
    height: windowOptions.height,
    ...(typeof windowOptions.x === 'number' && typeof windowOptions.y === 'number'
      ? { x: windowOptions.x, y: windowOptions.y }
      : {}),
    minWidth: APP_MIN_WINDOW_WIDTH,
    minHeight: APP_MIN_WINDOW_HEIGHT,
    title: 'RdcAgent - RenderDoc Debug Agent',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
    // Window chrome.
    frame: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    backgroundColor: '#08080c',
  });

  // Load the renderer.
  if (isDev) {
    const rendererUrl = getDevRendererUrl();
    registerAllowedOrigin(rendererUrl);
    mainWindow.loadURL(rendererUrl);
  } else {
    // Production mode loads the bundled renderer.
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Show after the window is ready.
  mainWindow.once('ready-to-show', () => {
    if (!mainWindow) return;
    if (windowOptions.isMaximized) {
      mainWindow.maximize();
    }
    mainWindow.show();
  });

  mainWindow.on('maximize', emitWindowMaximizedState);
  mainWindow.on('unmaximize', emitWindowMaximizedState);
  mainWindow.on('enter-full-screen', emitWindowMaximizedState);
  mainWindow.on('leave-full-screen', emitWindowMaximizedState);
  bindWindowLayoutPersistence(mainWindow);

  // Clear the main window reference after close.
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log('[RendererConsole]', { level, message, line, sourceId });
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('[RendererLoadFailed]', { errorCode, errorDescription, validatedURL });
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[RendererProcessGone]', details);
  });

  // Open external links in the default browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Register window controls and shortcuts.
  setMainWindow(mainWindow);
  setupKeyboardShortcuts(mainWindow);
  setupMenu();
}

/**
 * Set the application menu.
 */
function setupMenu(): void {
  if (process.platform === 'darwin') {
    const template: Electron.MenuItemConstructorOptions[] = [
      { role: 'appMenu' },
      {
        label: 'File',
        submenu: [
          {
            label: 'Open .rdc File',
            accelerator: 'CmdOrCtrl+O',
            click: async () => openRdcFiles(),
          },
          {
            label: 'New Case',
            accelerator: 'CmdOrCtrl+N',
            click: () => {
              rendererEventHub.emit('case:new');
              mainWindow?.webContents.send('case:new');
            },
          },
          {
            label: 'Settings',
            accelerator: 'CmdOrCtrl+,',
            click: () => {
              rendererEventHub.emit('settings:open');
              mainWindow?.webContents.send('settings:open');
            },
          },
          { type: 'separator' },
          { role: 'close' },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'forceReload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      {
        label: 'Help',
        submenu: [
          {
            label: 'Documentation',
            click: () => {
              shell.openExternal('https://github.com/haolange/RDC-Agent#readme');
            },
          },
          {
            label: 'Report Issue',
            click: () => {
              shell.openExternal('https://github.com/haolange/RDC-Agent/issues');
            },
          },
          { type: 'separator' },
          {
            label: 'About RDC-Agent',
            click: () => {
              const version = app.getVersion();
              const detail = [
                `Version: ${version}`,
                `Electron: ${process.versions.electron ?? 'N/A'}`,
                `Node: ${process.versions.node ?? 'N/A'}`,
                `Chrome: ${process.versions.chrome ?? 'N/A'}`,
              ].join('\n');
              void dialog.showMessageBox({
                type: 'info',
                title: 'About RDC-Agent',
                message: 'RDC-Agent',
                detail,
              });
            },
          },
        ],
      },
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    return;
  }

  // Non-darwin: still expose Help with real repo links (no placeholder URLs).
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Help',
      submenu: [
        {
          label: 'Documentation',
          click: () => {
            shell.openExternal('https://github.com/haolange/RDC-Agent#readme');
          },
        },
        {
          label: 'Report Issue',
          click: () => {
            shell.openExternal('https://github.com/haolange/RDC-Agent/issues');
          },
        },
        { type: 'separator' },
        {
          label: 'About RDC-Agent',
          click: () => {
            const version = app.getVersion();
            void dialog.showMessageBox({
              type: 'info',
              title: 'About RDC-Agent',
              message: 'RDC-Agent',
              detail: [
                `Version: ${version}`,
                `Electron: ${process.versions.electron ?? 'N/A'}`,
                `Node: ${process.versions.node ?? 'N/A'}`,
              ].join('\n'),
            });
          },
        },
      ],
    },
  ]));
}

// App lifecycle.
app.whenReady().then(async () => {
  installRendererSecurityPolicy();
  const settings = settingsService.initialize();
  if (isSettingsRebuildOnly) {
    console.log('[SettingsRebuildOnly]', JSON.stringify({
      workspaceRoot: settings.paths.userRdxRoot,
      settingsPath: settings.paths.settingsPath,
      providerIds: settings.llm.providers.map((provider) => provider.id),
    }));
    app.exit(0);
    return;
  }

  await storageAdapter.initializeWorkspace();
  runtimeLogService.log({
    scope: 'app',
    namespace: 'system',
    severity: 'info',
    title: 'App ready',
    summary: 'RDC Agent 主进程已启动。',
    raw: {
      workspaceRoot: storageAdapter.getWorkspacePath(),
    },
  });

  registerIPCHandlers();

  // Initialize main process services.
  await initializeServices();
  if (shouldStartBrowserAppBridge()) {
    const bridgeUrl = await startBrowserAppBridge({
      devRendererUrl: isDev ? getDevRendererUrl() : null,
      rendererRoot: path.join(__dirname, '../renderer'),
      mainBundlePath: path.join(__dirname, 'index.js'),
      appVersion: process.env.npm_package_version?.trim() || app.getVersion(),
    });
    runtimeLogService.log({
      scope: 'app',
      namespace: 'system',
      severity: 'success',
      title: 'Browser app session ready',
      summary: `浏览器真实会话入口已启动：${bridgeUrl}/app`,
      raw: { bridgeUrl, userDataPath },
    });
    if (isHeadlessMode) {
      // Headless QA has no renderer window. The bridge plus this timer keep
      // Electron alive without creating a GPU-backed hidden BrowserWindow.
      headlessKeepAliveTimer = setInterval(() => {
        // Keep Electron's main process alive while Browser QA is connected.
      }, 60_000);
      console.log(`[BrowserAppBridge] Headless mode enabled without a renderer window.`);
    }
  } else if (isHeadlessMode) {
    console.error('[RDC-Agent] Headless mode requires the browser app bridge.');
    app.exit(1);
    return;
  }

  if (!isHeadlessMode) {
    createMainWindow();
  }

  // macOS: recreate the window when the dock icon is clicked.
  app.on('activate', () => {
    if (!isHeadlessMode && BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

// Quit after all windows close on Windows/Linux.
app.on('window-all-closed', () => {
  if (isHeadlessMode) {
    return;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', (event) => {
  if (shutdownStarted || shutdownCoordinator.isShuttingDown()) {
    event.preventDefault();
    return;
  }
  shutdownStarted = true;
  event.preventDefault();

  if (headlessKeepAliveTimer) {
    clearInterval(headlessKeepAliveTimer);
    headlessKeepAliveTimer = null;
  }

  registerShutdownDisposables();
  const timeoutMs = isTestMode ? 100 : SHUTDOWN_TIMEOUT_MS;
  void shutdownCoordinator.shutdownAll(timeoutMs, () => app.exit(0)).then(() => {
    app.exit(0);
  });
});

// External QA/CLI launchers use process signals; route them through the same shutdown state machine.
const requestProcessShutdown = () => {
  if (!shutdownStarted) app.quit();
};
process.once('SIGINT', requestProcessShutdown);
process.once('SIGTERM', requestProcessShutdown);

// Block navigation to unknown origins.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    const isAllowedDevOrigin = allowedNavigationOrigins.has(parsedUrl.origin);

    if (!isAllowedDevOrigin && parsedUrl.protocol !== 'file:') {
      event.preventDefault();
    }
  });
});

/**
 * Initialize main process services.
 */
async function initializeServices(): Promise<void> {
  try {
    // SettingsService is initialized lazily by this access.
    const hasConfiguredProvider = settingsService.hasConfiguredProvider();
    console.log('[Main] SettingsService initialized, hasConfiguredProvider:', hasConfiguredProvider);
    
    await rdxCliInvokerService.getRuntimeSummary();
    console.log('[Main] RDX CLI invoker initialized');
    const leftover = await harvestOwnedRdxDaemons();
    if (leftover.failed.length) {
      runtimeLogService.log({
        scope: 'app',
        namespace: 'context',
        severity: 'error',
        title: 'RDX leftover daemon harvest failed',
        summary: leftover.failed.map((item) => `${item.contextId}: ${item.error}`).join('; '),
        raw: leftover,
      });
    } else if (leftover.released.length) {
      runtimeLogService.log({
        scope: 'app',
        namespace: 'context',
        severity: 'info',
        title: 'RDX leftover daemons released',
        summary: leftover.released.join(', '),
        raw: leftover,
      });
    }
    runtimeLogService.log({
      scope: 'app',
      namespace: 'system',
      severity: 'success',
      title: 'RDX CLI invoker ready',
      summary: 'RDX CLI invoker 诊断已加载。',
    });
    
    await initializeIpcState();
    console.log('[Main] DebuggerRuntime initialized');

    await replayDeviceService.initialize();
    console.log('[Main] ReplayDeviceService initialized');
    runtimeLogService.log({
      scope: 'app',
      namespace: 'system',
      severity: 'success',
      title: 'Services ready',
      summary: '主进程服务初始化完成。',
    });
  } catch (error) {
    console.error('[Main] Failed to initialize services:', error);
    runtimeLogService.log({
      scope: 'app',
      namespace: 'system',
      severity: 'error',
      title: 'Service init failed',
      summary: error instanceof Error ? error.message : String(error),
    });
  }
}

// Export the main window reference for IPC usage.
export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
