/**
 * Electron Preload Script
 *
 * Sandbox-compatible: only contextBridge + ipcRenderer (+ process.platform).
 * Do not import Node builtins (fs/path/child_process) here.
 *
 * Exposes a channel-checked IPC bridge (`rdcIpc`) and nothing else of IPC; the renderer builds its typed API on it
 * (`src/renderer/platform/rendererApi.ts`), so failed calls become typed errors in the renderer's own realm.
 */

import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { isRendererEventChannel, isRendererInvokeChannel } from '@shared/renderer-api/channels';
import type { DesktopIpc } from '@shared/renderer-api/transport';

const rdcIpc: DesktopIpc = {
  platform: process.platform,
  invoke(channel, ...args) {
    if (!isRendererInvokeChannel(channel))
      return Promise.reject(new Error(`Undeclared IPC channel: ${String(channel)}`));
    return ipcRenderer.invoke(channel, ...args) as Promise<unknown>;
  },
  subscribe(channel, callback) {
    if (!isRendererEventChannel(channel)) throw new Error(`Undeclared IPC event channel: ${String(channel)}`);
    const listener = (_event: unknown, ...args: unknown[]): void => callback(...args);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  },
};

contextBridge.exposeInMainWorld('rdcIpc', rdcIpc);
contextBridge.exposeInMainWorld('rdcDesktop', {
  getPathForFile(file: File): string | null {
    try {
      const filePath = webUtils.getPathForFile(file);
      return filePath || null;
    } catch {
      return null;
    }
  },
});
