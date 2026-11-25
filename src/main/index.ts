import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { app, BrowserWindow, dialog, session } from 'electron';
import { APP_MIN_WINDOW_HEIGHT, APP_MIN_WINDOW_WIDTH } from '@shared/constants/layout';
import { buildRendererCsp } from '@shared/utils/rendererCsp';
import { installApplicationMenu } from './window/applicationMenu';
import { nativeMessage } from './window/nativeI18n';
import { providerAccountAuthService } from './settings/provider-auth/ProviderAccountAuthService';
import { appPathService } from './runtime/AppPathService';
/**
 * Electron Main Process Entry
 */


import { registerIPCHandlers, setMainWindow, initializeIpcState, stopAllActiveRuns } from './ipc/handlers';
import { projectWorkspaceStore, sessionRecordStore } from './sessions/store/sessionStores';
import { rdcSessionService } from './rdc/RdcSessionService';
import { harvestOwnedRdcDaemons } from './rdc/OwnedRdcDaemonRegistry';
import { settingsService } from './settings/settings-core/SettingsService';
import { SettingsFileError } from './settings/settings-core/settingsFileSchema';
import { evaluateRdcShellBaseline } from './rdc/rdcShellPermission';
import { acquireRdcPreparationLock, setRdcInteractionLock } from './rdc/RdcOperationCoordinator';
import { registerConversationRdcHost } from './conversation/conversationRdcHost';
import { registerRdcShellBaseline } from './agent-runtime/permissions/AgentPermissionPolicy';
import { bindTraceProjectionSource } from './agent-runtime/orchestration/TraceProjectionRefreshService';
import { requestSnapshotStore } from './agent-runtime/prompt/RequestSnapshotStore';
import { removeSessionTasks } from './agent-runtime/tasks/sessionTaskStore';
import { traceService } from './agent-trace/TraceService';
import { rdcCliInvokerService } from './rdc/RdcCliInvokerService';
import { replayDeviceService } from './rdc/captures/ReplayDeviceService';
import { runtimeLogService } from './runtime/RuntimeLogService';
import { installProcessFaultHandlers, reportProcessFault } from './runtime/processFaultHandlers';
import { isDevelopmentRun } from './runtime/developmentRun';
import { onJsonlTailRepair } from './runtime/jsonl';
import { rendererEventHub } from './runtime/rendererEventHub';
import {
  shouldStartBrowserAppBridge,
  startBrowserAppBridge,
  stopBrowserAppBridge,
} from './browserAppBridge/BrowserAppBridgeServer';
import { shutdownCoordinator } from './lifecycle/ShutdownCoordinator';
import { conversationService } from './conversation/ConversationService';
import { agentOrchestrator } from './agent-runtime/orchestration/agentRuntimeRoot';
import { processSupervisor } from './runtime/ProcessSupervisor';
import { turnCoordinator } from './agent-runtime/orchestration/TurnCoordinator';
import {
  bindWindowLayoutPersistence,
  resolveWindowCreationOptions,
} from './window/windowLayoutPersistence';
import { bindProductIcon } from './window/productIcon';
import { reportSettingsStartupFailure } from './window/settingsStartupFailure';
import { resolvedAppearanceMode, windowBackgroundColor } from './window/appearanceChrome';
import { isTrustedRendererUrl, openExternalHttps, trustRendererEntry } from './runtime/rendererTrust';
import { resolveCanonicalUserDataPath } from './runtime/userDataPath';
import { acquireUserDataInstanceLock } from './runtime/userDataInstanceLock';
import { currentHost } from './platform/host';
import { currentProcessIdentity } from './platform/process';

/**
 * Lower domains declare the port they need and this composition root binds the implementation from the domain
 * above, once, before anything else runs.
 */
function bindCrossDomainHosts(): void {
  registerRdcShellBaseline(evaluateRdcShellBaseline);
  registerConversationRdcHost({
    acquirePreparationLock: acquireRdcPreparationLock,
    setInteractionLock: setRdcInteractionLock,
    snapshotOpenedCapture: (scope) => rdcSessionService.snapshotOpenedCaptureForSession(scope),
    replayDevice: (deviceId) => replayDeviceService.getDeviceById(deviceId),
  });
  bindTraceProjectionSource(traceService);
  sessionRecordStore.addSideChannels(requestSnapshotStore);
  sessionRecordStore.addSideChannels({ removeSession: removeSessionTasks });
}
bindCrossDomainHosts();

const SHUTDOWN_TIMEOUT_MS = 45_000;
let shutdownStarted = false;
let shutdownExitCode = 0;
let settingsInitialized = false;

function registerShutdownDisposables(): void {
  shutdownCoordinator.register({ id: 'oauth.dispose', phase: 'terminate_processes', dispose: () => providerAccountAuthService.dispose() });
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
    id: 'rdc.close-runtime',
    phase: 'release_owned_runtimes',
    dispose: async () => {
      if (settingsInitialized) {
        await rdcSessionService.closeAll();
      }
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

const isDev = isDevelopmentRun({ isPackaged: app.isPackaged, env: process.env });
const isBrowserQa = shouldStartBrowserAppBridge();
const isHeadlessMode = process.env.RDC_AGENT_HEADLESS === '1' || isBrowserQa;
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

  const csp = buildRendererCsp(isDev ? 'development' : 'production');

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
const useDisposableBrowserQaUserData = isBrowserQa
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
  const isolatedHome = path.join(userDataPath, '.rdc-agent');
  fs.mkdirSync(isolatedHome, { recursive: true });
  appPathService.isolateUserRdcRoot(isolatedHome);
  console.log(`[RDC-Agent] Isolated Browser QA home: ${isolatedHome}`);
}
app.commandLine.appendSwitch('user-data-dir', userDataPath);
app.setPath('userData', userDataPath);
// Installed once userData is fixed, so the runtime log lands in this instance's log file.
installProcessFaultHandlers();
console.log('[RDC-Agent] Startup identity:', JSON.stringify({
  version: app.getVersion(),
  carrier: isHeadlessMode ? 'browser' : app.isPackaged ? 'packaged-desktop' : 'source-desktop',
  application: app.getAppPath(),
  userData: userDataPath,
  userResources: appPathService.getUserRdcRoot(),
}));

const userDataLock = acquireUserDataInstanceLock(userDataPath, {
  ...currentProcessIdentity(),
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

function exitMainProcess(code: number): void {
  if (userDataLock.acquired) {
    try {
      userDataLock.release();
    } catch (error) {
      console.error('[Main] Failed to release userData lock:', error);
    }
  }
  app.exit(code);
}

// Both carriers own the canonical userData lock above. The headless Browser
// skips Electron's window-oriented single-instance redirect; instance.lock is
// the cross-carrier boundary, while visible desktop instances keep both locks.
const hasSingleInstanceLock = isHeadlessMode || app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  console.log('[RDC-Agent] Another instance is already running. Reusing the existing instance.');
  exitMainProcess(0);
}

if (isHeadlessMode) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('in-process-gpu');
}

// Main window reference.
let mainWindow: BrowserWindow | null = null;
let headlessKeepAliveTimer: NodeJS.Timeout | null = null;

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
    title: nativeMessage('selectCaptures'),
    filters: [
      { name: nativeMessage('captureFilter'), extensions: ['rdc'] },
    ],
    properties: ['openFile', 'multiSelections'],
  });

  if (!result.canceled && result.filePaths.length > 0) {
    runtimeLogService.log({
      scope: 'app',
      namespace: 'system',
      severity: 'info',
      title: 'Open files',
      summary: nativeMessage('selectedCaptures', { count: result.filePaths.length }),
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
  const savedWindow = settingsService.snapshot().user.layout.window;
  const windowOptions = resolveWindowCreationOptions(savedWindow);

  mainWindow = new BrowserWindow({
    width: windowOptions.width,
    height: windowOptions.height,
    ...(typeof windowOptions.x === 'number' && typeof windowOptions.y === 'number'
      ? { x: windowOptions.x, y: windowOptions.y }
      : {}),
    minWidth: APP_MIN_WINDOW_WIDTH,
    minHeight: APP_MIN_WINDOW_HEIGHT,
    title: 'RDC-Agent',
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
    backgroundColor: windowBackgroundColor(settingsService.snapshot().user.appearance),
  });
  bindProductIcon(mainWindow);

  // Load the renderer. The boot theme rides along so the first paint already uses the chosen light or dark palette.
  const bootTheme = resolvedAppearanceMode(settingsService.snapshot().user.appearance);
  if (isDev) {
    const rendererUrl = getDevRendererUrl();
    trustRendererEntry(rendererUrl);
    const entry = new URL(rendererUrl);
    entry.searchParams.set('theme', bootTheme);
    mainWindow.loadURL(entry.href).catch((error: unknown) => reportProcessFault('Renderer failed to load', error));
  } else {
    // Production mode loads the bundled renderer.
    const rendererEntry = path.join(__dirname, '../renderer/index.html');
    trustRendererEntry(pathToFileURL(rendererEntry).href);
    mainWindow.loadFile(rendererEntry, { query: { theme: bootTheme } })
      .catch((error: unknown) => reportProcessFault('Renderer failed to load', error));
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

  mainWindow.webContents.on('console-message', (details) => {
    console.log('[RendererConsole]', { level: details.level, message: details.message,
      line: details.lineNumber, sourceId: details.sourceId });
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('[RendererLoadFailed]', { errorCode, errorDescription, validatedURL });
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[RendererProcessGone]', details);
  });

  // Links never open app windows: https pages open in the system browser and everything else is refused.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalHttps(url).catch((error: unknown) => console.warn('[window] external link refused', error));
    return { action: 'deny' };
  });

  // Register window controls and shortcuts.
  setMainWindow(mainWindow);
  setupKeyboardShortcuts(mainWindow);
  installApplicationMenu({
    openRdcFiles,
    newCase: () => { rendererEventHub.emit('case:new'); mainWindow?.webContents.send('case:new'); },
    openSettings: () => { rendererEventHub.emit('settings:open'); mainWindow?.webContents.send('settings:open'); },
  });
}

// App lifecycle.
app.whenReady().then(async () => {
  installRendererSecurityPolicy();
  try {
    settingsService.initialize();
  } catch (error) {
    if (!(error instanceof SettingsFileError)) throw error;
    // An unusable settings file is never converted or repaired: the user deletes it and reconfigures in Settings.
    console.error('[Main] Settings file cannot be used:', error);
    reportSettingsStartupFailure(error.filePath, isHeadlessMode);
    shutdownExitCode = 1;
    app.quit();
    return;
  }
  settingsInitialized = true;

  await projectWorkspaceStore.initializeWorkspace();
  onJsonlTailRepair((repair) => runtimeLogService.log({
    scope: 'app',
    namespace: 'system',
    severity: 'warning',
    title: 'Interrupted record set aside',
    summary: `An incomplete final record (${repair.length} bytes) was moved out of ${repair.filePath}.`,
    raw: { ...repair },
  }));
  runtimeLogService.log({
    scope: 'app',
    namespace: 'system',
    severity: 'info',
    title: 'App ready',
    summary: 'RDC Agent 主进程已启动。',
    raw: {
      workspaceRoot: projectWorkspaceStore.getWorkspacePath(),
    },
  });

  registerIPCHandlers();

  // Initialize main process services.
  await initializeServices();
  if (isBrowserQa) {
    const bridgeUrl = await startBrowserAppBridge({
      devRendererUrl: isDev ? getDevRendererUrl() : null,
      rendererRoot: path.join(__dirname, '../renderer'),
      mainBundlePath: path.join(__dirname, 'index.js'),
      appVersion: app.getVersion(),
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
    shutdownExitCode = 1;
    app.quit();
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
}).catch((error: unknown) => {
  console.error('[Main] Startup failed:', error);
  shutdownExitCode = 1;
  app.quit();
});

// Quit after all windows close on Windows/Linux.
app.on('window-all-closed', () => {
  if (isHeadlessMode) {
    return;
  }
  if (!currentHost().isMac) {
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
  const exitAfterShutdown = () => exitMainProcess(shutdownExitCode);
  void shutdownCoordinator.shutdownAll(SHUTDOWN_TIMEOUT_MS, exitAfterShutdown).then(exitAfterShutdown);
});

// External QA/CLI launchers use process signals; route them through the same shutdown state machine.
const requestProcessShutdown = () => {
  if (!shutdownStarted) app.quit();
};
process.once('SIGINT', requestProcessShutdown);
process.once('SIGTERM', requestProcessShutdown);

// Only the app's own entry document may load in a window.
app.on('web-contents-created', (_event, contents) => {
  const refuseUntrusted = (event: { preventDefault(): void }, navigationUrl: string) => {
    if (!isTrustedRendererUrl(navigationUrl)) event.preventDefault();
  };
  // Covers links, redirects and files dropped onto the window.
  contents.on('will-navigate', refuseUntrusted);
  contents.on('will-redirect', refuseUntrusted);
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

/**
 * Initialize main process services.
 */
async function initializeServices(): Promise<void> {
  try {
    // SettingsService is initialized lazily by this access.
    const hasConfiguredProvider = settingsService.hasConfiguredProvider();
    console.log('[Main] SettingsService initialized, hasConfiguredProvider:', hasConfiguredProvider);
    
    await rdcCliInvokerService.getRuntimeSummary();
    console.log('[Main] RDC-Tool CLI invoker initialized');
    // Harvest logs its own failures and unconfirmed state; a failure there never stops the rest of startup.
    const leftover = await harvestOwnedRdcDaemons();
    if (leftover.released.length) {
      runtimeLogService.log({
        scope: 'app',
        namespace: 'context',
        severity: 'info',
        title: 'RDC leftover daemons released',
        summary: leftover.released.join(', '),
        raw: leftover,
      });
    }
    runtimeLogService.log({
      scope: 'app',
      namespace: 'system',
      severity: 'success',
      title: 'RDC-Tool CLI invoker ready',
      summary: 'RDC-Tool CLI invoker 诊断已加载。',
    });
    
    await initializeIpcState();
    console.log('[Main] IPC state initialized');

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
