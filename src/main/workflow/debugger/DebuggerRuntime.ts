import type { ConversationMessage } from '@shared/types/conversation';
import type { AgentRole } from '@shared/types/agent';
import type { AskUserAnswer, WorkflowStage } from '@shared/types/workflow';
import type { DebugSessionStartRequest } from '@shared/types/session';
import type {
  TraceExportOptions,
  TraceExportResult,
  TraceRevisionResult,
  TraceSessionResult,
  TraceBranchSwitchResult,
} from '@shared/types/workstream';
import { debugWorkflowService, type PlanResult, type StartWorkflowResult } from './DebugWorkflowService';
import { isToolAllowedForAgent, resolveAgentToolAllowlist } from './DebuggerRuntimePolicy';

export interface ConversationDebuggerStartRequest extends DebugSessionStartRequest {
  source: 'conversation';
  message: ConversationMessage;
}

export class DebuggerRuntime {
  recoverInterruptedRuns(): Promise<void> {
    return debugWorkflowService.recoverInterruptedRuns();
  }

  startPlan(request: DebugSessionStartRequest): Promise<StartWorkflowResult> {
    return debugWorkflowService.startPlan(request);
  }

  requestStartFromConversation(request: ConversationDebuggerStartRequest): Promise<StartWorkflowResult> {
    const { source: _source, message: _message, ...startRequest } = request;
    return this.startPlan(startRequest);
  }

  getPlan(runId: string): Promise<PlanResult> {
    return debugWorkflowService.getPlan(runId);
  }

  submitQuestions(runId: string, answers: AskUserAnswer[]): Promise<PlanResult> {
    return debugWorkflowService.submitQuestions(runId, answers);
  }

  approvePlan(runId: string): Promise<PlanResult> {
    return debugWorkflowService.approvePlan(runId);
  }

  getWorkstreamSession(sessionId: string): Promise<TraceSessionResult> {
    return debugWorkflowService.getWorkstreamSession(sessionId);
  }

  requestPlanRevision(runId: string, revisionText: string): Promise<TraceRevisionResult> {
    return debugWorkflowService.requestPlanRevision(runId, revisionText);
  }

  switchWorkstreamBranch(sessionId: string, branchId: string): Promise<TraceBranchSwitchResult> {
    return debugWorkflowService.switchWorkstreamBranch(sessionId, branchId);
  }

  exportWorkstreamSession(sessionId: string, options?: TraceExportOptions): Promise<TraceExportResult> {
    return debugWorkflowService.exportWorkstreamSession(sessionId, options);
  }

  restartRun(runId: string): Promise<PlanResult> {
    return debugWorkflowService.restartRun(runId);
  }

  stopRun(runId: string): Promise<{ success: boolean; error?: string }> {
    return debugWorkflowService.stopRun(runId);
  }

  getWorkflowState(sessionId: string, runId?: string) {
    return debugWorkflowService.getWorkflowState(sessionId, runId);
  }

  resolveAgentToolAllowlist(agentId: AgentRole, stage?: WorkflowStage): string[] {
    return resolveAgentToolAllowlist(agentId, stage);
  }

  isToolAllowedForAgent(toolName: string, agentId: AgentRole, stage?: WorkflowStage): boolean {
    return isToolAllowedForAgent(toolName, agentId, stage);
  }
}

export const debuggerRuntime = new DebuggerRuntime();
