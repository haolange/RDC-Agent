import { BrowserWindow } from 'electron';
import { createConversationMessageDeltaEncoder } from '@shared/conversation/messageDelta';
import { rendererEventHub } from '../../runtime/rendererEventHub';
import type { ActionEvent } from '@shared/types/evidence';
import type { ConversationMessage, ConversationStreamEvent } from '@shared/types/conversation';
import type { RunContextUsageSummary, RunSummary, SessionScope } from '@shared/types/session';
import type { AgentRunPresentation } from '@shared/types/agenticTrace';

export interface RunStatusProjection {
  sessionId: string;
  runId: string;
  status: RunSummary['status'];
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

  private readonly messageDeltas = createConversationMessageDeltaEncoder();

  /**
   * Streaming message updates leave as deltas against the previous update of the same message; a terminal update
   * (completed, errored) is sent whole and ends that message's stream.
   */
  publishConversationEvent(event: ConversationStreamEvent): void {
    if (event.type === 'message_patched') {
      const delta = this.messageDeltas.encode(event.message);
      if (delta) this.publish('conversation:event', { type: 'message_delta', sessionId: event.sessionId, turnId: event.turnId, delta });
      return;
    }
    if (event.type === 'message_completed' || event.type === 'message_errored') this.messageDeltas.forget(event.message.id);
    this.publish('conversation:event', event);
  }

  /** The last streamed state of a message, for a renderer that missed an update (reload, dropped event). */
  conversationMessageSnapshot(messageId: string): { seq: number; message: ConversationMessage } | null {
    return this.messageDeltas.snapshot(messageId);
  }

}

export const workflowProjectionPublisher = new WorkflowProjectionPublisher();
