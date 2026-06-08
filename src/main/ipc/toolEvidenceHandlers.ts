import { ipcMain } from 'electron';
import { storageAdapter } from '../sessions/StorageAdapter';
import { rdxCliInvokerService } from '../tools/RdxCliInvokerService';
import type { WorkbenchIpcContext } from './workbenchContext';

export function registerToolEvidenceHandlers(context: WorkbenchIpcContext): void {
  const { state } = context;

  ipcMain.handle('tool:getCatalog', async () => {
    try {
      return await rdxCliInvokerService.loadCatalog();
    } catch {
      return { tools: [], namespaces: {} };
    }
  });

  ipcMain.handle('tool:getRuntimeSummary', async () => {
    return rdxCliInvokerService.getRuntimeSummary();
  });

  ipcMain.handle('evidence:getChain', async () => {
    const sessionId = await storageAdapter.getCurrentSessionId();
    if (!sessionId) {
      return { sessionId: '', runId: '', events: [], isValid: true };
    }

    const events = await storageAdapter.readActionChain(sessionId);

    return {
      sessionId,
      runId: state.currentRunId || storageAdapter.getLatestRun(sessionId)?.runId || '',
      events,
      isValid: true,
    };
  });

  ipcMain.handle('evidence:getEvents', async (_event, eventType?: string) => {
    const sessionId = await storageAdapter.getCurrentSessionId();
    if (!sessionId) return [];

    const events = await storageAdapter.readActionChain(sessionId);
    if (eventType) {
      return events.filter((event) => event.event_type === eventType);
    }
    return events;
  });
}
