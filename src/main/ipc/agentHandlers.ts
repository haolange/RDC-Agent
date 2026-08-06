import { ipcMain } from 'electron';
import { agentOrchestrator } from '../workflow/debugger/AgentOrchestrator';
import { runExecutionService } from '../workflow/debugger/RunExecutionService';
import { storageAdapter } from '../sessions/StorageAdapter';
import type { WorkbenchIpcContext } from './workbenchContext';
import { parseIpcArgs } from './validation/IpcPayloadGuard';
import { EmptyArgsSchema } from './validation/commonIpcSchemas';
import {
  AgentConfigureArgsSchema,
  AgentGetStateArgsSchema,
  AgentSendMessageArgsSchema,
} from './validation/agentSchemas';

export function registerAgentHandlers(context: WorkbenchIpcContext): void {
  const { state } = context;

  ipcMain.handle('agent:sendMessage', async (_event, ...rawArgs: unknown[]) => {
    try {
      const [agentId, content] = parseIpcArgs(AgentSendMessageArgsSchema, rawArgs, {
        label: 'agent:sendMessage',
        maxBytes: 512 * 1024,
      });
      let runContext: { caseId?: string; runId?: string; sessionId?: string; projectId?: string; projectRootPath?: string | null } | undefined;

      if (state.currentSessionId) {
        const currentRun = state.currentRunId
          ? storageAdapter.listRuns(state.currentSessionId).find((run) => run.runId === state.currentRunId)
          : storageAdapter.getLatestRun(state.currentSessionId);
        if (currentRun) {
          runContext = {
            caseId: currentRun.caseId,
            runId: currentRun.runId,
            sessionId: currentRun.sessionId,
          };
        }
      }

      const currentProjectId = storageAdapter.getCurrentProjectId();
      if (currentProjectId) {
        runContext = {
          ...runContext,
          projectId: currentProjectId,
          projectRootPath: storageAdapter.getProjectById(currentProjectId)?.rootPath ?? null,
        };
      }

      const response = await agentOrchestrator.sendMessage(agentId as any, content, runContext, {
        signal: (runContext?.runId ? runExecutionService.getAbortSignal(runContext.runId) : null) ?? undefined,
      });
      return { response };
    } catch (error) {
      return {
        response: undefined,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle('agent:getState', async (_event, ...rawArgs: unknown[]) => {
    const [agentId, sessionId] = parseIpcArgs(AgentGetStateArgsSchema, rawArgs, {
      label: 'agent:getState',
      maxBytes: 4 * 1024,
    });
    if (!sessionId) return null;
    return agentOrchestrator.getAgentState(sessionId, agentId as any);
  });

  ipcMain.handle('agent:getAllStates', async (_event, ...rawArgs: unknown[]) => {
    parseIpcArgs(EmptyArgsSchema, rawArgs, { label: 'agent:getAllStates', maxBytes: 1024 });
    return agentOrchestrator.getAllAgentStates();
  });

  ipcMain.handle('agent:configure', async (_event, ...rawArgs: unknown[]) => {
    try {
      const [agentId, config] = parseIpcArgs(AgentConfigureArgsSchema, rawArgs, {
        label: 'agent:configure',
        maxBytes: 64 * 1024,
      });
      agentOrchestrator.configureAgent(agentId as any, config as any);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}
