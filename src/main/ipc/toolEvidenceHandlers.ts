import { ipcMain } from 'electron';
import { storageAdapter } from '../sessions/StorageAdapter';
import { rdcCliInvokerService } from '../tools/RdcCliInvokerService';
import { agentOrchestrator } from '../workflow/debugger/AgentOrchestrator';
import type { WorkbenchIpcContext } from './workbenchContext';
import { parseIpcArgs } from './validation/IpcPayloadGuard';
import { EmptyArgsSchema } from './validation/commonIpcSchemas';
import { EvidenceGetEventsArgsSchema } from './validation/toolEvidenceSchemas';
import { RdcInstallationArgsSchema } from './validation/rdcInstallationSchemas';
import { detectRdcInstallations, resolveRdcInstallation } from '../tools/RdcInstallationService';
import { settingsService } from '../settings/SettingsService';

export function registerToolEvidenceHandlers(context: WorkbenchIpcContext): void {
  const { state } = context;
  ipcMain.handle('tool:detectInstallations', (_event, ...rawArgs: unknown[]) => {
    parseIpcArgs(EmptyArgsSchema, rawArgs, { label: 'tool:detectInstallations', maxBytes: 1024 });
    return detectRdcInstallations(settingsService.getAll().tooling.rdcCli);
  });
  ipcMain.handle('tool:resolveInstallation', (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(RdcInstallationArgsSchema, rawArgs, { label: 'tool:resolveInstallation', maxBytes: 65536 });
    return resolveRdcInstallation(request);
  });
  ipcMain.handle('tool:verifyInstallation', async (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(RdcInstallationArgsSchema, rawArgs, { label: 'tool:verifyInstallation', maxBytes: 65536 });
    const settings = resolveRdcInstallation(request);
    const summary = await rdcCliInvokerService.getRuntimeSummary(true, settings);
    if (!summary.cli.available) throw new Error(summary.cli.unavailableReason);
    return { settings, summary };
  });

  ipcMain.handle('tool:getCatalog', async (_event, ...rawArgs: unknown[]) => {
    parseIpcArgs(EmptyArgsSchema, rawArgs, { label: 'tool:getCatalog', maxBytes: 1024 });
    return rdcCliInvokerService.loadCatalog();
  });

  ipcMain.handle('tool:getRuntimeSummary', async (_event, ...rawArgs: unknown[]) => {
    parseIpcArgs(EmptyArgsSchema, rawArgs, { label: 'tool:getRuntimeSummary', maxBytes: 1024 });
    return rdcCliInvokerService.getRuntimeSummary(true);
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
