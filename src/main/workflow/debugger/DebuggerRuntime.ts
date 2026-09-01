import type { AgentRole } from '@shared/types/agent';
import type { WorkflowStage, WorkflowState } from '@shared/types/workflow';
import type {
  TraceSessionResult,
  TraceBranchSwitchResult,
} from '@shared/types/trace';
import { nowIso } from '@shared/utils/id';
import { traceService } from '../../agent-trace/TraceService';
import { storageAdapter } from '../../sessions/StorageAdapter';
import { isToolAllowedForAgent, resolveAgentToolAllowlist } from './DebuggerRuntimePolicy';
import { runExecutionService } from './RunExecutionService';

export class DebuggerRuntime {
  async recoverInterruptedRuns(): Promise<void> {
    await Promise.resolve();
  }

  getTraceProjection(sessionId: string): Promise<TraceSessionResult> {
    return traceService.getSession(sessionId);
  }

  async switchTraceBranch(sessionId: string, branchId: string): Promise<TraceBranchSwitchResult> {
    const projection = await traceService.getSession(sessionId);
    return {
      ...projection,
      activeBranchId: branchId,
    };
  }

  stopRun(runId: string): { success: boolean; error?: string } {
    const stopped = runExecutionService.stopRun(runId);
    return stopped ? { success: true } : { success: false, error: 'No active run.' };
  }

  getWorkflowState(sessionId: string, runId?: string): WorkflowState | null {
    const run = runId
      ? storageAdapter.listRuns(sessionId).find((entry) => entry.runId === runId) ?? null
      : storageAdapter.getLatestRun(sessionId);
    if (!run) {
      return null;
    }

    const activeRun = runExecutionService.listActiveRuns().find((entry) => entry.runId === run.runId);
    return {
      caseId: run.caseId,
      runId: run.runId,
      sessionId: run.sessionId,
      currentStage: (activeRun?.stage as WorkflowStage | undefined) ?? (run.lastStage as WorkflowStage | undefined) ?? 'investigate',
      previousStages: [],
      entryMode: 'cli',
      backend: 'local',
      orchestrationMode: 'multi_agent',
      coordinationMode: 'staged_handoff',
      blockers: [],
      reasoningSummaries: [],
      lastUpdated: nowIso(),
    };
  }

  resolveAgentToolAllowlist(agentId: AgentRole, stage?: WorkflowStage): string[] {
    return resolveAgentToolAllowlist(agentId, stage);
  }

  isToolAllowedForAgent(toolName: string, agentId: AgentRole, stage?: WorkflowStage): boolean {
    return isToolAllowedForAgent(toolName, agentId, stage);
  }
}

export const debuggerRuntime = new DebuggerRuntime();
