import { ipcMain } from 'electron';
import { projectWorkspaceStore, sessionRecordStore } from '../sessions/store/sessionStores';
import { rdcCliInvokerService } from '../rdc/RdcCliInvokerService';
import { agentOrchestrator } from '../agent-runtime/orchestration/AgentOrchestrator';
import { detectRdcInstallations, resolveRdcInstallation } from '../rdc/RdcInstallationService';
import { settingsService } from '../settings/settings-core/SettingsService';
import { parseRdcNativeResult } from '../rdc/RdcNativeProtocol';
import { parseIpcArgs } from './validation/IpcPayloadGuard';
import { EmptyArgsSchema } from './validation/commonIpcSchemas';
import { RdcInstallationArgsSchema } from './validation/rdcInstallationSchemas';
import type { WorkbenchIpcContext } from './workbenchContext';

export function registerToolEvidenceHandlers(context: WorkbenchIpcContext): void {
  const { state } = context;
  ipcMain.handle('tool:detectInstallations', (_event, ...rawArgs: unknown[]) => {
    parseIpcArgs(EmptyArgsSchema, rawArgs, { label: 'tool:detectInstallations', maxBytes: 1024 });
    return detectRdcInstallations(settingsService.snapshot().user.tooling.rdcCli);
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
    const projectId = state.currentProjectId ?? projectWorkspaceStore.getCurrentProjectId();
    const projectRoot = projectId
      ? projectWorkspaceStore.getProjectById(projectId)?.rootPath ?? null
      : null;
    return agentOrchestrator.getMcpServerStatusSummary(projectRoot);
  });

  ipcMain.handle('evidence:getChain', async (_event, ...rawArgs: unknown[]) => {
    parseIpcArgs(EmptyArgsSchema, rawArgs, { label: 'evidence:getChain', maxBytes: 1024 });
    const sessionId = projectWorkspaceStore.getCurrentSessionId();
    if (!sessionId) {
      return { sessionId: '', runId: '', events: [], isValid: true };
    }

    const events = await sessionRecordStore.readActionChain(sessionId);

    return {
      sessionId,
      runId: state.currentRunId || sessionRecordStore.getLatestRun(sessionId)?.runId || '',
      events,
      isValid: true,
    };
  });
}
