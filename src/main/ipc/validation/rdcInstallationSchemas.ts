import { z } from 'zod';
import { ipcNonEmptyString, ipcString } from './IpcPayloadGuard';

export const RdcInstallationArgsSchema = z.tuple([z.object({
  root: ipcNonEmptyString(4096, 'root'),
  timeoutMs: z.number().int().min(1000).max(600000),
  env: z.record(z.string().min(1).max(200), ipcString(16000, 'environment value')),
}).strict()]);
