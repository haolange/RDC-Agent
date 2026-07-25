import { z } from 'zod';
import { ipcString } from './IpcPayloadGuard';

export const WebResolveFaviconArgsSchema = z.tuple([
  ipcString(253, 'domain'),
]);
