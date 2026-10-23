import type { ConversationCancelActiveTurnResult, ConversationMessage } from '@shared/types/conversation';
import { useConversationStore } from '../../stores/conversationStore';
import {
  type ActiveTurnContext, type ActiveTurnOwnership, useComposerSessionContextStore,
} from '../../stores/composerSessionContextStore';
import { isActiveSessionEvent } from '../../stores/sessionEventGate';
import { useSessionProjectionStore } from '../../stores/sessionProjectionStore';
import { stopWorkTrace } from '../../lib/stopWorkTrace';
import { ACTIVE_ASSISTANT_STATUSES, selectActiveAssistantForTurn } from './composerStopSelection';

/** Reconcile main's stop acknowledgement without replacing an already committed terminal. */
export async function reconcileConversationStop(options: {
  conversationAPI: Pick<NonNullable<Window['electronAPI']>['conversation'], 'getHistory'>;
  cancelResult: ConversationCancelActiveTurnResult;
  sessionId: string | null | undefined;
  activeAssistant: ConversationMessage | null;
  activeTurn: ActiveTurnContext | null;
  turnOwnership: ActiveTurnOwnership | null;
}) {
  const { conversationAPI, cancelResult, sessionId, activeAssistant, activeTurn, turnOwnership } = options;
  // A successful session stop may only have joined background work: the
  // requested conversation can already be complete. Read the exact persisted
  // terminal before applying another optimistic stop.
  if (cancelResult.success && sessionId && activeAssistant && !activeAssistant.turnId.startsWith('optimistic-turn-')) {
    const history = await conversationAPI.getHistory(sessionId);
    const terminal = history.messages.find((message) => (
      message.role === 'assistant'
      && message.sessionId === sessionId
      && message.turnId === activeAssistant.turnId
      && message.requestId === activeAssistant.requestId
      && message.agentId === activeAssistant.agentId
      && !ACTIVE_ASSISTANT_STATUSES.has(message.status)
    ));
    if (terminal) {
      if (isActiveSessionEvent(sessionId)) {
        useConversationStore.getState().upsertConversationMessage(terminal);
      } else {
        useSessionProjectionStore.getState().projectConversationMessage(sessionId, terminal);
      }
      if (turnOwnership) useComposerSessionContextStore.getState().clearActiveTurnIfOwned(turnOwnership);
      return;
    }
  }

  // A delayed stop may not add old request markers to another session's store.
  if (!sessionId || isActiveSessionEvent(sessionId)) {
    const conversation = useConversationStore.getState();
    const latestAssistant = selectActiveAssistantForTurn(conversation.conversationMessages, sessionId, activeTurn)
      ?? (activeAssistant && ACTIVE_ASSISTANT_STATUSES.has(activeAssistant.status) ? activeAssistant : null);
    const requestId = turnOwnership?.requestId ?? cancelResult.cancelledRequestId ?? latestAssistant?.requestId;
    if (requestId) conversation.markRequestMonotonicallyStopped(requestId);
    const turnId = latestAssistant?.turnId ?? cancelResult.cancelledTurnId;
    if (turnId) {
      conversation.markTurnMonotonicallyStopped(turnId);
      conversation.updateAssistantMessageByTurnId(turnId, stopWorkTrace);
    }
  }
  if (cancelResult.success && turnOwnership) {
    useComposerSessionContextStore.getState().clearActiveTurnIfOwned(turnOwnership);
  }
}
