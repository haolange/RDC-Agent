import { app, dialog, Menu, shell } from 'electron';
import { currentHost } from '../platform/host';
import { runtimeLogService } from '../runtime/RuntimeLogService';
import { nativeMessage } from './nativeI18n';

interface MenuActions {
  openRdcFiles: () => Promise<void>;
  newCase: () => void;
  openSettings: () => void;
}
let menuActions: MenuActions | undefined;

export function installApplicationMenu(actions: MenuActions): void {
  menuActions = actions;
  refreshApplicationMenu();
}

export function refreshApplicationMenu(): void {
  if (!menuActions) return;
  const { openRdcFiles, openSettings, newCase } = menuActions;
  if (currentHost().isMac) {
    const template: Electron.MenuItemConstructorOptions[] = [
      { role: 'appMenu' },
      {
        label: nativeMessage('file'),
        submenu: [
          {
            label: nativeMessage('openCapture'),
            accelerator: 'CmdOrCtrl+O',
            click: async () => openRdcFiles(),
          },
          {
            label: nativeMessage('newCase'),
            accelerator: 'CmdOrCtrl+N',
            click: () => {
              newCase();
            },
          },
          {
            label: nativeMessage('settings'),
            accelerator: 'CmdOrCtrl+,',
            click: () => {
              openSettings();
            },
          },
          { type: 'separator' },
          { role: 'close' },
        ],
      },
      {
        label: nativeMessage('edit'),
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
        label: nativeMessage('view'),
        submenu: [
          { role: 'reload' },
          { role: 'forceReload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      helpMenu(),
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    return;
  }

  // Non-darwin: still expose Help with real repo links (no placeholder URLs).
  Menu.setApplicationMenu(Menu.buildFromTemplate([helpMenu()]));
}

function helpMenu(): Electron.MenuItemConstructorOptions {
  return {
    label: nativeMessage('help'),
    submenu: [
      { label: nativeMessage('documentation'), click: () => openLink('https://github.com/haolange/RDC-Agent#readme') },
      { label: nativeMessage('reportIssue'), click: () => openLink('https://github.com/haolange/RDC-Agent/issues') },
      { type: 'separator' },
      { label: nativeMessage('about'), click: showAbout },
    ],
  };
}

function openLink(url: string): void {
  shell.openExternal(url).catch((error: unknown) => {
    runtimeLogService.log({
      scope: 'app', namespace: 'system', severity: 'error', title: 'Could not open link',
      summary: `${url}: ${error instanceof Error ? error.message : String(error)}`,
    });
  });
}

function showAbout(): void {
  const detail = [
    nativeMessage('version', { version: app.getVersion() }),
    `Electron: ${process.versions.electron}`,
    `Node: ${process.versions.node}`,
    `Chrome: ${process.versions.chrome}`,
  ].join('\n');
  void dialog.showMessageBox({ type: 'info', title: nativeMessage('about'), message: 'RDC-Agent', detail });
}
