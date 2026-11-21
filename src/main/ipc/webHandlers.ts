import { ipcMain } from 'electron';
import { resolveFaviconDataUrl } from '../media/FaviconResolveService';
import { fetchRemoteImage } from '../media/RemoteImageService';
import { parseIpcArgs } from './validation/IpcPayloadGuard';
import { WebFetchImageArgsSchema, WebResolveFaviconArgsSchema } from './validation/webSchemas';

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

  // Images an answer embeds from the web: fetched here so the renderer's img-src never opens to remote hosts.
  ipcMain.handle('web:fetchImage', async (_event, ...rawArgs: unknown[]) => {
    const [url] = parseIpcArgs(WebFetchImageArgsSchema, rawArgs, { label: 'web:fetchImage', maxBytes: 8 * 1024 });
    return fetchRemoteImage(url);
  });
}
