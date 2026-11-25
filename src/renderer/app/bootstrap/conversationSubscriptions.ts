import { applyToolTraceToMessage } from '../../services/conversationTimeline';
import { useConversationStore } from '../../stores/conversationStore';
import { isActiveSessionEvent } from '../../stores/sessionEventGate';
import { useSessionProjectionStore } from '../../stores/sessionProjectionStore';
import { useSessionStore } from '../../stores/sessionStore';
import { createConversationEventBatcher } from './conversationEventBatcher';
import { createConversationMessageAssembler } from './conversationMessageAssembler';
import type { ToolTraceEntry } from '@shared/types/tool';
import type { ConversationStreamEvent } from '@shared/types/conversation';

import type { ElectronAPI } from '@shared/types/electron';
const projection = () => useSessionProjectionStore.getState();

export function subscribeToolExecutionComplete(electronAPI: ElectronAPI) {
  return electronAPI.events.onToolExecutionComplete((rawTrace) => {
    const trace = rawTrace as ToolTraceEntry;
    const conversation = useConversationStore.getState();
    const message = trace.turnId
      ? conversation.allConversationMessages.find(
        (entry) => entry.turnId === trace.turnId && entry.role === 'assistant',
      )
      : undefined;
    const sessionId = message?.sessionId ?? null;
    if (sessionId && !isActiveSessionEvent(sessionId)) {
      // Background tool rows stay in the owning session projection via message patches.
      return;
    }
    // Without a resolvable session, only apply when the turn exists on the active transcript.
    if (!sessionId && trace.turnId) {
      const onActive = conversation.conversationMessages.some((entry) => entry.turnId === trace.turnId);
      if (!onActive) return;
    }

    const lastEntry = conversation.timeline[conversation.timeline.length - 1];
    if (lastEntry?.id !== trace.traceId) {
      conversation.addTimelineEntry({
        id: trace.traceId,
        type: 'tool_call',
        content: trace.toolName,
        toolTrace: trace,
        timestamp: trace.timestamp,
      });
    }
    if (trace.turnId) {
      conversation.updateAssistantMessageByTurnId(trace.turnId, (entry) => applyToolTraceToMessage(entry, trace));
    }
  });
}

function resolveMessageSessionId(message: { sessionId?: string | null }): string | null {
  return message.sessionId ?? null;
}

export function subscribeConversation(electronAPI: ElectronAPI) {
  const conversationEventBatcher = createConversationEventBatcher({
    applyMessage: (event) => {
      const sessionId = resolveMessageSessionId(event.message) ?? event.sessionId;
      const terminal = event.type === 'message_completed' || event.type === 'message_errored';
      if (!isActiveSessionEvent(sessionId)) {
        if (sessionId) {
          projection().projectConversationMessage(sessionId, event.message);
          if (terminal) {
            projection().projectConversationTerminal(sessionId, event.turnId, event.type === 'message_completed');
          }
        }
        return;
      }
      const conversation = useConversationStore.getState();
      conversation.upsertConversationMessage(event.message);
      if (terminal) {
        projection().projectConversationTerminal(sessionId, event.turnId, event.type === 'message_completed');
        useSessionStore.getState().markConversationTurnTerminal(
          event.turnId,
          event.type === 'message_completed',
        );
      }
    },
  });

  const handleConversationEvent = (event: ConversationStreamEvent) => {
    if (!isActiveSessionEvent(event.sessionId)) {
      if (event.type === 'message_patched' || event.type === 'message_completed' || event.type === 'message_errored') {
        projection().projectConversationMessage(event.sessionId, event.message);
        if (event.type === 'message_completed' || event.type === 'message_errored') {
          projection().projectConversationTerminal(event.sessionId, event.turnId, event.type === 'message_completed');
        }
      }
      return;
    }

    const conversation = useConversationStore.getState();
    if (event.type === 'run_linked') {
      conversation.patchAssistantMessageByTurnId(event.turnId, { runId: event.runId });
      return;
    }
    if (event.type === 'agent_event') {
      if (event.event.type === 'diagnostic') {
        conversation.addTimelineEntry({
          id: event.event.id,
          type: 'agent',
          agentRole: event.event.agentId,
          content: event.event.payload.message,
          timestamp: event.event.timestamp,
        });
      }
      return;
    }
    conversationEventBatcher.handle(event);
  };

  // Streamed updates arrive as deltas; everything below handles the whole messages the assembler rebuilds.
  const assembler = createConversationMessageAssembler({
    requestSnapshot: (sessionId, messageId) => electronAPI.conversation.getMessageSnapshot(sessionId, messageId),
    deliver: handleConversationEvent,
  });
  const handleStreamEvent = (event: ConversationStreamEvent) => {
    const assembled = assembler.accept(event);
    if (assembled) handleConversationEvent(assembled);
  };
  electronAPI.conversation.onEvent(handleStreamEvent);

  return {
    disposeBatcher: () => {
      conversationEventBatcher.dispose();
      assembler.dispose();
    },
    unsubscribe: () => electronAPI.conversation.offEvent(handleStreamEvent),
  };
}
