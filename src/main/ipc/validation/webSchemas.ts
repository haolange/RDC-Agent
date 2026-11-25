import { z } from 'zod';
import { ipcString } from './IpcPayloadGuard';

export const WebResolveFaviconArgsSchema = z.tuple([
  ipcString(253, 'domain'),
]);

export const WebFetchImageArgsSchema = z.tuple([
  z.object({
    sessionId: ipcString(256, 'sessionId'),
    url: ipcString(4096, 'url'),
    intent: z.enum(['auto', 'click']),
  }).strict(),
]);
