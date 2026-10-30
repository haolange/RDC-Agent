import { app, dialog, Menu, shell } from 'electron';
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
  if (process.platform === 'darwin') {
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
      {
        label: nativeMessage('help'),
        submenu: [
          {
            label: nativeMessage('documentation'),
            click: () => {
              shell.openExternal('https://github.com/haolange/RDC-Agent#readme');
            },
          },
          {
            label: nativeMessage('reportIssue'),
            click: () => {
              shell.openExternal('https://github.com/haolange/RDC-Agent/issues');
            },
          },
          { type: 'separator' },
          {
            label: nativeMessage('about'),
            click: () => {
              const version = app.getVersion();
              const detail = [
                nativeMessage('version', { version }),
                `Electron: ${process.versions.electron ?? 'N/A'}`,
                `Node: ${process.versions.node ?? 'N/A'}`,
                `Chrome: ${process.versions.chrome ?? 'N/A'}`,
              ].join('\n');
              void dialog.showMessageBox({
                type: 'info',
                title: nativeMessage('about'),
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
      label: nativeMessage('help'),
      submenu: [
        {
          label: nativeMessage('documentation'),
          click: () => {
            shell.openExternal('https://github.com/haolange/RDC-Agent#readme');
          },
        },
        {
          label: nativeMessage('reportIssue'),
          click: () => {
            shell.openExternal('https://github.com/haolange/RDC-Agent/issues');
          },
        },
        { type: 'separator' },
        {
          label: nativeMessage('about'),
          click: () => {
            const version = app.getVersion();
            void dialog.showMessageBox({
              type: 'info',
              title: nativeMessage('about'),
              message: 'RDC-Agent',
              detail: [
                nativeMessage('version', { version }),
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

