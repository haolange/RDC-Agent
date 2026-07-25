import { ipcMain } from 'electron';
import { resolveFaviconDataUrl } from '../media/FaviconResolveService';
import { parseIpcArgs } from './validation/IpcPayloadGuard';
import { WebResolveFaviconArgsSchema } from './validation/webSchemas';

export function registerWebHandlers(): void {
  ipcMain.handle('web:resolveFavicon', async (_event, ...rawArgs: unknown[]) => {
    try {
      const [domain] = parseIpcArgs(WebResolveFaviconArgsSchema, rawArgs, {
        label: 'web:resolveFavicon',
        maxBytes: 4 * 1024,
      });
      return await resolveFaviconDataUrl(domain);
    } catch (error) {
      console.warn('[IPC] Failed to resolve favicon:', error);
      return { dataUrl: null };
    }
  });
}
