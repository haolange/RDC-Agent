/**
 * Electron Main Process Entry
 */

import { app, BrowserWindow, dialog, Menu, shell } from 'electron';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { registerIPCHandlers, setMainWindow, initializeIpcState, stopAllActiveRuns } from './ipc/handlers';
import { storageAdapter } from './sessions/StorageAdapter';
import { settingsService } from './settings/SettingsService';
import { rdxCliInvokerService } from './tools/RdxCliInvokerService';
import { RdxSessionService } from './sessions/RdxSessionService';
import { replayDeviceService } from './captures/ReplayDeviceService';
import { runtimeLogService } from './runtime/RuntimeLogService';
import { rendererEventHub } from './browserAppBridge/rendererEventHub';
import { startBrowserAppBridge, stopBrowserAppBridge } from './browserAppBridge/BrowserAppBridgeServer';

// Shared RDX session service for IPC handlers.
export const rdxSessionService = new RdxSessionService(rdxCliInvokerService);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const configuredUserDataPath = process.env.RDC_AGENT_USER_DATA?.trim();
if (configuredUserDataPath) {
  app.commandLine.appendSwitch('user-data-dir', configuredUserDataPath);
  app.setPath('userData', configuredUserDataPath);
} else {
  app.setPath('userData', path.join(app.getPath('appData'), 'rdc-agent'));
}

// Development environment detection.
const isDev = process.env.NODE_ENV === 'development' && process.env.RDC_AGENT_TEST_MODE !== '1';
const isSettingsRebuildOnly = process.env.RDC_AGENT_REBUILD_SETTINGS_ONLY === '1';
const isTestMode = process.env.RDC_AGENT_TEST_MODE === '1';
const isHeadlessMode = process.env.RDC_AGENT_HEADLESS === '1';

const hasSingleInstanceLock = isSettingsRebuildOnly || app.requestSingleInstanceLock();
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
let headlessKeepAliveWindow: BrowserWindow | null = null;
const allowedNavigationOrigins = new Set<string>();

app.on('second-instance', () => {
  if (isHeadlessMode) {
    console.log('[RDC-Agent] Headless instance already running; ignoring duplicate startup.');
    return;
  }
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
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 360,
    minHeight: 640,
    title: 'RdcAgent - RenderDoc Debug Agent',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
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
    mainWindow?.show();
  });

  mainWindow.on('maximize', emitWindowMaximizedState);
  mainWindow.on('unmaximize', emitWindowMaximizedState);
  mainWindow.on('enter-full-screen', emitWindowMaximizedState);
  mainWindow.on('leave-full-screen', emitWindowMaximizedState);

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
              shell.openExternal('https://github.com/rdc-agent/docs');
            },
          },
          {
            label: 'Report Issue',
            click: () => {
              shell.openExternal('https://github.com/rdc-agent/issues');
            },
          },
        ],
      },
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    return;
  }

  Menu.setApplicationMenu(null);
}

// App lifecycle.
app.whenReady().then(async () => {
  const settings = settingsService.initialize();
  if (isSettingsRebuildOnly) {
    console.log('[SettingsRebuildOnly]', JSON.stringify({
      workspaceRoot: settings.workspace.rootPath,
      settingsPath: settings.paths.settingsPath,
      providerIds: settings.llm.providers.map((provider) => provider.id),
      lastMigrationReportPath: settings.configuration.lastMigrationReportPath ?? null,
      migrationSummary: settings.configuration.lastMigrationSummary,
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
  const bridgeUrl = await startBrowserAppBridge({
    devRendererUrl: isDev ? getDevRendererUrl() : null,
    rendererRoot: path.join(__dirname, '../renderer'),
  });
  runtimeLogService.log({
    scope: 'app',
    namespace: 'system',
    severity: 'success',
    title: 'Browser app session ready',
    summary: `浏览器真实会话入口已启动：${bridgeUrl}/app`,
    raw: { bridgeUrl },
  });
  
  if (isHeadlessMode) {
    headlessKeepAliveWindow = new BrowserWindow({
      width: 1,
      height: 1,
      show: false,
      skipTaskbar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
      },
    });
    headlessKeepAliveWindow.loadURL('about:blank').catch(() => {
      // The window only anchors the Electron lifecycle; a blank-load failure is non-fatal.
    });
    headlessKeepAliveWindow.on('closed', () => {
      headlessKeepAliveWindow = null;
    });
    headlessKeepAliveTimer = setInterval(() => {
      // Keep Electron's main process alive when the browser session has no BrowserWindow.
    }, 60_000);
    console.log(`[BrowserAppBridge] Headless mode enabled. Open ${bridgeUrl}/app`);
  } else {
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
  replayDeviceService.dispose();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', (event) => {
  if (isHeadlessMode) {
    event.preventDefault();
    return;
  }
  if (headlessKeepAliveWindow && !headlessKeepAliveWindow.isDestroyed()) {
    headlessKeepAliveWindow.destroy();
    headlessKeepAliveWindow = null;
  }
  if (headlessKeepAliveTimer) {
    clearInterval(headlessKeepAliveTimer);
    headlessKeepAliveTimer = null;
  }
  void stopAllActiveRuns();
  void stopBrowserAppBridge();
  replayDeviceService.dispose();
  if (isTestMode) {
    const forceExitTimer = setTimeout(() => app.exit(0), 100);
    forceExitTimer.unref?.();
  }
});

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
    
    await rdxCliInvokerService.loadCatalog();
    console.log('[Main] RDX CLI invoker initialized');
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
