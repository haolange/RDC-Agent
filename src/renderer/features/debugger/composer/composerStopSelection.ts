import type { ConversationMessage } from '@shared/types/conversation';
import type { ActiveTurnContext } from './composerSessionContext';

export const ACTIVE_ASSISTANT_STATUSES = new Set<ConversationMessage['status']>([
  'draft',
  'streaming',
]);

export function selectActiveAssistantForTurn(
  messages: ConversationMessage[],
  currentSessionId: string | null | undefined,
  activeTurn: ActiveTurnContext | null,
): ConversationMessage | null {
  const owningSessionId = currentSessionId ?? 'no-session';
  const candidates = messages
    .slice()
    .reverse()
    .filter((message) => (
      message.role === 'assistant'
      && ACTIVE_ASSISTANT_STATUSES.has(message.status)
      && (currentSessionId ? message.sessionId === currentSessionId : message.sessionId == null)
    ));

  if (!activeTurn || activeTurn.sessionId !== owningSessionId) {
    return candidates[0] ?? null;
  }

  return candidates.find((message) => (
    message.agentId === activeTurn.agentId
    && (
      message.requestId === activeTurn.requestId
      || message.turnId === activeTurn.optimisticTurnId
      || message.turnId === activeTurn.realTurnId
    )
  )) ?? null;
}
