import { ipcMain } from 'electron';
import { resolveFaviconDataUrl } from '../services/FaviconResolveService';

export function registerWebHandlers(): void {
  ipcMain.handle('web:resolveFavicon', async (_event, domain: string) => {
    try {
      return await resolveFaviconDataUrl(typeof domain === 'string' ? domain : '');
    } catch (error) {
      console.warn('[IPC] Failed to resolve favicon:', error);
      return { dataUrl: null };
    }
  });
}
