import { ipcMain } from 'electron';
import { resolveFaviconDataUrl } from '../media/FaviconResolveService';
import { RemoteImageProvenance } from '../media/RemoteImageProvenance';
import { fetchRemoteImage, type RemoteImageResult } from '../media/RemoteImageService';
import { auditArgumentsHash, auditLog } from '../runtime/AuditLog';
import { conversationHistoryStore } from '../sessions/store/sessionStores';
import { requireActiveSessionOwner } from './sessionOwnerGate';
import { parseIpcArgs } from './validation/IpcPayloadGuard';
import { WebFetchImageArgsSchema, WebResolveFaviconArgsSchema } from './validation/webSchemas';
import type { WorkbenchIpcContext } from './workbenchContext';

const remoteImageProvenance = new RemoteImageProvenance((sessionId) =>
  conversationHistoryStore.readConversationHistory(sessionId),
);

export function registerWebHandlers(context: WorkbenchIpcContext): void {
  const { state } = context;
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

  // Images an answer embeds from the web, fetched here so the renderer's img-src never opens to remote hosts. One loads
  // by itself only when its URL came from outside the model in this session (a web or knowledge result, a message the
  // person wrote); a URL the model wrote is fetched only when the person asks, and that request is audited first.
  ipcMain.handle('web:fetchImage', async (_event, ...rawArgs: unknown[]): Promise<RemoteImageResult> => {
    const [request] = parseIpcArgs(WebFetchImageArgsSchema, rawArgs, { label: 'web:fetchImage', maxBytes: 8 * 1024 });
    requireActiveSessionOwner(state, request.sessionId);
    if (request.intent === 'auto' && !remoteImageProvenance.isFromNonModelSource(request.sessionId, request.url)) {
      return { dataUrl: null, error: 'REMOTE_IMAGE_UNVERIFIED' };
    }
    if (request.intent === 'click') {
      const host = URL.canParse(request.url) ? new URL(request.url).host : '';
      auditLog.record({
        kind: 'network',
        purpose: 'remote-image',
        host,
        urlSha256: auditArgumentsHash(request.url),
        sessionId: request.sessionId,
      });
    }
    return fetchRemoteImage(request.url);
  });
}
