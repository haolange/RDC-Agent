import { z } from 'zod';
import { ipcString } from './IpcPayloadGuard';

export const WebResolveFaviconArgsSchema = z.tuple([
  ipcString(253, 'domain'),
]);

export const WebFetchImageArgsSchema = z.tuple([
  ipcString(4096, 'url'),
]);
