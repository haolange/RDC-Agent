import { z } from 'zod';
import { RDC_NO_PROGRESS_TIMEOUT_RANGE_MS } from '@shared/constants/appSettingsDefaults';
import { ipcNonEmptyString, ipcString } from './IpcPayloadGuard';

export const RdcInstallationArgsSchema = z.tuple([
  z
    .object({
      root: ipcNonEmptyString(4096, 'root'),
      noProgressTimeoutMs: z
        .number()
        .int()
        .min(RDC_NO_PROGRESS_TIMEOUT_RANGE_MS.min)
        .max(RDC_NO_PROGRESS_TIMEOUT_RANGE_MS.max),
      env: z.record(z.string().min(1).max(200), ipcString(16000, 'environment value')),
    })
    .strict(),
]);
