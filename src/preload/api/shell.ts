import { ipcRenderer } from 'electron';
import type { AppMetaApi, AppShellApi, DialogApi, WindowControlsApi } from '@shared/types/electron-api';

export const createAppMetaApi = (): AppMetaApi => ({
  get: (): ReturnType<AppMetaApi['get']> => ipcRenderer.invoke('app:getMeta'),
});

export const createAppShellApi = (): AppShellApi => ({
  selectAvatar: (): ReturnType<AppShellApi['selectAvatar']> => ipcRenderer.invoke('app:selectAvatar'),
  getAvatarDataUrl: (avatarPath): ReturnType<AppShellApi['getAvatarDataUrl']> =>
    ipcRenderer.invoke('app:getAvatarDataUrl', avatarPath),
  openPath: (targetPath): ReturnType<AppShellApi['openPath']> => ipcRenderer.invoke('app:openPath', targetPath),
  copyText: (text): ReturnType<AppShellApi['copyText']> => ipcRenderer.invoke('app:copyText', text),
});

export const createDialogApi = (): DialogApi => ({
  selectFiles: (): ReturnType<DialogApi['selectFiles']> => ipcRenderer.invoke('dialog:selectFiles'),
  selectRdcFiles: (): ReturnType<DialogApi['selectRdcFiles']> => ipcRenderer.invoke('dialog:selectRdcFiles'),
  selectDirectory: (): ReturnType<DialogApi['selectDirectory']> => ipcRenderer.invoke('dialog:selectDirectory'),
});

export const createWindowControlsApi = (): WindowControlsApi => ({
  minimize: (): ReturnType<WindowControlsApi['minimize']> => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: (): ReturnType<WindowControlsApi['toggleMaximize']> => ipcRenderer.invoke('window:toggleMaximize'),
  close: (): ReturnType<WindowControlsApi['close']> => ipcRenderer.invoke('window:close'),
  isMaximized: (): ReturnType<WindowControlsApi['isMaximized']> => ipcRenderer.invoke('window:isMaximized'),
});
