import { BrowserWindow } from 'electron';
import type { AgentMessage, AgentState } from '@shared/types/agent';
import type { ActionEvent } from '@shared/types/evidence';
import type { ConversationStreamEvent } from '@shared/types/conversation';
import type { RunContextUsageSummary, RunSummary, SessionScope } from '@shared/types/session';
import type { WorkflowState } from '@shared/types/workflow';
import type { AgentRunPresentation } from '@shared/types/agenticTrace';
import { rendererEventHub } from '../../browserAppBridge/rendererEventHub';

export interface RunStatusProjection {
  sessionId: string;
  runId: string;
  status: RunSummary['status'];
  lastStage?: string;
  stopReason?: string;
}

export class WorkflowProjectionPublisher {
  publish(channel: string, ...args: unknown[]): void {
    rendererEventHub.emit(channel, ...args);
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(channel, ...args);
      }
    }
  }

  publishWorkflowState(state: WorkflowState): void {
    this.publish('workflow:stateChanged', state);
    this.publish('workflow:stageChanged', {
      stage: state.currentStage,
      blockers: state.blockers,
    });
  }

  publishRunStatus(payload: RunStatusProjection): void {
    this.publish('workflow:runStatusChanged', payload);
  }

  publishRunUsage(scope: SessionScope, usage: RunContextUsageSummary): void {
    this.publish('workflow:runUsageChanged', {
      ...scope,
      payload: usage,
    });
  }

  publishTraceProjectionChanged(scope: SessionScope, presentation: AgentRunPresentation): void {
    this.publish('trace:projectionChanged', {
      ...scope,
      presentation,
    });
  }

  publishEvidenceEvent(event: ActionEvent): void {
    this.publish('evidence:eventAdded', event);
  }

  publishConversationEvent(event: ConversationStreamEvent): void {
    this.publish('conversation:event', event);
  }

  publishAgentStatus(state: AgentState): void {
    this.publish('agent:statusChanged', state);
  }

  publishAgentMessage(message: AgentMessage): void {
    this.publish('agent:message', message);
  }
}

export const workflowProjectionPublisher = new WorkflowProjectionPublisher();
