import { generateEventId, nowMs } from '@shared/utils/id';
import type { AgentEvent } from '@shared/types/agentRuntime';
import type { ProfileHandoffState } from '@shared/types/profileHandoff';
import type { ConversationStreamEvent } from '@shared/types/conversation';

export function buildHandoffAgentEvent(
  type: 'handoff.requested' | 'handoff.consumed' | 'handoff.cancelled',
  sessionId: string,
  state: ProfileHandoffState,
): ConversationStreamEvent {
  const event: AgentEvent = {
    id: generateEventId('agent-event'),
    type,
    timestamp: nowMs(),
    sessionId,
    agentId: state.sourceAgentId,
    payload: {
      handoffId: state.handoffId,
      fromAgentId: state.sourceAgentId,
      toAgentId: state.toAgentId,
      toProfile: state.toAgentId,
      prompt: state.prompt,
      label: state.label,
      send: state.send,
      cancelReason: state.cancelReason,
    },
  };
  return {
    type: 'agent_event',
    sessionId,
    turnId: state.sourceTurnId,
    event,
  };
}
