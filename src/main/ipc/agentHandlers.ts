import { ipcMain } from 'electron';
import { agentOrchestrator } from '../workflow/debugger/AgentOrchestrator';
import { runExecutionService } from '../workflow/debugger/RunExecutionService';
import { storageAdapter } from '../sessions/StorageAdapter';
import type { WorkbenchIpcContext } from './workbenchContext';

export function registerAgentHandlers(context: WorkbenchIpcContext): void {
  const { state } = context;

  ipcMain.handle('agent:sendMessage', async (_event, agentId: string, content: string) => {
    try {
      let runContext: { caseId?: string; runId?: string; sessionId?: string } | undefined;

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

  ipcMain.handle('agent:getState', async (_event, agentId: string) => {
    return agentOrchestrator.getAgentState(agentId as any);
  });

  ipcMain.handle('agent:getAllStates', async () => {
    return agentOrchestrator.getAllAgentStates();
  });

  ipcMain.handle('agent:configure', async (_event, agentId: string, config: unknown) => {
    try {
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
