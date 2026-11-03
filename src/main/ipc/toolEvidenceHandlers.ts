import { ipcMain } from 'electron';
import { storageAdapter } from '../sessions/store/StorageAdapter';
import { rdcCliInvokerService } from '../rdc/RdcCliInvokerService';
import { agentOrchestrator } from '../agent-runtime/orchestration/AgentOrchestrator';
import type { WorkbenchIpcContext } from './workbenchContext';
import { parseIpcArgs } from './validation/IpcPayloadGuard';
import { EmptyArgsSchema } from './validation/commonIpcSchemas';
import { RdcInstallationArgsSchema } from './validation/rdcInstallationSchemas';
import { detectRdcInstallations, resolveRdcInstallation } from '../rdc/RdcInstallationService';
import { settingsService } from '../settings/settings-core/SettingsService';
import { parseRdcNativeResult } from '../rdc/RdcNativeProtocol';

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
    parseRdcNativeResult(await rdcCliInvokerService.executeCLI('doctor', ['--json'], { settings }), undefined, 'rdc_tool.doctor');
    return { settings, summary };
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
}
