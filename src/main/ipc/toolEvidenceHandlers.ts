import { ipcMain } from 'electron';
import { storageAdapter } from '../sessions/StorageAdapter';
import { rdxCliInvokerService } from '../tools/RdxCliInvokerService';
import { agentOrchestrator } from '../workflow/debugger/AgentOrchestrator';
import type { WorkbenchIpcContext } from './workbenchContext';
import { parseIpcArgs } from './validation/IpcPayloadGuard';
import { EmptyArgsSchema } from './validation/commonIpcSchemas';
import { EvidenceGetEventsArgsSchema } from './validation/toolEvidenceSchemas';

export function registerToolEvidenceHandlers(context: WorkbenchIpcContext): void {
  const { state } = context;

  ipcMain.handle('tool:getCatalog', async (_event, ...rawArgs: unknown[]) => {
    parseIpcArgs(EmptyArgsSchema, rawArgs, { label: 'tool:getCatalog', maxBytes: 1024 });
    try {
      return await rdxCliInvokerService.loadCatalog();
    } catch {
      return { tools: [], namespaces: {} };
    }
  });

  ipcMain.handle('tool:getRuntimeSummary', async (_event, ...rawArgs: unknown[]) => {
    parseIpcArgs(EmptyArgsSchema, rawArgs, { label: 'tool:getRuntimeSummary', maxBytes: 1024 });
    return rdxCliInvokerService.getRuntimeSummary();
  });

  ipcMain.handle('mcp:getStatusSummary', async (_event, ...rawArgs: unknown[]) => {
    parseIpcArgs(EmptyArgsSchema, rawArgs, { label: 'mcp:getStatusSummary', maxBytes: 1024 });
    const projectId = state.currentProjectId ?? storageAdapter.getCurrentProjectId();
    const projectRoot = projectId
      ? storageAdapter.getProjectById(projectId)?.rootPath ?? null
      : null;
    return agentOrchestrator.getMcpServerStatusSummary(projectRoot);
  });

  ipcMain.handle('evidence:getChain', async (_event, ...rawArgs: unknown[]) => {
    parseIpcArgs(EmptyArgsSchema, rawArgs, { label: 'evidence:getChain', maxBytes: 1024 });
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

  ipcMain.handle('evidence:getEvents', async (_event, ...rawArgs: unknown[]) => {
    const [eventType] = parseIpcArgs(EvidenceGetEventsArgsSchema, rawArgs, {
      label: 'evidence:getEvents',
      maxBytes: 4 * 1024,
      padTo: 1,
    });
    const sessionId = await storageAdapter.getCurrentSessionId();
    if (!sessionId) return [];

    const events = await storageAdapter.readActionChain(sessionId);
    if (eventType) {
      return events.filter((event) => event.event_type === eventType);
    }
    return events;
  });
}
