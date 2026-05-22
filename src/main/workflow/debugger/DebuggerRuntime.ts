import type { ConversationMessage } from '@shared/types/conversation';
import type { AgentRole } from '@shared/types/agent';
import type { AskUserAnswer, WorkflowStage } from '@shared/types/workflow';
import type { DebugSessionStartRequest } from '@shared/types/session';
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
