import { ipcMain } from 'electron';
import { z } from 'zod';
import { providerProbeBatchService } from '../settings/provider-catalog/ProviderProbeBatchService';
import { shutdownCoordinator } from '../lifecycle/ShutdownCoordinator';
import { parseIpcArgs, ipcNonEmptyString } from './validation/IpcPayloadGuard';
import { EmptyArgsSchema } from './validation/commonIpcSchemas';
import type { WorkbenchIpcContext } from './workbenchContext';

const requestSchema = z.tuple([z.object({
  providerIds: z.array(ipcNonEmptyString(200, 'providerId')).max(300).optional(),
  retryRunId: ipcNonEmptyString(100, 'retryRunId').optional(),
}).strict()]);
const idSchema = z.tuple([ipcNonEmptyString(100, 'runId')]);

export function registerProviderProbeHandlers(context: WorkbenchIpcContext): void {
  providerProbeBatchService.subscribe(batch => context.broadcastToRenderer('llm:probeBatchChanged', batch));
  shutdownCoordinator.register({ id: 'provider-probes.dispose', phase: 'abort_all', dispose: () => providerProbeBatchService.dispose() });
  ipcMain.handle('llm:prepareProbeBatch', (_event, ...raw: unknown[]) => {
    const [request] = parseIpcArgs(requestSchema, raw, { label: 'llm:prepareProbeBatch', maxBytes: 64 * 1024 });
    return providerProbeBatchService.prepare(request);
  });
  ipcMain.handle('llm:startProbeBatch', (_event, ...raw: unknown[]) => {
    const [id] = parseIpcArgs(idSchema, raw, { label: 'llm:startProbeBatch', maxBytes: 1024 });
    return providerProbeBatchService.start(id);
  });
  ipcMain.handle('llm:cancelProbeBatch', (_event, ...raw: unknown[]) => {
    const [id] = parseIpcArgs(idSchema, raw, { label: 'llm:cancelProbeBatch', maxBytes: 1024 });
    return providerProbeBatchService.cancel(id);
  });
  ipcMain.handle('llm:getProbeBatch', (_event, ...raw: unknown[]) => {
    parseIpcArgs(EmptyArgsSchema, raw, { label: 'llm:getProbeBatch', maxBytes: 1024 });
    return providerProbeBatchService.get();
  });
}
