/**
 * Electron Main Process Entry
 */

import { app, BrowserWindow, dialog, Menu, shell } from 'electron';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { registerIPCHandlers, setMainWindow, initializeIpcState, stopAllActiveRuns } from './ipc/handlers';
import { storageAdapter } from './services/StorageAdapter';
import { settingsService } from './services/SettingsService';
import { toolBridge } from './services/ToolBridge';
import { RdxSessionService } from './services/RdxSessionService';
import { replayDeviceService } from './services/ReplayDeviceService';
import { runtimeLogService } from './services/RuntimeLogService';

// RdxSessionService 鍗曚緥 - 渚?IPC handlers 浣跨敤
export const rdxSessionService = new RdxSessionService(toolBridge);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.RDC_AGENT_USER_DATA?.trim()) {
  app.setPath('userData', path.join(app.getPath('appData'), 'rdc-agent'));
}

// 寮€鍙戠幆澧冩锟?
const isDev = process.env.NODE_ENV === 'development' && process.env.RDC_AGENT_TEST_MODE !== '1';
const isSettingsRebuildOnly = process.env.RDC_AGENT_REBUILD_SETTINGS_ONLY === '1';

// 涓荤獥鍙ｅ紩锟?
let mainWindow: BrowserWindow | null = null;
const allowedNavigationOrigins = new Set<string>();

function registerAllowedOrigin(url: string): void {
  try {
    allowedNavigationOrigins.add(new URL(url).origin);
  } catch {
    // Ignore invalid renderer URLs.
  }
}

function emitWindowMaximizedState(): void {
  if (!mainWindow) return;
  mainWindow.webContents.send('window:maximized-changed', mainWindow.isMaximized());
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
      window.webContents.send('case:new');
      return;
    }

    if (key === ',') {
      event.preventDefault();
      window.webContents.send('settings:open');
    }
  });
}

/**
 * 鍒涘缓涓荤獥锟?
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
    // 绐楀彛鏍峰紡
    frame: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    backgroundColor: '#08080c',
  });

  // 鍔犺浇椤甸潰
  if (isDev) {
    const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
    if (rendererUrl) {
      registerAllowedOrigin(rendererUrl);
      mainWindow.loadURL(rendererUrl);
    } else {
      const fallbackUrl = 'http://localhost:5173';
      registerAllowedOrigin(fallbackUrl);
      mainWindow.loadURL(fallbackUrl);
    }
  } else {
    // 鐢熶骇妯″紡锛氬姞杞芥墦鍖呭悗鐨勬枃锟?
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // 绐楀彛鍑嗗濂藉悗鏄剧ず
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('maximize', emitWindowMaximizedState);
  mainWindow.on('unmaximize', emitWindowMaximizedState);
  mainWindow.on('enter-full-screen', emitWindowMaximizedState);
  mainWindow.on('leave-full-screen', emitWindowMaximizedState);

  // 绐楀彛鍏抽棴澶勭悊
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

  // 澶栭儴閾炬帴鐢ㄩ粯璁ゆ祻瑙堝櫒鎵撳紑
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // 璁剧疆绐楀彛鎺у埗涓庡揩鎹烽敭
  setMainWindow(mainWindow);
  setupKeyboardShortcuts(mainWindow);
  setupMenu();
}

/**
 * 璁剧疆搴旂敤鑿滃崟
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
            click: () => mainWindow?.webContents.send('case:new'),
          },
          {
            label: 'Settings',
            accelerator: 'CmdOrCtrl+,',
            click: () => mainWindow?.webContents.send('settings:open'),
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

// 搴旂敤灏辩华
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

  // 鍒濆鍖栨湇锟?
  await initializeServices();
  
  createMainWindow();

  // macOS: 鐐瑰嚮dock鍥炬爣鏃堕噸鏂板垱寤虹獥锟?
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

// 鎵€鏈夌獥鍙ｅ叧闂椂閫€鍑猴紙Windows/Linux锟?
app.on('window-all-closed', () => {
  replayDeviceService.dispose();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  void stopAllActiveRuns();
  replayDeviceService.dispose();
});

// 瀹夊叏澶勭悊锛氶樆姝㈡柊绐楀彛瀵艰埅鍒版湭鐭RL
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
 * 鍒濆鍖栨湇锟?
 */
async function initializeServices(): Promise<void> {
  try {
    // 鍒濆鍖?SettingsService锛坋lectron-store 寤惰繜鍔犺浇锛屾澶勮Е鍙戞瀯閫狅級
    const hasConfiguredProvider = settingsService.hasConfiguredProvider();
    console.log('[Main] SettingsService initialized, hasConfiguredProvider:', hasConfiguredProvider);
    
    await toolBridge.loadCatalog();
    console.log('[Main] ToolBridge catalog initialized');
    runtimeLogService.log({
      scope: 'app',
      namespace: 'system',
      severity: 'success',
      title: 'Tool catalog ready',
      summary: 'RDC 工具目录已加载。',
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

// 瀵煎嚭绐楀彛寮曠敤渚汭PC浣跨敤
export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}



