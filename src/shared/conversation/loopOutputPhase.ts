import type {
  ConversationLoopOutputPhase,
  ConversationLoopStopReason,
  ConversationReasoningState,
} from '@shared/types/conversation';
import type { ReasoningDelivery } from '@shared/types/agentRuntime';
import type { ThinkingArtifact } from '@shared/types/reasoning';

export interface ConversationLoopContinuationState {
  approval?: boolean;
  userInput?: boolean;
  subagent?: boolean;
  handoff?: boolean;
}

export interface ResolveConversationLoopOutputPhaseInput {
  stopReason?: ConversationLoopStopReason;
  loopHasTools: boolean;
  hasPendingContinuation?: ConversationLoopContinuationState;
}

export function resolveConversationLoopOutputPhase(
  input: ResolveConversationLoopOutputPhaseInput,
): ConversationLoopOutputPhase {
  const pending = input.hasPendingContinuation;
  const hasPendingContinuation = Boolean(
    pending?.approval || pending?.userInput || pending?.subagent || pending?.handoff,
  );

  if (
    input.stopReason === 'end_turn'
    && !input.loopHasTools
    && !hasPendingContinuation
  ) {
    return 'final_answer';
  }

  return 'commentary';
}

export function resolveConversationReasoningState(
  thinking: ThinkingArtifact | undefined,
  reasoningDelivery: ReasoningDelivery,
): ConversationReasoningState {
  if (thinking?.kind === 'raw') return 'raw';
  if (thinking?.kind === 'summary') return 'summary';
  if (thinking?.kind === 'opaque') return 'opaque';

  // Route declares reasoning delivery, but this loop produced no displayable artifact.
  if (reasoningDelivery !== 'none') {
    return 'hidden';
  }

  return 'none';
}
