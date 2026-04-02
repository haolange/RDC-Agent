/**
 * Electron Main Process Entry
 */

import { app, BrowserWindow, dialog, Menu, shell } from 'electron';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { registerIPCHandlers, setMainWindow, initWorkflowGraph } from './ipc/handlers';
import { storageAdapter } from './services/StorageAdapter';
import { rdcToolAdapter } from './tools/RDCToolAdapter';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 开发环境检测
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// 主窗口引用
let mainWindow: BrowserWindow | null = null;

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
 * 创建主窗口
 */
function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'RdcAgent - RenderDoc Debug Agent',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
    // 窗口样式
    frame: false,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    backgroundColor: '#08080c',
  });

  // 加载页面
  if (isDev) {
    const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
    if (rendererUrl) {
      mainWindow.loadURL(rendererUrl);
    } else {
      mainWindow.loadURL('http://localhost:5173');
    }
  } else {
    // 生产模式：加载打包后的文件
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // 窗口准备好后显示
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('maximize', emitWindowMaximizedState);
  mainWindow.on('unmaximize', emitWindowMaximizedState);
  mainWindow.on('enter-full-screen', emitWindowMaximizedState);
  mainWindow.on('leave-full-screen', emitWindowMaximizedState);

  // 窗口关闭处理
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 外部链接用默认浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // 设置窗口控制与快捷键
  setMainWindow(mainWindow);
  setupKeyboardShortcuts(mainWindow);
  setupMenu();
}

/**
 * 设置应用菜单
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

// 应用就绪
app.whenReady().then(async () => {
  registerIPCHandlers();
  
  // 初始化服务
  await initializeServices();
  
  createMainWindow();

  // macOS: 点击dock图标时重新创建窗口
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

// 所有窗口关闭时退出（Windows/Linux）
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 安全处理：阻止新窗口导航到未知URL
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    if (parsedUrl.origin !== 'http://localhost:5173' && parsedUrl.protocol !== 'file:') {
      event.preventDefault();
    }
  });
});

/**
 * 初始化服务
 */
async function initializeServices(): Promise<void> {
  try {
    // 获取 workspace 路径
    const workspacePath = storageAdapter.getWorkspacePath();
    
    // 初始化 RDC 工具适配器
    await rdcToolAdapter.initialize();
    console.log('[Main] RDCToolAdapter initialized');
    
    // 初始化 WorkflowGraph
    initWorkflowGraph(workspacePath);
    console.log('[Main] WorkflowGraph initialized');
  } catch (error) {
    console.error('[Main] Failed to initialize services:', error);
  }
}

// 导出窗口引用供IPC使用
export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
